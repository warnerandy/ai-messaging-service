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

	it("renders AHP Protocol badge when bot_type is ahp", () => {
		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[]}
				selectedConversationId={null}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const badges = screen.getAllByText("AHP Protocol")
		expect(badges.length).toBeGreaterThan(0)
	})

	it("renders Chat Protocol badge when bot_type is chat", () => {
		render(
			<ChatView
				token={null}
				bot={{ name: "Chatty", bot_type: "chat", is_connected: true }}
				conversations={[]}
				selectedConversationId={null}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const badges = screen.getAllByText("Chat Protocol")
		expect(badges.length).toBeGreaterThan(0)
	})
})

describe("deriveConversationState", () => {
	it("marks only the last acknowledged user message as awaiting when no bot reply follows", () => {
		const state = deriveConversationState([
			{ id: "u-1", role: "user", acknowledged: true },
			{ id: "b-1", role: "bot" },
			{ id: "u-2", role: "user", acknowledged: true },
		])

		// u-1 already has a bot response after it (b-1), so not awaiting
		expect(state.messages[0].awaitingResponse).toBeFalsy()
		// u-2 has no bot response after it, so still awaiting
		expect(state.messages[2].awaitingResponse).toBe(true)
		expect(state.botIsTyping).toBe(true)
	})

	it("is not typing when the last message is from the bot", () => {
		const state = deriveConversationState([
			{ id: "u-1", role: "user", acknowledged: true },
			{ id: "b-1", role: "bot" },
		])

		expect(state.messages[0].awaitingResponse).toBeFalsy()
		expect(state.botIsTyping).toBe(false)
	})

	it("stops awaiting when a timeout system message exists for that user message", () => {
		const state = deriveConversationState([
			{ id: 1, role: "user", acknowledged: true },
			{
				id: 2,
				role: "system",
				content_type: "text",
				body: "The bot failed to respond.",
				metadata: { kind: "bot_timeout", timeout_for_message_id: 1 },
			},
		])

		expect(state.messages[0].awaitingResponse).toBe(false)
		expect(state.botIsTyping).toBe(false)
	})
})

describe("normalizeMessage", () => {
	it("fills in fallback fields and preserves fallback acknowledgement", () => {
		expect(normalizeMessage({ id: "m-1" }, { role: "bot", acknowledged: true })).toEqual({
			id: "m-1",
			role: "bot",
			acknowledged: true,
			timeoutReported: false,
			fromSuggestion: false,
		})
	})

	it("maps is_suggestion from API payloads into fromSuggestion", () => {
		expect(normalizeMessage({ id: "m-2", is_suggestion: true })).toEqual({
			id: "m-2",
			is_suggestion: true,
			acknowledged: false,
			timeoutReported: false,
			fromSuggestion: true,
		})
	})

	it("renders context size options when model provides context_sizes", async () => {
		const user = userEvent.setup()
		const { createConversationMessage } = await import("../lib/data.js")
		createConversationMessage.mockResolvedValueOnce({
			id: 10,
			body: "Hello context",
			role: "user",
			model: "gpt-4o",
			context_size: 32768,
			inserted_at: new Date().toISOString(),
		})

		render(
			<ChatView
				token="user-tok"
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[{ id: 1, title: "Conv 1" }]}
				selectedConversationId={1}
				models={[
					{
						name: "gpt-4o",
						context_sizes: [4096, 32768, 128000],
					},
				]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const contextSelect = screen.getByRole("combobox", { name: "Context Size" })
		expect(contextSelect).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "Default context" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: /32k/i })).toBeInTheDocument()

		await user.selectOptions(contextSelect, "32768")

		const input = screen.getByPlaceholderText("What do you want to know?")
		await user.type(input, "Hello context{enter}")

		expect(createConversationMessage).toHaveBeenCalledWith(
			"user-tok",
			1,
			expect.objectContaining({
				body: "Hello context",
				model: "gpt-4o",
				context_size: 32768,
			}),
		)
	})
})
