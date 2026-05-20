import { Socket } from "phoenix"

const storageKey = "messaging.user.token"

const state = {
	token: localStorage.getItem(storageKey),
	bots: [],
	selectedBotId: null,
	conversations: [],
	selectedConversationId: null,
	models: [],
	socket: null,
	conversationChannel: null,
	renderedMessageIds: new Set(),
	pendingMessages: new Map(),
	botIsTyping: false,
	notificationsEnabled: localStorage.getItem("notifications.enabled") === "true",
	typingTimeoutId: null,
}

const elements = {
	authPanel: document.getElementById("auth-panel"),
	workspace: document.getElementById("workspace"),
	authError: document.getElementById("auth-error"),
	loginForm: document.getElementById("login-form"),
	registerForm: document.getElementById("register-form"),
	logoutBtn: document.getElementById("logout-btn"),
	botList: document.getElementById("bot-list"),
	refreshBotsBtn: document.getElementById("refresh-bots-btn"),
	createBotForm: document.getElementById("create-bot-form"),
	newBotName: document.getElementById("new-bot-name"),
	botTokenReveal: document.getElementById("bot-token-reveal"),
	botTokenValue: document.getElementById("bot-token-value"),
	copyBotTokenBtn: document.getElementById("copy-bot-token-btn"),
	emptyState: document.getElementById("empty-state"),
	chatView: document.getElementById("chat-view"),
	chatBotName: document.getElementById("chat-bot-name"),
	chatStatus: document.getElementById("chat-status"),
	refreshModelsBtn: document.getElementById("refresh-models-btn"),
	conversationSelect: document.getElementById("conversation-select"),
	newConversationBtn: document.getElementById("new-conversation-btn"),
	modelSelect: document.getElementById("model-select"),
	messages: document.getElementById("messages"),
	messageForm: document.getElementById("message-form"),
	messageInput: document.getElementById("message-input"),
	typingIndicator: null,
}

function boot() {
	registerServiceWorker()
	bindEvents()
	requestNotificationPermission()
	renderAuthState()

	if (state.token) {
		loadWorkspace().catch(() => {
			clearSession()
			renderAuthState()
		})
	}
}

function bindEvents() {
	elements.loginForm.addEventListener("submit", onLogin)
	elements.registerForm.addEventListener("submit", onRegister)
	elements.logoutBtn.addEventListener("click", onLogout)
	elements.refreshBotsBtn.addEventListener("click", () => loadBots())
	elements.createBotForm.addEventListener("submit", onCreateBot)
	elements.copyBotTokenBtn.addEventListener("click", onCopyBotToken)
	elements.refreshModelsBtn.addEventListener("click", onRefreshModels)
	elements.newConversationBtn.addEventListener("click", onCreateConversation)
	elements.conversationSelect.addEventListener("change", onConversationChange)
	elements.messageForm.addEventListener("submit", onSendMessage)
}

function renderAuthState() {
	const isLoggedIn = Boolean(state.token)
	elements.authPanel.hidden = isLoggedIn
	elements.workspace.hidden = !isLoggedIn
	elements.logoutBtn.hidden = !isLoggedIn
}

async function onLogin(event) {
	event.preventDefault()
	const email = document.getElementById("login-email").value
	const password = document.getElementById("login-password").value

	try {
		const response = await apiRequest("/api/login", {
			method: "POST",
			body: { email, password },
			auth: false,
		})

		setSession(response.token)
		await loadWorkspace()
	} catch (error) {
		showAuthError(error.message)
	}
}

async function onRegister(event) {
	event.preventDefault()
	const email = document.getElementById("register-email").value
	const password = document.getElementById("register-password").value

	try {
		const response = await apiRequest("/api/register", {
			method: "POST",
			body: { email, password },
			auth: false,
		})

		setSession(response.token)
		await loadWorkspace()
	} catch (error) {
		showAuthError(error.message)
	}
}

