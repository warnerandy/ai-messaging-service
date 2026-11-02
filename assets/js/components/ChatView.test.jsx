import React, { act } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ChatView, { deriveConversationState, normalizeMessage } from "./ChatView.jsx"

vi.mock("phoenix", () => ({
	Socket: class Socket {
		connect() {}
		disconnect() {}
		channel() {
			return {
				join: () => ({ receive: () => ({ receive: () => {} }) }),
				leave: () => {},
				on: () => {},
				push: () => {},
			}
		}
	},
}))

vi.mock("../lib/data.js", () => ({
	createConversationMessage: vi.fn(),
	getConversation: vi.fn(),
	getConversationChannel: vi.fn(),
	uploadConversationAsset: vi.fn(),
}))

vi.mock("../lib/notifications.js", () => ({
	notifyBotResponse: vi.fn(),
	notifySessionCompleted: vi.fn(),
	notifyWaitingForInput: vi.fn(),
	requestNotificationPermission: vi.fn(),
	getNotificationPermission: vi.fn(() => "granted"),
	isNotificationSupported: vi.fn(() => true),
	isVibrationSupported: vi.fn(() => true),
	showNotificationIfBackgrounded: vi.fn(),
	isSessionAlarmEnabled: vi.fn((id) => id === 99),
	toggleSessionAlarm: vi.fn(() => true),
	unlockAudio: vi.fn(),
	playAlarmChime: vi.fn(),
	playConfirmationPing: vi.fn(),
	triggerAlarmVibration: vi.fn(),
	triggerConfirmationVibration: vi.fn(),
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

	it("renders project badge with name and branch in header", () => {
		const conversation = {
			id: 1,
			title: "Working on Feature X",
			status: "idle",
			metadata: {
				project: {
					name: "ai-messaging-service",
					uri: "file:///workspace/ai-messaging-service",
					branch: "master",
				},
			},
		}

		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[conversation]}
				selectedConversationId={1}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		expect(screen.getByText("ai-messaging-service")).toBeInTheDocument()
		expect(screen.getByText("master")).toBeInTheDocument()
	})

	it("opens project info modal when clicking project badge", async () => {
		const user = userEvent.setup()
		const conversation = {
			id: 2,
			title: "Project Chat",
			status: "idle",
			metadata: {
				project: {
					name: "my-web-app",
					branch: "feat/header",
					path: "/home/user/my-web-app",
				},
			},
		}

		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[conversation]}
				selectedConversationId={2}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const projectBadge = screen.getByRole("button", { name: /Project: my-web-app/i })
		await user.click(projectBadge)

		expect(screen.getByRole("dialog")).toBeInTheDocument()
		expect(screen.getByText("Project & Workspace Info")).toBeInTheDocument()
		expect(screen.getByText("/home/user/my-web-app")).toBeInTheDocument()
	})

	it("renders LiveThinking component when entering a chat with thinking status", () => {
		const conversation = {
			id: 3,
			title: "Analyzing Algorithm",
			status: "thinking",
			metadata: {
				step: "Evaluating syntax tree",
				thinking: "Processing AST nodes...",
			},
		}

		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[conversation]}
				selectedConversationId={3}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		expect(screen.getByText("Thinking")).toBeInTheDocument()
		expect(screen.getByText("Evaluating syntax tree")).toBeInTheDocument()
		expect(screen.getByText("Processing AST nodes...")).toBeInTheDocument()
		// Generic typing dots indicator should NOT be rendered when thinking is active
		expect(screen.queryByText(/Bot has been thinking for/i)).not.toBeInTheDocument()
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
		expect(screen.getByRole("option", { name: /33k/i })).toBeInTheDocument()

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

	it("renders notification button in topbar and requests permission on click", async () => {
		const user = userEvent.setup()
		const { requestNotificationPermission } = await import("../lib/notifications.js")

		render(
			<ChatView
				token={null}
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[]}
				selectedConversationId={null}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const notifBtn = screen.getByRole("button", { name: /notifications/i })
		expect(notifBtn).toBeInTheDocument()

		await user.click(notifBtn)
		expect(requestNotificationPermission).toHaveBeenCalled()
	})

	it("reflects session alarm state when switching sessions and toggles alarm on click", async () => {
		const user = userEvent.setup()
		const { toggleSessionAlarm, unlockAudio } = await import("../lib/notifications.js")

		const { rerender } = render(
			<ChatView
				token="fake"
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[{ id: 99, title: "Armed Session" }]}
				selectedConversationId={99}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// Session 99 is armed in the mock (id === 99)
		const armedBtn = screen.getByRole("button", { name: /notifications/i })
		expect(armedBtn).toHaveClass("notification-toggle-btn--armed")

		await user.click(armedBtn)
		expect(unlockAudio).toHaveBeenCalled()
		expect(toggleSessionAlarm).toHaveBeenCalledWith(99)

		// Switch to session 100 which is not armed in the mock
		rerender(
			<ChatView
				token="fake"
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[
					{ id: 99, title: "Armed Session" },
					{ id: 100, title: "Unarmed Session" },
				]}
				selectedConversationId={100}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const disarmedBtn = screen.getByRole("button", { name: /notifications/i })
		expect(disarmedBtn).toHaveClass("notification-toggle-btn--disarmed")
	})

	it("renders sync button in topbar and triggers sync on click", async () => {
		const user = userEvent.setup()
		const { getConversation } = await import("../lib/data.js")
		getConversation.mockResolvedValueOnce({
			messages: [],
			conversation: { id: 10, status: "idle" },
		})

		render(
			<ChatView
				token="fake"
				bot={{ name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Active Session" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const syncBtn = screen.getByRole("button", { name: /sync session/i })
		expect(syncBtn).toBeInTheDocument()

		await user.click(syncBtn)
		expect(getConversation).toHaveBeenCalledWith("fake", 10)
	})

	it("renders safely without crashing when bot is null or loading", () => {
		render(
			<ChatView
				token="fake"
				bot={null}
				conversations={[]}
				selectedConversationId={null}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		expect(screen.getByText("Select or create a bot to start chatting.")).toBeInTheDocument()
	})

	it("does not render standalone sparkle icon in topbar and opens SettingsModal when clicking gear button", async () => {
		const user = userEvent.setup()

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Active Session" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// Sparkle gallery icon is removed from topbar to save horizontal space
		expect(
			screen.queryByRole("button", { name: "VS Code Working States Gallery" }),
		).not.toBeInTheDocument()

		// Gear button is present and opens bot configuration modal
		const configBtn = screen.getByRole("button", {
			name: "Bot Configuration & Connection Details",
		})
		expect(configBtn).toBeInTheDocument()

		await user.click(configBtn)
		expect(screen.getByText("Bot Configuration")).toBeInTheDocument()
		expect(screen.getByText("WebSocket Service URL")).toBeInTheDocument()
		expect(screen.getByText("Bot Secret Token")).toBeInTheDocument()
	})

	it("opens SettingsModal when open-settings window event is dispatched", async () => {
		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Active Session" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		await act(async () => {
			window.dispatchEvent(new CustomEvent("open-settings", { detail: { tab: "states" } }))
		})

		expect(await screen.findByText("Settings & AHP Statuses")).toBeInTheDocument()
		expect(screen.getByText("Waiting for Input / Approval")).toBeInTheDocument()
		expect(screen.getByText("VS Code Working State Icons")).toBeInTheDocument()
	})

	it("renders archive button and calls onArchiveConversation when clicked", async () => {
		const user = userEvent.setup()
		const onArchive = vi.fn()

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Active Session", status: "idle" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
				onArchiveConversation={onArchive}
			/>,
		)

		const archiveBtn = screen.getByRole("button", { name: "Archive / mark chat as done" })
		expect(archiveBtn).toBeInTheDocument()

		await user.click(archiveBtn)
		expect(onArchive).toHaveBeenCalledWith(10)
	})

	it("renders archived badge, banner, and close button when active conversation is archived", async () => {
		const user = userEvent.setup()
		const onSelect = vi.fn()

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Finished Task", status: "archived" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
				onSelectConversation={onSelect}
			/>,
		)

		expect(screen.getByText("✓ Archived")).toBeInTheDocument()
		expect(screen.getByText("(Archived)")).toBeInTheDocument()
		expect(screen.getByText(/This session is archived/i)).toBeInTheDocument()

		const closeBtn = screen.getByRole("button", { name: "Close session" })
		await user.click(closeBtn)
		expect(onSelect).toHaveBeenCalledWith(null)
	})

	it("preserves scroll position when user has scrolled up and does not snap to bottom", async () => {
		const { container } = render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", is_connected: true }}
				conversations={[{ id: 10, title: "Active Session", status: "idle" }]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const messagesContainer = container.querySelector(".chat-messages")
		expect(messagesContainer).toBeInTheDocument()

		// Simulate user scrolling up
		Object.defineProperty(messagesContainer, "scrollHeight", { value: 1000, configurable: true })
		Object.defineProperty(messagesContainer, "clientHeight", { value: 400, configurable: true })
		Object.defineProperty(messagesContainer, "scrollTop", {
			value: 200,
			writable: true,
			configurable: true,
		})

		fireEvent.scroll(messagesContainer)

		// Verify scrollTop was not yanked to scrollHeight (1000)
		expect(messagesContainer.scrollTop).toBe(200)
	})
})
