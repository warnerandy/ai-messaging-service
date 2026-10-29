const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOjEsInNjb3BlIjoiZGVmYXVsdCIsImZvcmNlQ2hhbmdlUGFzc3dvcmQiOmZhbHNlLCJleHAiOjE3OTMzMTQzODYsImlhdCI6MTc5MzI4NTU4Nn0.ZfTR1Zf7ZR4jAmVRVRq_3_SVJhn_AkK8dbBusfp75Ng';

async function main() {
  // 1. Get current stack file
  console.log('Fetching stack file for stack 7...');
  const fileRes = await fetch('http://192.168.1.121:9090/api/stacks/7/file', {
    headers: { Authorization: `Bearer ${jwt}` }
  });
  const fileData = await fileRes.json();
  console.log('Got stack file, length:', fileData.StackFileContent.length);

  // 2. Redeploy with pullImage: true
  console.log('Updating stack with pullImage: true...');
  const putRes = await fetch('http://192.168.1.121:9090/api/stacks/7?endpointId=2', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stackFileContent: fileData.StackFileContent,
      env: [],
      prune: false,
      pullImage: true
    })
  });

  const putText = await putRes.text();
  console.log('Redeploy response status:', putRes.status);
  console.log('Response body:', putText);
}

main().catch(console.error);