function onLogout() {
	clearSession()
	if (state.socket) state.socket.disconnect()
	state.socket = null
	state.conversationChannel = null
	state.selectedBotId = null
	state.selectedConversationId = null
	state.renderedMessageIds.clear()
	elements.messages.replaceChildren()
	hideCreatedBotToken()
	renderAuthState()
}

function setSession(token) {
	state.token = token
	localStorage.setItem(storageKey, token)
	elements.authError.hidden = true
	renderAuthState()
}

function clearSession() {
	state.token = null
	localStorage.removeItem(storageKey)
}

function showAuthError(message) {
	elements.authError.textContent = message
	elements.authError.hidden = false
}

async function loadWorkspace() {
	await ensureUserSocket()
	await loadBots()
}

async function loadBots() {
	const response = await apiRequest("/api/bot-tokens")
	state.bots = response.bot_tokens || []
	renderBots()

	if (!state.bots.length) {
		state.selectedBotId = null
		toggleChat(false)
		elements.emptyState.textContent = "No bots found. Create one with the API first."
		return
	}

	if (!state.selectedBotId || !state.bots.find((bot) => bot.id === state.selectedBotId)) {
		await selectBot(state.bots[0].id)
	}
}

async function onCreateBot(event) {
	event.preventDefault()

	const name = elements.newBotName.value.trim()
	if (!name) return

	try {
		const created = await apiRequest("/api/bot-tokens", {
			method: "POST",
			body: { name },
		})

		if (created?.token) {
			showCreatedBotToken(created.token)
		}

		elements.newBotName.value = ""
		await loadBots()

		if (created?.id) {
			await selectBot(created.id)
		}
	} catch (error) {
		elements.emptyState.textContent = error.message || "Failed to create bot"
		toggleChat(false)
	}
}

function showCreatedBotToken(token) {
	elements.botTokenValue.textContent = token
	elements.botTokenReveal.hidden = false
}

function hideCreatedBotToken() {
	elements.botTokenValue.textContent = ""
	elements.botTokenReveal.hidden = true
}

async function onCopyBotToken() {
	const token = elements.botTokenValue.textContent
	if (!token) return

	try {
		await navigator.clipboard.writeText(token)
		elements.copyBotTokenBtn.textContent = "Copied"
		setTimeout(() => {
			elements.copyBotTokenBtn.textContent = "Copy"
		}, 1200)
	} catch {
		elements.copyBotTokenBtn.textContent = "Copy failed"
		setTimeout(() => {
			elements.copyBotTokenBtn.textContent = "Copy"
		}, 1200)
	}
}

function renderBots() {
	elements.botList.replaceChildren()

	for (const bot of state.bots) {
		const item = document.createElement("li")
		item.className = "bot-item"
		if (bot.id === state.selectedBotId) item.classList.add("active")

		const status = bot.is_connected ? "online" : "offline"
		item.innerHTML = `
      <button type="button" data-bot-id="${bot.id}" class="bot-btn">
        <span class="bot-name">${escapeHtml(bot.name)}</span>
        <span class="bot-meta">${status}${bot.is_working ? " - thinking" : ""}</span>
      </button>
    `

		item.querySelector("button").addEventListener("click", async () => {
			await selectBot(bot.id)
		})

		elements.botList.appendChild(item)
	}
}

async function selectBot(botId) {
	state.selectedBotId = botId
	renderBots()
	toggleChat(true)

	const bot = state.bots.find((entry) => entry.id === botId)
	elements.chatBotName.textContent = bot?.name || "Bot"
	elements.chatStatus.textContent = bot?.is_connected ? "Connected" : "Disconnected"

	await Promise.all([loadModels(botId), loadConversations(botId)])
}

async function loadModels(botId) {
	const response = await apiRequest(`/api/bot-tokens/${botId}/models`)
	state.models = response.models || []
	renderModels()
}

