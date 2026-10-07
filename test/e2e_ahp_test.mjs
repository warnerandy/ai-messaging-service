const BASE_URL = "http://localhost:4002"
const WS_BASE_URL = "ws://localhost:4002"

async function run() {
	console.log("=== Starting AHP End-to-End Verification ===")

	// 1. Register a test user
	const email = `ahp-test-${Date.now()}@example.com`
	const password = "password123456"

	const regRes = await fetch(`${BASE_URL}/api/register`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	})
	if (!regRes.ok) {
		throw new Error(`Register failed: ${await regRes.text()}`)
	}
	const { token: userToken, user } = await regRes.json()
	console.log("✓ Registered user:", user.email)

	// 2. Create AHP Bot Token
	const botRes = await fetch(`${BASE_URL}/api/bot-tokens`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${userToken}`,
		},
		body: JSON.stringify({ name: "Coding-Agent-007", bot_type: "ahp" }),
	})
	if (!botRes.ok) {
		throw new Error(`Create bot failed: ${await botRes.text()}`)
	}
	const bot = await botRes.json()
	console.log("✓ Created AHP bot:", bot.name, "bot_type:", bot.bot_type, "channel_code:", bot.channel_code)

	// 3. Connect Bot WebSocket
	const botWs = new WebSocket(`${WS_BASE_URL}/bot/websocket?token=${bot.token}`)
	await new Promise((resolve, reject) => {
		botWs.onopen = resolve
		botWs.onerror = reject
	})
	console.log("✓ Bot WebSocket connected")

	// Join bot channel
	const botChannelTopic = `bot:${bot.channel_code}`
	botWs.send(
		JSON.stringify({
			topic: botChannelTopic,
			event: "phx_join",
			payload: {},
			ref: "join-bot",
		}),
	)

	await waitForWsMessage(botWs, (msg) => msg.event === "phx_reply" && msg.ref === "join-bot")
	console.log("✓ Bot joined channel:", botChannelTopic)

	// 4. Bot syncs sessions
	botWs.send(
		JSON.stringify({
			topic: botChannelTopic,
			event: "sync_sessions",
			payload: {
				sessions: [
					{
						session_id: "ahp-session-1",
						title: "Refactor Database Models",
						status: "running",
						metadata: { step: "Compiling code", tool: "mix compile" },
					},
					{
						session_id: "ahp-session-2",
						title: "Run Unit Tests",
						status: "idle",
					},
				],
			},
			ref: "sync-1",
		}),
	)

	const syncReply = await waitForWsMessage(
		botWs,
		(msg) => msg.event === "phx_reply" && msg.ref === "sync-1",
	)
	console.log("✓ Bot sessions synced:", syncReply.payload.response.sessions.length, "sessions")
	const convId = syncReply.payload.response.sessions[0].id

	// 5. Connect User WebSocket
	const userWs = new WebSocket(`${WS_BASE_URL}/socket/websocket?token=${userToken}`)
	await new Promise((resolve, reject) => {
		userWs.onopen = resolve
		userWs.onerror = reject
	})
	console.log("✓ User WebSocket connected")

	// Join conversation channel
	const convTopic = `conversation:${convId}`
	userWs.send(
		JSON.stringify({
			topic: convTopic,
			event: "phx_join",
			payload: {},
			ref: "join-conv",
		}),
	)

	const convJoinReply = await waitForWsMessage(
		userWs,
		(msg) => msg.event === "phx_reply" && msg.ref === "join-conv",
	)
	console.log(
		"✓ User joined conversation channel:",
		convTopic,
		"Status:",
		convJoinReply.payload.response.status,
	)

	// 6. Bot streams thinking event
	botWs.send(
		JSON.stringify({
			topic: botChannelTopic,
			event: "ahp_event",
			payload: {
				conversation_id: convId,
				event_type: "thinking",
				data: { chunk: "Evaluating AST syntax tree for optimizations..." },
			},
			ref: "think-1",
		}),
	)

	const thinkingEvent = await waitForWsMessage(
		userWs,
		(msg) => msg.topic === convTopic && msg.event === "ahp_event" && msg.payload.event_type === "thinking",
	)
	console.log("✓ User received streaming thinking:", thinkingEvent.payload.data.chunk)

	// 7. Bot sends interactive question / approval
	botWs.send(
		JSON.stringify({
			topic: botChannelTopic,
			event: "ahp_event",
			payload: {
				conversation_id: convId,
				event_type: "question",
				data: {
					id: "q-42",
					title: "Execute migration",
					prompt: "Allow running mix ecto.migrate on test database?",
					options: ["Approve", "Deny"],
				},
			},
			ref: "question-1",
		}),
	)

	const questionEvent = await waitForWsMessage(
		userWs,
		(msg) => msg.topic === convTopic && msg.event === "ahp_event" && msg.payload.event_type === "question",
	)
	console.log("✓ User received question approval request:", questionEvent.payload.data.title)

	// 8. User answers question
	userWs.send(
		JSON.stringify({
			topic: convTopic,
			event: "answer_question",
			payload: {
				question_id: "q-42",
				answer: "Approve",
				approved: true,
			},
			ref: "ans-1",
		}),
	)

	const answerEvent = await waitForWsMessage(
		botWs,
		(msg) => msg.event === "answer_question" && msg.payload.question_id === "q-42",
	)
	console.log("✓ Bot received question answer:", answerEvent.payload.answer)

	// 9. User sends steering instruction
	userWs.send(
		JSON.stringify({
			topic: convTopic,
			event: "steer",
			payload: {
				action: "steer",
				instruction: "Focus only on bot_tokens table",
			},
			ref: "steer-1",
		}),
	)

	const steerEvent = await waitForWsMessage(
		botWs,
		(msg) => msg.event === "steer_agent" && msg.payload.action === "steer",
	)
	console.log("✓ Bot received steering command:", steerEvent.payload.instruction)

	// 10. User queues prompt
	userWs.send(
		JSON.stringify({
			topic: convTopic,
			event: "queue_prompt",
			payload: {
				body: "Run mix precommit next",
			},
			ref: "queue-1",
		}),
	)

	const queueReply = await waitForWsMessage(
		userWs,
		(msg) => msg.event === "phx_reply" && msg.ref === "queue-1",
	)
	console.log("✓ User queued prompt successfully:", queueReply.payload.response.prompt.body)

	// 11. Bot sets status idle -> auto-dispatches queued prompt!
	botWs.send(
		JSON.stringify({
			topic: botChannelTopic,
			event: "session_status",
			payload: {
				conversation_id: convId,
				status: "idle",
			},
			ref: "idle-1",
		}),
	)

	const autoPromptEvent = await waitForWsMessage(
		botWs,
		(msg) => msg.event === "execute_queued_prompt",
	)
	console.log("✓ Bot received auto-dispatched queued prompt:", autoPromptEvent.payload.prompt.body)

	// 12. Regenerate Bot Token
	const regenRes = await fetch(`${BASE_URL}/api/bot-tokens/${bot.id}/regenerate`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${userToken}`,
		},
	})
	if (!regenRes.ok) {
		throw new Error(`Regenerate failed: ${await regenRes.text()}`)
	}
	const regenerated = await regenRes.json()
	console.log("✓ Successfully regenerated bot token, new channel_code:", regenerated.channel_code)

	// Cleanup
	botWs.close()
	userWs.close()

	console.log("\n==============================================")
	console.log("🎉 ALL AHP END-TO-END TESTS PASSED SUCCESSFULLY!")
	console.log("==============================================")
}

function waitForWsMessage(ws, predicate, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`))
		}, timeoutMs)

		function onMessage(event) {
			try {
				const data = JSON.parse(event.data)
				if (predicate(data)) {
					clearTimeout(timer)
					ws.removeEventListener("message", onMessage)
					resolve(data)
				}
			} catch {
				// ignore
			}
		}

		ws.addEventListener("message", onMessage)
	})
}

run().catch((err) => {
	console.error("❌ Test failed:", err)
	process.exit(1)
})
