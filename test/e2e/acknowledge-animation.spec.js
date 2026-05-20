// @ts-check
const { test, expect } = require('@playwright/test')

const BASE = 'http://localhost:4000'

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {string | undefined} [token]
 */
async function apiPost(request, path, body, token) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await request.post(`${BASE}${path}`, { data: body, headers })
  return res.json()
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {string | undefined} [token]
 */
async function apiPut(request, path, body, token) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await request.put(`${BASE}${path}`, { data: body, headers })
  return res.json()
}

test('shows thinking animation in bot bubble when bot acknowledges message', async ({ page, request }) => {
  const email = `ack-test-${Date.now()}@example.com`
  const password = 'TestPassword123!'

  // ── 1. Register user ─────────────────────────────────────────────────────
  const regRes = await apiPost(request, '/api/register', { email, password })
  const userToken = regRes.token
  expect(userToken).toBeTruthy()

  // ── 2. Create bot token ──────────────────────────────────────────────────
  const botRes = await apiPost(request, '/api/bot-tokens', { name: 'Ack Test Bot' }, userToken)
  const botToken = botRes.token
  const botTokenId = botRes.id
  expect(botToken).toBeTruthy()

  // ── 3. Create conversation ───────────────────────────────────────────────
  const convRes = await apiPost(request, '/api/conversations', { bot_token_id: botTokenId }, userToken)
  const conversationId = convRes.id
  expect(conversationId).toBeTruthy()

  // ── 4. Log in via UI so the chat is live ─────────────────────────────────
  await page.goto('/')

  // Switch to login mode if needed
  const modeToggle = page.locator('button.mode-toggle')
  if (await modeToggle.isVisible()) {
    const toggleText = await modeToggle.textContent()
    if (toggleText?.includes('Sign in')) {
      await modeToggle.click()
    }
  }

  await page.fill('#auth-email', email)
  await page.fill('#auth-password', password)
  await page.click('button.auth-submit')

  // Wait for the app layout to appear
  await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 })

  // ── 5. Navigate to the conversation ──────────────────────────────────────
  // Click the bot pill that was created
  const botPill = page.locator('.bot-pill').filter({ hasText: 'Ack Test Bot' })
  await expect(botPill).toBeVisible({ timeout: 8000 })
  await botPill.click()

  // Click the conversation in the sidebar
  const convItem = page.locator('.conv-item').first()
  await expect(convItem).toBeVisible({ timeout: 5000 })
  await convItem.click()

  await expect(page.locator('.chat-messages')).toBeVisible({ timeout: 5000 })

  // ── 6. Send a user message via the REST API directly ─────────────────────
  // (faster and more reliable than typing in the UI for this test)
  const msgRes = await apiPost(
    request,
    `/api/conversations/${conversationId}/messages`,
    { body: 'Hello bot, are you thinking?' },
    userToken
  )
  const messageId = msgRes.id
  expect(messageId).toBeTruthy()

  // Wait for the message to appear in the UI (broadcast via WebSocket)
  const userBubble = page.locator('.msg--user .msg-bubble').last()
  await expect(userBubble).toBeVisible({ timeout: 8000 })

  // Verify no thinking animation yet
  await expect(userBubble.locator('.msg-thinking')).not.toBeVisible()

  // ── 7. Bot acknowledges the message ──────────────────────────────────────
  const ackRes = await apiPut(
    request,
    `/api/bot/messages/${messageId}/acknowledge`,
    { conversation_id: conversationId },
    botToken
  )
  expect(ackRes.acknowledged).toBe(true)

  // ── 8. Thinking animation should now appear in the bot bubble ────────────
  const thinkingDots = page.locator('.msg-bubble--typing .typing-dots')
  await expect(thinkingDots).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.msg-bubble--typing .msg-thinking-timer')).toBeVisible({ timeout: 5000 })

  // User bubble should not render its own thinking indicator
  await expect(userBubble.locator('.msg-thinking')).toHaveCount(0)

  // "Delivered" status should be hidden while awaiting response
  await expect(userBubble.locator('.msg-status--delivered')).not.toBeVisible()

  // ── 9. Screenshot ────────────────────────────────────────────────────────
  const chatArea = page.locator('.chat-messages')
  await chatArea.screenshot({ path: 'test-results/thinking-animation.png' })

  // Full page screenshot too
  await page.screenshot({ path: 'test-results/thinking-animation-full.png', fullPage: false })

  // ── 10. Bot sends reply — animation should clear ──────────────────────────
  await apiPost(
    request,
    '/api/bot/messages',
    {
      conversation_id: conversationId,
      content_type: 'text',
      body: 'I was thinking, and here is my response!'
    },
    botToken
  )

  // Thinking dots should disappear
  await expect(thinkingDots).not.toBeVisible({ timeout: 8000 })

  // "Delivered" status should reappear
  await expect(userBubble.locator('.msg-status--delivered')).toBeVisible({ timeout: 5000 })

  // Bot message should show
  const botBubble = page.locator('.msg--bot .msg-bubble--bot').last()
  await expect(botBubble).toBeVisible({ timeout: 5000 })

  // Final screenshot with full exchange
  await chatArea.screenshot({ path: 'test-results/thinking-animation-resolved.png' })
})