function renderModels() {
	elements.modelSelect.replaceChildren()

	const autoOption = document.createElement("option")
	autoOption.value = ""
	autoOption.textContent = "Auto model"
	elements.modelSelect.appendChild(autoOption)

	for (const model of state.models) {
		const option = document.createElement("option")
		option.value = model.name
		option.textContent = model.name
		elements.modelSelect.appendChild(option)
	}
}

async function onRefreshModels() {
	if (!state.selectedBotId) return

	await apiRequest(`/api/bot-tokens/${state.selectedBotId}/refresh-models`, { method: "POST" })
	await loadModels(state.selectedBotId)
}

async function loadConversations(botId) {
	const response = await apiRequest("/api/conversations")
	const allConversations = response.conversations || []
	state.conversations = allConversations.filter((c) => c.bot_token_id === botId)

	renderConversations()

	if (!state.conversations.length) {
		await onCreateConversation()
		return
	}

	const selectedExists = state.conversations.find((c) => c.id === state.selectedConversationId)
	const nextConversation = selectedExists || state.conversations[0]
	await selectConversation(nextConversation.id)
}

function renderConversations() {
	elements.conversationSelect.replaceChildren()

	for (const conversation of state.conversations) {
		const option = document.createElement("option")
		option.value = String(conversation.id)
		option.textContent = conversation.title || `Conversation ${conversation.id}`
		if (conversation.id === state.selectedConversationId) option.selected = true
		elements.conversationSelect.appendChild(option)
	}
}

async function onCreateConversation() {
	if (!state.selectedBotId) return

	const response = await apiRequest("/api/conversations", {
		method: "POST",
		body: { bot_token_id: state.selectedBotId },
	})

	state.conversations.unshift(response)
	state.selectedConversationId = response.id
	renderConversations()
	await selectConversation(response.id)
}

async function onConversationChange() {
	const conversationId = Number(elements.conversationSelect.value)
	if (!Number.isFinite(conversationId)) return
	await selectConversation(conversationId)
}

async function selectConversation(conversationId) {
	state.selectedConversationId = conversationId
	renderConversations()

	state.renderedMessageIds.clear()
	elements.messages.replaceChildren()

	const response = await apiRequest(`/api/conversations/${conversationId}`)
	const messages = response.messages || []
	messages.forEach(appendMessage)

	await connectConversationChannel(conversationId)
}

async function onSendMessage(event) {
	event.preventDefault()
	if (!state.selectedConversationId) return

	const body = elements.messageInput.value.trim()
	if (!body) return

	const model = elements.modelSelect.value || null

	const payload = { body }
	if (model) payload.model = model

	const messageId = `optimistic-${Date.now()}`
	const optimisticMessage = {
		id: messageId,
		body,
		model,
		role: "user",
		content_type: "text",
		pending: true,
		inserted_at: new Date().toISOString(),
	}

	state.pendingMessages.set(messageId, true)
	appendMessage(optimisticMessage)
	elements.messageInput.value = ""

	try {
		const response = await apiRequest(
			`/api/conversations/${state.selectedConversationId}/messages`,
			{
				method: "POST",
				body: payload,
			},
		)

		state.pendingMessages.delete(messageId)
		const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
		if (messageElement) {
			messageElement.classList.remove("pending")
			messageElement.setAttribute("data-message-id", response.id)
			state.renderedMessageIds.add(response.id)
		}
	} catch (error) {
		console.error("Failed to send message:", error)
		state.pendingMessages.delete(messageId)
		const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
		if (messageElement) {
			messageElement.classList.add("failed")
		}
	}
}

async function ensureUserSocket() {
	if (state.socket) return

	state.socket = new Socket("/socket", { params: { token: state.token } })
	state.socket.connect()
}

