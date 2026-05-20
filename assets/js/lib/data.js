import { apiRequest, uploadFile } from "./api.js"

export function pingApp(token) {
	return apiRequest(`/api/ping?ts=${Date.now()}`, { token })
}

export function loginUser(email, password) {
	return apiRequest("/api/login", {
		method: "POST",
		body: { email, password },
	})
}

export function registerUser(email, password) {
	return apiRequest("/api/register", {
		method: "POST",
		body: { email, password },
	})
}

export function listBots(token) {
	return apiRequest("/api/bot-tokens", { token })
}

export function createBot(token, name) {
	return apiRequest("/api/bot-tokens", {
		method: "POST",
		body: { name },
		token,
	})
}

export function deleteBot(token, botId) {
	return apiRequest(`/api/bot-tokens/${botId}`, {
		method: "DELETE",
		token,
	})
}

export function listBotModels(token, botId) {
	return apiRequest(`/api/bot-tokens/${botId}/models`, { token })
}

export function refreshBotModels(token, botId) {
	return apiRequest(`/api/bot-tokens/${botId}/refresh-models`, {
		method: "POST",
		token,
	})
}

export function listConversations(token) {
	return apiRequest("/api/conversations", { token })
}

export function createConversation(token, botTokenId) {
	return apiRequest("/api/conversations", {
		method: "POST",
		body: { bot_token_id: botTokenId },
		token,
	})
}

export function getConversation(token, conversationId, opts = {}) {
	const params = new URLSearchParams()

	if (opts.afterId) {
		params.set("after_id", String(opts.afterId))
	}

	if (opts.limit) {
		params.set("limit", String(opts.limit))
	}

	const query = params.toString()
	const path = query
		? `/api/conversations/${conversationId}?${query}`
		: `/api/conversations/${conversationId}`

	return apiRequest(path, { token })
}

export function getConversationChannel(token, conversationId) {
	return apiRequest(`/api/conversations/${conversationId}/channel`, { token })
}

export function createConversationMessage(token, conversationId, payload) {
	return apiRequest(`/api/conversations/${conversationId}/messages`, {
		method: "POST",
		body: payload,
		token,
	})
}

export function createConversationTimeoutMessage(token, conversationId, messageId) {
	return apiRequest(`/api/conversations/${conversationId}/messages/timeout`, {
		method: "POST",
		body: { message_id: messageId },
		token,
	})
}

export function uploadConversationAsset(token, conversationId, file) {
	return uploadFile(`/api/conversations/${conversationId}/assets`, file, token)
}
