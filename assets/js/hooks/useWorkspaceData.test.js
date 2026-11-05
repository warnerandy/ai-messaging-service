import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWorkspaceData } from "./useWorkspaceData.js"
import {
	createConversation,
	listBotModels,
	listBots,
	listConversations,
	pingApp,
	refreshBotModels,
	deleteBot,
} from "../lib/data.js"
import { registerServiceWorker, requestNotificationPermission } from "../lib/notifications.js"

vi.mock("../lib/data.js", () => ({
	createConversation: vi.fn(),
	deleteBot: vi.fn(),
	listBotModels: vi.fn(),
	listBots: vi.fn(),
	listConversations: vi.fn(),
	pingApp: vi.fn(),
	refreshBotModels: vi.fn(),
}))

vi.mock("../lib/notifications.js", () => ({
	registerServiceWorker: vi.fn(),
	requestNotificationPermission: vi.fn(),
	initNotificationListeners: vi.fn(() => vi.fn()),
	notifySessionCompleted: vi.fn(),
	notifyWaitingForInput: vi.fn(),
}))

const mockChannel = {
	join: vi.fn().mockReturnValue({
		receive: vi.fn().mockReturnThis(),
	}),
	leave: vi.fn(),
	on: vi.fn(),
}

const mockSocket = {
	connect: vi.fn(),
	disconnect: vi.fn(),
	channel: vi.fn().mockReturnValue(mockChannel),
}

vi.mock("phoenix", () => ({
	Socket: vi.fn(function () {
		return mockSocket
	}),
}))

