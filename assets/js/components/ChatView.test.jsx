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
	updateConversation: vi.fn().mockResolvedValue({}),
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
	it.each([
		["pending", null],
		["failed", "The local host rejected session creation: provider unavailable"],
	])("shows host creation %s and prevents sending to an uncreated session", (status, error) => {
		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 1,
						status: status === "pending" ? "creating" : "error",
						metadata: { creation_status: status, creation_error: error },
					},
				]}
				selectedConversationId={1}
				models={[]}
			/>,
		)
		fireEvent.change(screen.getByPlaceholderText("What do you want to know?"), {
			target: { value: "Inspect this project" },
		})
		if (error) {
			expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()
			expect(screen.getByRole("alert")).toHaveTextContent(error)
		} else {
			expect(screen.getByRole("button", { name: "Send message" })).not.toBeDisabled()
			expect(document.getElementById("session-creation-pending")).toHaveTextContent(
				"Creating the session on your local host",
			)
		}
	})

	it("shows REST session creation failures", () => {
		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot" }}
				conversations={[]}
				models={[]}
				createConversationError="The local AHP proxy is offline."
			/>,
		)
		expect(screen.getByRole("alert")).toHaveTextContent("The local AHP proxy is offline.")
	})

	it("keeps the first-prompt setup visible for newly created sessions with a host ID", () => {
		render(
			<ChatView
				token={null}
				bot={{ name: "CodeBot", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 1,
						external_session_id: "host-chat",
						status: "idle",
						metadata: { creation_status: "ready" },
					},
				]}
				selectedConversationId={1}
				models={[]}
			/>,
		)
		expect(screen.getByTestId("new-session-canvas")).toBeInTheDocument()
	})

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

		expect(screen.getAllByText("ai-messaging-service").length).toBeGreaterThanOrEqual(1)
		expect(screen.getAllByText("master").length).toBeGreaterThanOrEqual(1)
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

		expect(screen.getAllByText("Thinking").length).toBeGreaterThanOrEqual(1)
		expect(screen.getAllByText("Evaluating syntax tree").length).toBeGreaterThanOrEqual(1)
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

	it("keeps LiveThinking visible with current step when selecting an actively running session", async () => {
		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 10,
						title: "Active Migration",
						status: "running",
						metadata: { step: "Delegating task", tool: "agent" },
					},
				]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const stepElements = await screen.findAllByText("Delegating task")
		expect(stepElements.length).toBeGreaterThanOrEqual(1)
		expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(1)
		expect(screen.getByTestId("chat-steering-bar")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Steer Agent" })).toBeInTheDocument()
	})

	it("steers running agent when submitting a message in running state without sending use_worktree", async () => {
		const user = userEvent.setup()
		const { createConversationMessage } = await import("../lib/data.js")
		createConversationMessage.mockResolvedValueOnce({
			id: 20,
			body: "Focus on backend API first",
			role: "user",
			inserted_at: new Date().toISOString(),
		})

		render(
			<ChatView
				token="fake"
				bot={{
					id: 1,
					name: "Atlas",
					bot_type: "ahp",
					is_connected: true,
					metadata: { worktree_supported: true },
				}}
				conversations={[
					{
						id: 10,
						title: "Active Migration",
						status: "running",
						metadata: { step: "Delegating task", tool: "agent", use_worktree: true },
					},
				]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const textarea = screen.getByPlaceholderText(/Steer running agent with an instruction/i)
		expect(textarea).toBeInTheDocument()

		await user.type(textarea, "Focus on backend API first")
		const steerBtn = screen.getByRole("button", { name: "Steer Agent" })
		expect(steerBtn).toBeInTheDocument()
		await user.click(steerBtn)

		expect(textarea.value).toBe("")
		expect(createConversationMessage).toHaveBeenCalledWith(
			"fake",
			10,
			expect.objectContaining({
				body: "Focus on backend API first",
				metadata: expect.objectContaining({
					is_steer: true,
				}),
			}),
		)
		const lastCallPayload = createConversationMessage.mock.calls.at(-1)?.[2]
		expect(lastCallPayload.metadata.use_worktree).toBeUndefined()
		expect(lastCallPayload.metadata.useWorktree).toBeUndefined()
		expect(lastCallPayload.metadata.worktree).toBeUndefined()
	})

	it("sends use_worktree only for new sessions and omits it on existing sessions", async () => {
		const user = userEvent.setup()
		const { createConversationMessage } = await import("../lib/data.js")
		createConversationMessage.mockResolvedValueOnce({
			id: 101,
			body: "First prompt",
			role: "user",
			inserted_at: new Date().toISOString(),
		})

		const { unmount } = render(
			<ChatView
				token="fake"
				bot={{
					id: 1,
					name: "Atlas",
					bot_type: "ahp",
					is_connected: true,
					metadata: { worktree_supported: true },
				}}
				conversations={[
					{
						id: 99,
						title: "New Fresh Session",
						status: "idle",
						metadata: { use_worktree: true },
						last_message_at: null,
					},
				]}
				selectedConversationId={99}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const input = screen.getByPlaceholderText("What do you want to know?")
		await user.type(input, "First prompt{enter}")

		const firstCall = createConversationMessage.mock.calls.at(-1)?.[2]
		expect(firstCall.metadata.use_worktree).toBe(true)
		unmount()

		// Now render an existing session that already has user messages / last_message_at
		createConversationMessage.mockResolvedValueOnce({
			id: 102,
			body: "Second prompt",
			role: "user",
			inserted_at: new Date().toISOString(),
		})

		render(
			<ChatView
				token="fake"
				bot={{
					id: 1,
					name: "Atlas",
					bot_type: "ahp",
					is_connected: true,
					metadata: { worktree_supported: true },
				}}
				conversations={[
					{
						id: 99,
						title: "Existing Session",
						status: "idle",
						metadata: { use_worktree: true },
						last_message_at: "2026-11-04T05:00:00Z",
					},
				]}
				selectedConversationId={99}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const input2 = screen.getByPlaceholderText("Send an instruction or question...")
		await user.type(input2, "Second prompt{enter}")

		const secondCall = createConversationMessage.mock.calls.at(-1)?.[2]
		expect(secondCall.metadata.use_worktree).toBeUndefined()
	})

	it("treats session with historical step metadata as idle when status is idle and sends a normal prompt", async () => {
		const user = userEvent.setup()
		const { createConversationMessage } = await import("../lib/data.js")
		createConversationMessage.mockResolvedValueOnce({
			id: 202,
			body: "Normal follow-up prompt",
			role: "user",
			inserted_at: new Date().toISOString(),
		})

		render(
			<ChatView
				token="fake"
				bot={{
					id: 1,
					name: "VS Code Host",
					bot_type: "ahp",
					is_connected: true,
					metadata: { worktree_supported: true },
				}}
				conversations={[
					{
						id: 15,
						title: "Finished Migration",
						status: "idle",
						external_session_id: "ext-session-123",
						metadata: { step: "Running tests", tool: "bash", use_worktree: false },
					},
				]}
				selectedConversationId={15}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// Steering bar should NOT be in the document
		expect(screen.queryByTestId("chat-steering-bar")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Steer Agent" })).not.toBeInTheDocument()

		// Prompt input should be the normal question input (not steering)
		const input = screen.getByPlaceholderText("Send an instruction or question...")
		expect(input).toBeInTheDocument()

		await user.type(input, "Normal follow-up prompt{enter}")

		const lastCall = createConversationMessage.mock.calls.at(-1)?.[2]
		expect(lastCall.body).toBe("Normal follow-up prompt")
		// Must not be steer
		expect(lastCall.metadata?.is_steer).toBeFalsy()
		// Must not send use_worktree on existing external session
		expect(lastCall.metadata?.use_worktree).toBeUndefined()
	})

	it("dispatches expand-live-thinking when clicking View Progress in steering bar", async () => {
		const user = userEvent.setup()
		const expandListener = vi.fn()
		window.addEventListener("expand-live-thinking", expandListener)

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 10,
						title: "Active Migration",
						status: "running",
						metadata: { step: "Delegating task", tool: "agent" },
					},
				]}
				selectedConversationId={10}
				models={[]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		const viewProgressBtn = await screen.findByRole("button", { name: /View Progress/i })
		expect(viewProgressBtn).toBeInTheDocument()

		await user.click(viewProgressBtn)
		expect(expandListener).toHaveBeenCalledTimes(1)
		window.removeEventListener("expand-live-thinking", expandListener)
	})

	it("renders agent prompt controls and syncs agent mode, worktree, base branch, and agent type", async () => {
		const user = userEvent.setup()

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 10,
						title: "Active Dev Session",
						status: "idle",
						metadata: {
							agent_mode: "interactive",
							use_worktree: false,
							base_branch: "feature/login",
							agent_type: "workspace",
						},
					},
				]}
				selectedConversationId={10}
				models={[{ name: "gpt-4o" }]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// 1. Verify agent prompt controls render
		expect(screen.getByTestId("agent-prompt-controls")).toBeInTheDocument()

		// 2. Verify all modes are present and 'Interactive' is active
		const interactiveTab = screen.getByRole("tab", { name: /interactive mode/i })
		const planTab = screen.getByRole("tab", { name: /plan mode/i })
		const autopilotTab = screen.getByRole("tab", { name: /autopilot mode/i })

		expect(interactiveTab).toBeInTheDocument()
		expect(planTab).toBeInTheDocument()
		expect(autopilotTab).toBeInTheDocument()
		expect(interactiveTab).toHaveAttribute("aria-selected", "true")

		// 3. Verify Branch name is displayed
		expect(screen.getAllByText("feature/login").length).toBeGreaterThan(0)
		expect(screen.getAllByText(/Branch:/).length).toBeGreaterThan(0)

		// 4. Click 'Plan' tab and verify it becomes selected and placeholder adapts
		await user.click(planTab)
		expect(planTab).toHaveAttribute("aria-selected", "true")
		expect(
			screen.getByPlaceholderText(/Plan mode: Describe the feature or changes you want planned/i),
		).toBeInTheDocument()

		// 5. Click 'Autopilot' tab and verify it becomes selected and placeholder adapts
		await user.click(autopilotTab)
		expect(autopilotTab).toHaveAttribute("aria-selected", "true")
		expect(
			screen.getByPlaceholderText(/Autopilot mode: Describe what to build or fix autonomously/i),
		).toBeInTheDocument()
	})

	it("syncs dynamic agent modes, repository branches, and custom agent roles from the integration", async () => {
		render(
			<ChatView
				token="fake"
				bot={{
					id: 1,
					name: "Atlas",
					bot_type: "ahp",
					is_connected: true,
					metadata: {
						agent_modes: [
							{ id: "chat", label: "Interactive Assistant" },
							{ id: "audit", label: "Security Audit" },
						],
						branches: ["main", "feature/custom-sync", "hotfix/patch"],
						agent_types: [
							{ id: "sec_engineer", label: "Security Engineer", description: "Performs audit" },
						],
					},
				}}
				conversations={[
					{
						id: 11,
						title: "Security Review Session",
						status: "idle",
						metadata: {
							agent_mode: "chat",
							base_branch: "feature/custom-sync",
							agent_type: "sec_engineer",
						},
					},
				]}
				selectedConversationId={11}
				models={[{ name: "gpt-4o" }]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// 1. Dynamic modes from bot metadata
		expect(screen.getAllByText("Interactive Assistant").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Security Audit").length).toBeGreaterThan(0)

		// 2. Custom agent type from bot metadata
		expect(screen.getAllByText("Security Engineer").length).toBeGreaterThan(0)

		// 3. Branches from repository in popover
		fireEvent.click(screen.getByLabelText(/configure working branch and worktree/i))
		expect(screen.getByRole("button", { name: /hotfix\/patch/i })).toBeInTheDocument()
	})

	it("does not send update_session_config or updateConversation when selecting options on a new session", async () => {
		const user = userEvent.setup()
		const data = await import("../lib/data.js")
		data.updateConversation.mockClear()

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 12,
						title: "Brand New Task",
						status: "idle",
						metadata: {},
					},
				]}
				selectedConversationId={12}
				models={[{ name: "gpt-4o" }]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// Click Plan tab
		const planTab = screen.getByRole("tab", { name: /plan mode/i })
		await user.click(planTab)
		expect(planTab).toHaveAttribute("aria-selected", "true")

		// Click Autopilot tab
		const autopilotTab = screen.getByRole("tab", { name: /autopilot mode/i })
		await user.click(autopilotTab)
		expect(autopilotTab).toHaveAttribute("aria-selected", "true")

		// Verify updateConversation was NOT called over the wire
		expect(data.updateConversation).not.toHaveBeenCalled()
	})

	it("does not open agent inspector panel on load on mobile viewports", async () => {
		const user = userEvent.setup()
		const originalInnerWidth = window.innerWidth
		try {
			// Simulate mobile viewport width
			window.innerWidth = 390

			render(
				<ChatView
					token="fake"
					bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
					conversations={[
						{
							id: 13,
							title: "Mobile Task",
							status: "idle",
							metadata: {},
						},
					]}
					selectedConversationId={13}
					models={[{ name: "gpt-4o" }]}
					onRefreshModels={vi.fn()}
					onBotStatusChange={vi.fn()}
					onToggleSidebar={vi.fn()}
				/>,
			)

			// Inspector pane should NOT be present on mobile load
			expect(screen.queryByTestId("agent-inspector-pane")).not.toBeInTheDocument()

			// User can open it on demand by clicking the header toggle button
			const toggleBtn = screen.getByTestId("toggle-inspector-btn")
			await user.click(toggleBtn)

			expect(screen.getByTestId("agent-inspector-pane")).toBeInTheDocument()
		} finally {
			window.innerWidth = originalInnerWidth
		}
	})

	it("does not render NewSessionCanvas for an existing running session with 0 messages", async () => {
		const { getConversation } = await import("../lib/data.js")
		getConversation.mockResolvedValueOnce({
			conversation: {
				id: 631,
				title: "Plan Groups React migration",
				status: "running",
				external_session_id: "vscode:12345",
				metadata: { agent_mode: "plan" },
			},
			messages: [],
		})

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 631,
						title: "Plan Groups React migration",
						status: "running",
						external_session_id: "vscode:12345",
						metadata: { agent_mode: "plan" },
					},
				]}
				selectedConversationId={631}
				models={[{ name: "gpt-4o" }]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// NewSessionCanvas should NOT be rendered
		expect(screen.queryByTestId("new-session-canvas")).not.toBeInTheDocument()
		expect(screen.queryByText(/Direct Branch/i)).not.toBeInTheDocument()

		// LiveThinking card should be present because session status is running
		expect(await screen.findByTestId("live-thinking-card")).toBeInTheDocument()
		expect(
			screen.getByPlaceholderText("Steer running agent with an instruction..."),
		).toBeInTheDocument()
	})

	it("renders empty existing session placeholder for an idle session with external_session_id and 0 messages", async () => {
		const { getConversation } = await import("../lib/data.js")
		getConversation.mockResolvedValueOnce({
			conversation: {
				id: 632,
				title: "Synced Idle Session",
				status: "idle",
				external_session_id: "vscode:999",
				metadata: {},
			},
			messages: [],
		})

		render(
			<ChatView
				token="fake"
				bot={{ id: 1, name: "Atlas", bot_type: "ahp", is_connected: true }}
				conversations={[
					{
						id: 632,
						title: "Synced Idle Session",
						status: "idle",
						external_session_id: "vscode:999",
						metadata: {},
					},
				]}
				selectedConversationId={632}
				models={[{ name: "gpt-4o" }]}
				onRefreshModels={vi.fn()}
				onBotStatusChange={vi.fn()}
				onToggleSidebar={vi.fn()}
			/>,
		)

		// NewSessionCanvas should NOT be rendered
		expect(screen.queryByTestId("new-session-canvas")).not.toBeInTheDocument()

		// Empty existing session placeholder should be rendered
		const emptyPlaceholder = await screen.findByTestId("chat-empty-existing-session")
		expect(emptyPlaceholder).toBeInTheDocument()
		expect(emptyPlaceholder).toHaveTextContent("Synced Idle Session")
		expect(screen.getByPlaceholderText("Send an instruction or question...")).toBeInTheDocument()
	})
})
