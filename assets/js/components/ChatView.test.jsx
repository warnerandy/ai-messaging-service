import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ChatView, { deriveConversationState, normalizeMessage } from "./ChatView.jsx"

vi.mock("phoenix", () => ({
	Socket: class Socket {},
}))

vi.mock("../lib/data.js", () => ({
	createConversationMessage: vi.fn(),
	getConversation: vi.fn(),
	getConversationChannel: vi.fn(),
	uploadConversationAsset: vi.fn(),
}))

vi.mock("../lib/notifications.js", () => ({
	showNotificationIfBackgrounded: vi.fn(),
}))

vi.mock("../thinkingTimer.mjs", () => ({
	startThinkingTimer: vi.fn(),
	stopThinkingTimer: vi.fn(),
}))

describe("ChatView", () => {
	it("renders the chat shell without a selected conversation", async () => {
		const user = userEvent.setup()
		const onToggleSidebar = vi.fn()

		render(
			<ChatView
				token={null}
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[]}
				selectedConversationId={null}
				onSelectConversation={vi.fn()}
				onCreateConversation={vi.fn()}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={onToggleSidebar}
			/>,
		)

		expect(screen.getByText(/Start a conversation with/i)).toBeInTheDocument()
		expect(screen.getByPlaceholderText("What do you want to know?")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Toggle sidebar" }))
		expect(onToggleSidebar).toHaveBeenCalledTimes(1)
	})
})

describe("deriveConversationState", () => {
	it("tracks awaiting user messages after a bot turn", () => {
		const state = deriveConversationState([
			{ id: "u-1", role: "user", acknowledged: true },
			{ id: "b-1", role: "bot" },
			{ id: "u-2", role: "user", acknowledged: true },
		])

		expect(state.messages[0].awaitingResponse).toBe(true)
		expect(state.messages[2].awaitingResponse).toBe(true)
		expect(state.botIsTyping).toBe(true)
	})
})

describe("normalizeMessage", () => {
	it("fills in fallback fields and preserves fallback acknowledgement", () => {
		expect(normalizeMessage({ id: "m-1" }, { role: "bot", acknowledged: true })).toEqual({
			id: "m-1",
			role: "bot",
			acknowledged: true,
			fromSuggestion: false,
		})
	})

	it("maps is_suggestion from API payloads into fromSuggestion", () => {
		expect(normalizeMessage({ id: "m-2", is_suggestion: true })).toEqual({
			id: "m-2",
			is_suggestion: true,
			acknowledged: false,
			fromSuggestion: true,
		})
	})
})