describe("useWorkspaceData", () => {
	beforeEach(() => {
		localStorage.clear()
		vi.mocked(createConversation).mockReset()
		vi.mocked(deleteBot).mockReset()
		vi.mocked(listBotModels).mockReset()
		vi.mocked(listBots).mockReset()
		vi.mocked(listConversations).mockReset()
		vi.mocked(pingApp).mockReset()
		vi.mocked(refreshBotModels).mockReset()
		vi.mocked(registerServiceWorker).mockReset()
		vi.mocked(requestNotificationPermission).mockReset()
		mockChannel.on.mockReset()
	})

	it("creates the first conversation using the selected bot name", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		listBots.mockResolvedValue({
			bot_tokens: [{ id: "bot-1", name: "Atlas", is_connected: true }],
		})
		listBotModels.mockResolvedValue({ models: [] })
		listConversations.mockResolvedValue({ conversations: [] })
		pingApp.mockResolvedValue({})
		createConversation.mockResolvedValue({ id: "conversation-1", title: "Atlas" })

		renderHook(() => useWorkspaceData())

		await waitFor(() => {
			expect(createConversation).toHaveBeenCalledWith("token-1", "bot-1", "Atlas")
		})
	})

	it("restores saved bot and conversation from localStorage", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		localStorage.setItem("messaging.selected.bot_id", "2")
		localStorage.setItem("messaging.selected.conversation_id", "20")

		listBots.mockResolvedValue({
			bot_tokens: [
				{ id: 1, name: "Bot1", is_connected: true },
				{ id: 2, name: "Bot2", is_connected: true },
			],
		})
		listBotModels.mockResolvedValue({ models: [] })
		listConversations.mockResolvedValue({
			conversations: [
				{ id: 10, bot_token_id: 2, title: "Old chat" },
				{ id: 20, bot_token_id: 2, title: "Saved chat" },
			],
		})
		pingApp.mockResolvedValue({})

		const { result } = renderHook(() => useWorkspaceData())

		await waitFor(() => {
			expect(result.current.selectedBotId).toBe(2)
			expect(result.current.selectedConversationId).toBe(20)
		})
	})

	it("coalesces duplicate AHP session rows and keeps the newest status", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		localStorage.setItem("messaging.selected.bot_id", "2")

		listBots.mockResolvedValue({
			bot_tokens: [{ id: 2, name: "Bot2", is_connected: true }],
		})
		listBotModels.mockResolvedValue({ models: [] })
		listConversations.mockResolvedValue({
			conversations: [
				{
					id: 20,
					bot_token_id: 2,
					external_session_id: "agent-session-1",
					title: "Fix shared-volume race",
					status: "running",
					updated_at: "2026-11-04T10:00:00Z",
				},
				{
					id: 21,
					bot_token_id: 2,
					external_session_id: "ahp-session:/agent-session-1",
					title: "Fix shared-volume race",
					status: "idle",
					updated_at: "2026-11-04T11:00:00Z",
				},
			],
		})
		pingApp.mockResolvedValue({})

		const { result } = renderHook(() => useWorkspaceData())

		await waitFor(() => {
			expect(result.current.conversations).toHaveLength(1)
			expect(result.current.conversations[0].status).toBe("idle")
			expect(result.current.conversations[0].id).toBe(21)
		})
	})

	it("excludes confirmed subagents without merging distinct primary chats", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		localStorage.setItem("messaging.selected.bot_id", "2")
		listBots.mockResolvedValue({
			bot_tokens: [{ id: 2, name: "Bot2", is_connected: true }],
		})
		listBotModels.mockResolvedValue({ models: [] })
		listConversations.mockResolvedValue({
			conversations: [
				{
					id: 20,
					bot_token_id: 2,
					external_session_id: "ahp-chat://default/one",
					title: "Main one",
				},
				{
					id: 21,
					bot_token_id: 2,
					external_session_id: "ahp-chat://default/two",
					title: "Main two",
				},
				{
					id: 22,
					bot_token_id: 2,
					external_session_id: "ahp-chat://subagent/one/worker",
					title: "Worker",
				},
				{ id: 23, bot_token_id: 2, external_session_id: "worker", metadata: { is_subagent: true } },
			],
		})
		pingApp.mockResolvedValue({})
		const { result } = renderHook(() => useWorkspaceData())
		await waitFor(() => {
			expect(result.current.conversations.map((session) => session.id)).toEqual([20, 21])
		})
	})

	it.each([{ status: "archived" }, { status: "running", metadata: { is_subagent: true } }])(
		"removes sessions immediately after visibility changes: %j",
		async (update) => {
			localStorage.setItem("messaging.user.token", "token-1")
			localStorage.setItem("messaging.selected.bot_id", "2")
			listBots.mockResolvedValue({
				bot_tokens: [{ id: 2, name: "Bot2", is_connected: true }],
			})
			listBotModels.mockResolvedValue({ models: [] })
			listConversations.mockResolvedValue({
				conversations: [
					{ id: 20, bot_token_id: 2, title: "Main", status: "running" },
					{ id: 21, bot_token_id: 2, title: "Worker", status: "running" },
				],
			})
			pingApp.mockResolvedValue({})
			const handlers = {}
			mockChannel.on.mockImplementation((event, handler) => {
				handlers[event] = handler
			})
			const { result } = renderHook(() => useWorkspaceData())
			await waitFor(() => expect(result.current.conversations).toHaveLength(2))

			act(() => handlers.session_status_changed({ conversation_id: 21, ...update }))
			expect(result.current.conversations.map((session) => session.id)).toEqual([20])

			act(() =>
				handlers.conversation_created({
					conversation: {
						id: 22,
						external_session_id: "ahp-chat://subagent/main/worker",
						status: "running",
					},
				}),
			)
			expect(result.current.conversations.map((session) => session.id)).toEqual([20])
		},
	)

	it("removes omitted sessions when a complete active-session snapshot arrives", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		localStorage.setItem("messaging.selected.bot_id", "2")
		listBots.mockResolvedValue({
			bot_tokens: [{ id: 2, name: "Bot2", is_connected: true }],
		})
		listBotModels.mockResolvedValue({ models: [] })
		const main = { id: 20, bot_token_id: 2, title: "Main", status: "running" }
		listConversations.mockResolvedValue({
			conversations: [main, { id: 21, bot_token_id: 2, title: "Worker", status: "running" }],
		})
		pingApp.mockResolvedValue({})
		const handlers = {}
		mockChannel.on.mockImplementation((event, handler) => {
			handlers[event] = handler
		})
		const { result } = renderHook(() => useWorkspaceData())
		await waitFor(() => expect(result.current.conversations).toHaveLength(2))

		act(() => handlers.bot_sessions_updated({ bot_token_id: 2, sessions: [main] }))
		expect(result.current.conversations.map((session) => session.id)).toEqual([20])

		act(() => handlers.bot_sessions_updated({ bot_token_id: 2, sessions: [] }))
		expect(result.current.conversations).toEqual([])
	})

	it("updates conversation status in real-time when session_status_changed is received", async () => {
		localStorage.setItem("messaging.user.token", "token-1")
		localStorage.setItem("messaging.selected.bot_id", "2")
		localStorage.setItem("messaging.selected.conversation_id", "20")

		listBots.mockResolvedValue({
			bot_tokens: [{ id: 2, name: "Bot2", is_connected: true }],
		})
		listBotModels.mockResolvedValue({ models: [] })
		listConversations.mockResolvedValue({
			conversations: [{ id: 20, bot_token_id: 2, title: "Chat", status: "idle" }],
		})
		pingApp.mockResolvedValue({})

		let statusHandler = null
		mockChannel.on.mockImplementation((event, handler) => {
			if (event === "session_status_changed") {
				statusHandler = handler
			}
		})

		const { result } = renderHook(() => useWorkspaceData())

		await waitFor(() => {
			expect(result.current.conversations).toHaveLength(1)
			expect(result.current.conversations[0].status).toBe("idle")
		})

		expect(statusHandler).toBeDefined()

		// Simulate real-time socket event
		statusHandler({
			conversation_id: 20,
			status: "running",
			metadata: { step: "Analyzing files" },
		})

		await waitFor(() => {
			const updated = result.current.conversations.find((c) => c.id === 20)
			expect(updated.status).toBe("running")
			expect(updated.metadata?.step).toBe("Analyzing files")
		})

		// Transition to waiting_for_input
		statusHandler({
			conversation_id: 20,
			status: "waiting_for_input",
			metadata: { question: { prompt: "Approve deploy?" } },
		})

		const { notifyWaitingForInput, notifySessionCompleted } =
			await import("../lib/notifications.js")
		expect(notifyWaitingForInput).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: 20,
				question: { prompt: "Approve deploy?" },
			}),
		)

		// Transition from running to idle / completed
		statusHandler({
			conversation_id: 20,
			status: "completed",
			metadata: { step: "Deploy finished" },
		})

		expect(notifySessionCompleted).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: 20,
				metadata: { step: "Deploy finished" },
			}),
		)
	})
})
