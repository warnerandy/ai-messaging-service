#!/usr/bin/env node

/**
 * Redeploy a Portainer stack with pullImage: true, verify container health,
 * and clean up any superseded untagged images.
 *
 * Usage:
 *   node scripts/redeploy_portainer.cjs [stack_name_or_id]
 *
 * Examples:
 *   node scripts/redeploy_portainer.cjs ai-messaging-service
 *   node scripts/redeploy_portainer.cjs ai-messenger
 *   node scripts/redeploy_portainer.cjs 7
 *   node scripts/redeploy_portainer.cjs 13
 */

const portainerUrl = process.env.PORTAINER_URL || 'http://192.168.1.121:9090';
const token = process.env.PORTAINER_TOKEN || 'ptr_nnJH5XPQupq5N0j7o/fFnDCxrLeaze/pndxP8SMOlu8=';
const targetArg = process.argv[2] || process.env.STACK || 'ai-messaging-service';

const authHeaders = token.startsWith('ptr_')
  ? { 'X-API-Key': token }
  : { Authorization: `Bearer ${token}` };

async function api(path, options = {}) {
  const url = `${portainerUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Portainer API request failed [${res.status} ${res.statusText}] ${path}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Connecting to Portainer at ${portainerUrl}...`);

  // 1. Fetch stacks to find the matching one
  const stacks = await api('/api/stacks');
  const stack = stacks.find(
    (s) =>
      s.Id.toString() === targetArg ||
      s.Name.toLowerCase() === targetArg.toLowerCase()
  );

  if (!stack) {
    console.error(`Stack "${targetArg}" not found in Portainer.`);
    console.log('Available stacks:');
    for (const s of stacks) {
      console.log(`  - ID: ${s.Id.toString().padEnd(4)} Name: ${s.Name}`);
    }
    process.exit(1);
  }

  const endpointId = stack.EndpointId || 2;
  console.log(`Found stack "${stack.Name}" (ID: ${stack.Id}, Endpoint: ${endpointId}).`);

  // 2. Fetch the current stack docker-compose file
  console.log(`Fetching stack compose file for stack ${stack.Id}...`);
  const fileData = await api(`/api/stacks/${stack.Id}/file`);
  if (!fileData || !fileData.StackFileContent) {
    throw new Error('Failed to retrieve StackFileContent.');
  }

  // 3. Redeploy stack with pullImage: true
  console.log(`Redeploying stack "${stack.Name}" with pullImage: true...`);
  const updateResult = await api(`/api/stacks/${stack.Id}?endpointId=${endpointId}`, {
    method: 'PUT',
    body: JSON.stringify({
      stackFileContent: fileData.StackFileContent,
      env: stack.Env || [],
      prune: false,
      pullImage: true
    })
  });

  console.log(`Stack "${updateResult.Name}" updated successfully.`);

  // 4. Wait for containers to recreate and verify health
  console.log('Waiting 5s for container initialization...');
  await sleep(5000);

  const containers = await api(`/api/endpoints/${endpointId}/docker/containers/json?all=false`);
  const stackContainers = containers.filter((c) =>
    (c.Names || []).some((n) => n.includes(stack.Name))
  );

  console.log('\n--- Active Stack Containers ---');
  if (stackContainers.length === 0) {
    console.log('No active containers found matching stack name.');
  } else {
    for (const c of stackContainers) {
      const name = (c.Names && c.Names[0]) || c.Id.slice(0, 12);
      console.log(`  ${name.padEnd(30)} Status: ${c.Status} (State: ${c.State})`);
    }
  }

  // 5. Clean up any superseded untagged images left behind on Docker host
  try {
    const usedImageIds = new Set(containers.map((c) => c.ImageID));
    const allImages = await api(`/api/endpoints/${endpointId}/docker/images/json`);

    // Look for untagged images that belong to this stack's repositories
    const danglingStackImages = allImages.filter((img) => {
      if (usedImageIds.has(img.Id)) return false;
      const tags = img.RepoTags || [];
      const digests = img.RepoDigests || [];
      const matchesStack = digests.some((d) => d.includes(stack.Name)) || tags.some((t) => t.includes(stack.Name));
      const isUntagged = tags.length === 0 || tags.includes('<none>:<none>');
      return matchesStack && isUntagged;
    });

    if (danglingStackImages.length > 0) {
      console.log(`\nCleaning up ${danglingStackImages.length} superseded untagged image(s)...`);
      for (const img of danglingStackImages) {
        const shortId = img.Id.slice(7, 19);
        try {
          await api(`/api/endpoints/${endpointId}/docker/images/${shortId}?force=true`, {
            method: 'DELETE'
          });
          console.log(`  Deleted old image: ${shortId}`);
        } catch {
          // ignore if already pruned or shared
        }
      }
    }
  } catch (err) {
    console.warn('Note: Could not run image cleanup pass:', err.message);
  }

  console.log('\nRedeploy complete!');
}

main().catch((err) => {
  console.error('\nRedeploy error:', err.message);
  process.exit(1);
});