async function connectConversationChannel(conversationId) {
	if (!state.socket) return

	const channelInfo = await apiRequest(`/api/conversations/${conversationId}/channel`)
	const topic = channelInfo.topic

	if (state.conversationChannel && state.conversationChannel.topic === topic) {
		return
	}

	if (state.conversationChannel) {
		state.conversationChannel.leave()
	}

	const channel = state.socket.channel(topic, {})
	channel.on("new_message", (payload) => {
		if (payload?.message) {
			if (payload.message.role !== "user") {
				state.botIsTyping = false
				hideTypingIndicator()
				clearTimeout(state.typingTimeoutId)
			}
			appendMessage(payload.message)
			showNotificationIfBackgrounded(payload.message)
		}
	})

	channel.on("bot_status_changed", (payload) => {
		if (payload?.is_working) {
			state.botIsTyping = true
			showTypingIndicator()
			clearTimeout(state.typingTimeoutId)
			state.typingTimeoutId = setTimeout(() => {
				state.botIsTyping = false
				hideTypingIndicator()
			}, 3000)
		} else {
			state.botIsTyping = false
			hideTypingIndicator()
		}
	})

	channel
		.join()
		.receive("ok", () => {
			state.conversationChannel = channel
		})
		.receive("error", () => {
			state.conversationChannel = null
		})
}

function appendMessage(message) {
	if (!message?.id) return
	if (!message.pending && state.renderedMessageIds.has(message.id)) return
	if (!message.pending) state.renderedMessageIds.add(message.id)

	const row = document.createElement("article")
	row.setAttribute("data-message-id", message.id)
	row.className = `message ${message.role === "user" ? "outbound" : "inbound"}`
	if (message.pending) row.classList.add("pending")

	const modelTag = message.model
		? `<span class="message-model">${escapeHtml(message.model)}</span>`
		: ""
	const pendingBadge = message.pending ? '<span class="pending-badge">Sending...</span>' : ""

	row.innerHTML = `
    <header class="message-head">
      <strong>${escapeHtml(message.role || "message")}</strong>
      ${modelTag}
      ${pendingBadge}
    </header>
    <p>${escapeHtml(message.body || "")}</p>
  `

	elements.messages.appendChild(row)
	elements.messages.scrollTop = elements.messages.scrollHeight
}

function toggleChat(visible) {
	elements.emptyState.hidden = visible
	elements.chatView.hidden = !visible
}

async function apiRequest(path, options = {}) {
	const { method = "GET", body, auth = true } = options
	const headers = {
		"Content-Type": "application/json",
	}

	if (auth && state.token) {
		headers.Authorization = `Bearer ${state.token}`
	}

	const response = await fetch(path, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	})

	const json = await response.json().catch(() => ({}))

	if (!response.ok) {
		const message = json.error || "Request failed"
		throw new Error(message)
	}

	return json
}

function registerServiceWorker() {
	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js").catch(() => {
				// Ignore registration failures in local development.
			})
		})
	}
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

function requestNotificationPermission() {
	if ("Notification" in window && Notification.permission === "default") {
		Notification.requestPermission().then((permission) => {
			if (permission === "granted") {
				state.notificationsEnabled = true
				localStorage.setItem("notifications.enabled", "true")
			}
		})
	}
}

function showNotificationIfBackgrounded(message) {
	if (!state.notificationsEnabled || !("serviceWorker" in navigator)) return

	navigator.serviceWorker.getRegistration().then((registration) => {
		if (registration) {
			const isBackgrounded = document.hidden
			if (isBackgrounded && message.role === "bot") {
				registration.showNotification("New message from bot", {
					body: message.body || "You have a new message",
					icon: "/manifest.webmanifest",
					badge: "/manifest.webmanifest",
					tag: "bot-message",
					requireInteraction: false,
				})
			}
		}
	})
}

function showTypingIndicator() {
	if (elements.typingIndicator) return

	const row = document.createElement("article")
	row.className = "message inbound typing-indicator"
	row.innerHTML = `
    <header class="message-head">
      <strong>bot</strong>
    </header>
    <div class="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `

	elements.typingIndicator = row
	elements.messages.appendChild(row)
	elements.messages.scrollTop = elements.messages.scrollHeight
}

function hideTypingIndicator() {
	if (elements.typingIndicator) {
		elements.typingIndicator.remove()
		elements.typingIndicator = null
	}
}

boot()
