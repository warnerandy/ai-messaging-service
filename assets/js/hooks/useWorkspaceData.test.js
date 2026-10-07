import { renderHook, waitFor } from "@testing-library/react"
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
})
