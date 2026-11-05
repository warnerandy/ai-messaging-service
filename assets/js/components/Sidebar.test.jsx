import React from "react"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Sidebar, {
	formatCompactRelativeTime,
	getSessionSubtitle,
	isSessionActive,
	isSessionDone,
	isSessionOlderThanDays,
	sortConversations,
	groupSessionsByProject,
	formatSessionTitle,
	getConversationUpdatedTimestamp,
	isSessionNested,
	getParentSessionId,
	findParentSession,
	orderSessionsHierarchically,
	getSessionDisplayTooltip,
} from "./Sidebar.jsx"
import { createBot } from "../lib/data.js"

vi.mock("../lib/data.js", () => ({
	createBot: vi.fn(),
}))

vi.mock("./BotTokenReveal.jsx", () => ({
	default: ({ token, onDismiss }) => (
		<div data-testid="bot-token-reveal">
			<span>{token}</span>
			<button type="button" onClick={onDismiss}>
				Dismiss token
			</button>
		</div>
	),
}))

describe("Sidebar", () => {
	beforeEach(() => {
		createBot.mockReset()
	})

	it("creates a bot and refreshes the bot list via modal", async () => {
		const user = userEvent.setup()
		const onBotsChange = vi.fn().mockResolvedValue(undefined)
		const onSelectBot = vi.fn()
		createBot.mockResolvedValue({ id: "bot-2", token: "bot-token-2" })

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={onSelectBot}
				onBotsChange={onBotsChange}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Add bot" }))
		expect(screen.getByText("Create New Bot")).toBeInTheDocument()
		await user.type(screen.getByPlaceholderText("Bot name…"), "Helper Bot")
		await user.click(screen.getByRole("button", { name: "Create Bot" }))

		await waitFor(() => {
			expect(createBot).toHaveBeenCalledWith("token-1", "Helper Bot", "chat")
			expect(onBotsChange).toHaveBeenCalledTimes(1)
			expect(onSelectBot).toHaveBeenCalledWith("bot-2")
		})
		expect(screen.getByTestId("bot-token-reveal")).toHaveTextContent("bot-token-2")
	})

	it("creates an AHP agent bot when AHP type is selected in modal", async () => {
		const user = userEvent.setup()
		const onBotsChange = vi.fn().mockResolvedValue(undefined)
		const onSelectBot = vi.fn()
		createBot.mockResolvedValue({ id: "bot-3", token: "bot-token-3" })

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={onSelectBot}
				onBotsChange={onBotsChange}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Add bot" }))
		await user.type(screen.getByPlaceholderText("Bot name…"), "Coding Worker")
		await user.click(screen.getByText("AHP Agent"))
		await user.click(screen.getByRole("button", { name: "Create Bot" }))

		await waitFor(() => {
			expect(createBot).toHaveBeenCalledWith("token-1", "Coding Worker", "ahp")
			expect(onBotsChange).toHaveBeenCalledTimes(1)
			expect(onSelectBot).toHaveBeenCalledWith("bot-3")
		})
	})

	it("closes the create bot modal when cancel is clicked", async () => {
		const user = userEvent.setup()

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Add bot" }))
		expect(screen.getByText("Create New Bot")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Cancel" }))
		expect(screen.queryByText("Create New Bot")).not.toBeInTheDocument()
	})

	it("confirms bot deletion before calling the handler", async () => {
		const user = userEvent.setup()
		const onDeleteBot = vi.fn().mockResolvedValue(undefined)

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={onDeleteBot}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Delete Alpha" }))
		expect(screen.getByText("Delete Bot")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Delete" }))

		await waitFor(() => {
			expect(onDeleteBot).toHaveBeenCalledWith("bot-1")
		})
	})

	it("renders conversations and calls onSelectConversation and onCreateConversation", async () => {
		const user = userEvent.setup()
		const onSelectConversation = vi.fn()
		const onCreateConversation = vi.fn()

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={[
					{ id: "conv-1", title: "Project Discussion" },
					{ id: "conv-2", title: "Bug Analysis" },
				]}
				selectedConversationId="conv-1"
				onSelectBot={vi.fn()}
				onSelectConversation={onSelectConversation}
				onCreateConversation={onCreateConversation}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		expect(screen.getByText("Project Discussion")).toBeInTheDocument()
		expect(screen.getByText("Bug Analysis")).toBeInTheDocument()

		await user.click(screen.getByText("Bug Analysis"))
		expect(onSelectConversation).toHaveBeenCalledWith("conv-2")

		await user.click(screen.getByRole("button", { name: "New conversation" }))
		expect(onCreateConversation).toHaveBeenCalledTimes(1)
	})

	describe("sortConversations helper", () => {
		it("detects active sessions correctly", () => {
			expect(isSessionActive({ status: "running" })).toBe(true)
			expect(isSessionActive({ status: "waiting_for_input" })).toBe(true)
			expect(isSessionActive({ status: "needs_input" })).toBe(true)
			expect(isSessionActive({ status: "thinking" })).toBe(true)
			expect(isSessionActive({ status: "active" })).toBe(true)
			expect(isSessionActive({ status: "idle", unread: true })).toBe(true)
			expect(isSessionActive({ status: "idle", unread_count: 2 })).toBe(true)
			expect(isSessionActive({ status: "idle", metadata: { unread: true } })).toBe(true)

			expect(isSessionActive({ status: "idle" })).toBe(false)
			expect(isSessionActive({ status: "completed" })).toBe(false)
			expect(isSessionActive({ status: "archived" })).toBe(false)
			expect(isSessionActive(null)).toBe(false)
		})

		it("sorts active sessions above idle sessions and by last used within groups", () => {
			const sessions = [
				{ id: 1, title: "Idle Old", status: "idle", updated_at: "2026-10-07T08:00:00Z" },
				{ id: 2, title: "Running Task", status: "running", updated_at: "2026-10-07T09:00:00Z" },
				{
					id: 3,
					title: "Needs Input",
					status: "waiting_for_input",
					updated_at: "2026-10-07T07:00:00Z",
				},
				{ id: 4, title: "Idle Recent", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{ id: 5, title: "Thinking", status: "thinking", updated_at: "2026-10-07T09:30:00Z" },
			]

			const sorted = sortConversations(sessions, true)
			expect(sorted.map((s) => s.id)).toEqual([3, 5, 2, 4, 1])
		})

		it("sorts unread sessions above idle sessions", () => {
			const sessions = [
				{ id: 1, title: "Idle", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{
					id: 2,
					title: "Unread",
					status: "idle",
					unread: true,
					updated_at: "2026-10-07T08:00:00Z",
				},
			]

			const sorted = sortConversations(sessions, true)
			expect(sorted.map((s) => s.id)).toEqual([2, 1])
		})

		it("keeps idle sessions in a stable fixed order even when background updated_at changes", () => {
			const sessionsInitial = [
				{ id: 10, title: "Session A", status: "idle", updated_at: "2026-10-07T11:00:00Z" },
				{ id: 9, title: "Session B", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{ id: 8, title: "Session C", status: "idle", updated_at: "2026-10-07T09:00:00Z" },
			]
			const sortedInitial = sortConversations(sessionsInitial, true)
			expect(sortedInitial.map((s) => s.id)).toEqual([10, 9, 8])

			// Background sync touches Session C with a newer updated_at timestamp:
			const sessionsAfterBackgroundSync = [
				{ id: 10, title: "Session A", status: "idle", updated_at: "2026-10-07T11:00:00Z" },
				{ id: 9, title: "Session B", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{ id: 8, title: "Session C", status: "idle", updated_at: "2026-10-07T11:05:00Z" },
			]
			const sortedAfter = sortConversations(sessionsAfterBackgroundSync, true)
			// Must stay in stable fixed order and not reorder Session C to the top
			expect(sortedAfter.map((s) => s.id)).toEqual([10, 9, 8])
		})
	})

	it("renders AHP sessions sorted with active above idle and by last used", () => {
		const now = Date.now()
		const sessions = [
			{
				id: "s-1",
				title: "Idle Earlier",
				status: "idle",
				updated_at: new Date(now - 3 * 3600 * 1000).toISOString(),
			},
			{
				id: "s-2",
				title: "Running Job",
				status: "running",
				updated_at: new Date(now - 2 * 3600 * 1000).toISOString(),
			},
			{
				id: "s-3",
				title: "Needs Action",
				status: "waiting_for_input",
				updated_at: new Date(now - 4 * 3600 * 1000).toISOString(),
			},
			{
				id: "s-4",
				title: "Idle Latest",
				status: "idle",
				updated_at: new Date(now - 1 * 3600 * 1000).toISOString(),
			},
		]

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-ahp", name: "Worker Bot", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-ahp"
				conversations={sessions}
				selectedConversationId="s-2"
				onSelectBot={vi.fn()}
				onSelectConversation={vi.fn()}
				onCreateConversation={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		const items = screen.getAllByRole("button", { name: /Session|Idle|Running|Needs/i })
		const itemTexts = items.map((el) => el.textContent)

		// Needs Action should be before Running Job, which should be before Idle Latest, which should be before Idle Earlier
		const needsIndex = itemTexts.findIndex((t) => t.includes("Needs Action"))
		const runningIndex = itemTexts.findIndex((t) => t.includes("Running Job"))
		const idleLatestIndex = itemTexts.findIndex((t) => t.includes("Idle Latest"))
		const idleEarlierIndex = itemTexts.findIndex((t) => t.includes("Idle Earlier"))

		expect(needsIndex).toBeLessThan(runningIndex)
		expect(runningIndex).toBeLessThan(idleLatestIndex)
		expect(idleLatestIndex).toBeLessThan(idleEarlierIndex)
	})

	it("renders action icons for active sessions without text labels", () => {
		const sessions = [
			{ id: "s-1", title: "Task 1", status: "running" },
			{ id: "s-2", title: "Task 2", status: "waiting_for_input" },
			{ id: "s-3", title: "Task 3", status: "thinking" },
		]

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId="s-1"
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		// Icons should have aria-label / title attributes
		expect(screen.getByLabelText("Running")).toBeInTheDocument()
		expect(screen.getByLabelText("Needs input")).toBeInTheDocument()
		expect(screen.getByLabelText("Thinking")).toBeInTheDocument()

		// Should not display literal label words inside the pills next to the icons
		expect(screen.queryByText("Needs Input")).not.toBeInTheDocument()
	})

	describe("formatCompactRelativeTime", () => {
		const now = new Date("2026-10-07T12:00:00Z").getTime()

		it("formats seconds to now", () => {
			const conv = { updated_at: "2026-10-07T11:59:45Z" }
			expect(formatCompactRelativeTime(conv, now)).toBe("now")
		})

		it("formats minutes like 30m", () => {
			const conv = { updated_at: "2026-10-07T11:30:00Z" }
			expect(formatCompactRelativeTime(conv, now)).toBe("30m")
		})

		it("formats hours like 24h", () => {
			const conv = { updated_at: "2026-10-06T12:00:00Z" }
			expect(formatCompactRelativeTime(conv, now)).toBe("24h")
		})

		it("formats days like 3d", () => {
			const conv = { updated_at: "2026-10-04T12:00:00Z" }
			expect(formatCompactRelativeTime(conv, now)).toBe("3d")
		})

		it("formats weeks like 1w", () => {
			const conv = { updated_at: "2026-09-30T12:00:00Z" }
			expect(formatCompactRelativeTime(conv, now)).toBe("1w")
		})

		it("prioritizes metadata.source_updated_at over updated_at", () => {
			const conv = {
				updated_at: "2026-10-07T11:59:50Z", // would be "now"
				metadata: {
					source_updated_at: "2026-10-07T11:30:00Z", // should be "30m"
				},
			}
			expect(formatCompactRelativeTime(conv, now)).toBe("30m")
		})

		it("prioritizes last_user_input_time over updated_at", () => {
			const conv = {
				updated_at: "2026-10-07T11:59:50Z", // "now"
				last_user_input_time: "2026-10-07T11:45:00Z", // "15m"
			}
			expect(formatCompactRelativeTime(conv, now)).toBe("15m")
		})

		it("prioritizes metadata.last_user_input_time and metadata.last_modified_time over updated_at", () => {
			const conv = {
				updated_at: "2026-10-07T11:59:50Z",
				metadata: {
					last_user_input_time: "2026-10-07T10:00:00Z", // "2h"
				},
			}
			expect(formatCompactRelativeTime(conv, now)).toBe("2h")

			const conv2 = {
				updated_at: "2026-10-07T11:59:50Z",
				metadata: {
					last_modified_time: "2026-10-07T11:15:00Z", // "45m"
				},
			}
			expect(formatCompactRelativeTime(conv2, now)).toBe("45m")
		})
	})

	describe("isSessionDone", () => {
		it("identifies done, completed, and archived sessions", () => {
			expect(isSessionDone({ status: "done" })).toBe(true)
			expect(isSessionDone({ status: "completed" })).toBe(true)
			expect(isSessionDone({ status: "archived" })).toBe(true)
			expect(isSessionDone({ status: "closed" })).toBe(true)
			expect(isSessionDone({ status: "idle", metadata: { is_done: true } })).toBe(true)
			expect(isSessionDone({ status: "idle" })).toBe(false)
			expect(isSessionDone({ status: "running" })).toBe(false)
			expect(isSessionDone(null)).toBe(false)
		})
	})

	it("renders compact relative timestamp and hides done chats by default", async () => {
		const user = userEvent.setup()
		const sessions = [
			{
				id: 1,
				title: "Active Work",
				status: "running",
				updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
			},
			{
				id: 2,
				title: "Recent Idle",
				status: "idle",
				updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			},
			{
				id: 3,
				title: "Done Task",
				status: "completed",
				updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			},
		]

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId={1}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		// 30m should be displayed for the 30-minute session
		expect(screen.getByText("30m")).toBeInTheDocument()
		expect(screen.getByText("2h")).toBeInTheDocument()

		// "Done Task" should be hidden by default
		expect(screen.queryByText("Done Task")).not.toBeInTheDocument()

		// Clicking the toggle shows completed & archived sessions (no count badge in button)
		const toggleBtn = screen.getByLabelText(/Show hidden & completed chats/i)
		expect(toggleBtn).toBeInTheDocument()
		await user.click(toggleBtn)

		// Now "Done Task" should be visible
		expect(screen.getByText("Done Task")).toBeInTheDocument()
	})

	it("never shows archived sessions in the sidebar list, even when completed sessions are shown", async () => {
		const user = userEvent.setup()
		const sessions = [
			{ id: 1, title: "Active Session", status: "idle" },
			{ id: 2, title: "Done Session", status: "completed" },
			{ id: 3, title: "Archived Session", status: "archived" },
		]

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId={1}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		expect(screen.getByText("Active Session")).toBeInTheDocument()
		expect(screen.queryByText("Archived Session")).not.toBeInTheDocument()

		// Toggle to show completed sessions
		const toggleBtn = screen.getByLabelText(/Show hidden & completed chats/i)
		await user.click(toggleBtn)

		// Done Session becomes visible, but Archived Session stays hidden
		expect(screen.getByText("Done Session")).toBeInTheDocument()
		expect(screen.queryByText("Archived Session")).not.toBeInTheDocument()
	})

	it("automatically hides idle sessions older than 5 days by default", async () => {
		const user = userEvent.setup()
		const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

		const sessions = [
			{ id: 1, title: "Recent Session", status: "idle", updated_at: twoDaysAgo },
			{ id: 2, title: "Old 6-Day Session", status: "idle", updated_at: sixDaysAgo },
		]

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId={1}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		// Recent session should be visible
		expect(screen.getByText("Recent Session")).toBeInTheDocument()

		// Old session > 5 days should be automatically hidden
		expect(screen.queryByText("Old 6-Day Session")).not.toBeInTheDocument()

		// Toggle unhides it
		const toggleBtn = screen.getByLabelText(/Show hidden & completed chats/i)
		await user.click(toggleBtn)
		expect(screen.getByText("Old 6-Day Session")).toBeInTheDocument()
	})

	it("renders project pill when session has project metadata", () => {
		const sessions = [
			{
				id: 1,
				title: "Feature Work",
				status: "idle",
				metadata: {
					project: { name: "botamus-prime-copilot", uri: "file:///workspace" },
				},
			},
		]

		const { container } = render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId={1}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		const pill = container.querySelector(".conv-project-pill")
		expect(pill).toBeInTheDocument()
		expect(pill).toHaveTextContent("botamus-prime-copilot")
	})

	describe("getSessionSubtitle", () => {
		it("returns step or tool text for running sessions", () => {
			expect(getSessionSubtitle({ metadata: { step: "Compiling..." } }, "running", false)).toBe(
				"Compiling...",
			)
			expect(getSessionSubtitle({ metadata: { tool: "view_file" } }, "running", false)).toBe(
				"Running view_file...",
			)
		})

		it("returns question title or step for waiting_for_input sessions", () => {
			expect(
				getSessionSubtitle(
					{ metadata: { step: "Awaiting approval", question: { title: "Approve migration?" } } },
					"waiting_for_input",
					false,
				),
			).toBe("Awaiting approval")
			expect(
				getSessionSubtitle(
					{ metadata: { question: { title: "Approve migration?" } } },
					"waiting_for_input",
					false,
				),
			).toBe("Approve migration?")
		})

		it("returns step text for thinking sessions", () => {
			expect(
				getSessionSubtitle(
					{ metadata: { step: "Evaluating model response..." } },
					"thinking",
					false,
				),
			).toBe("Evaluating model response...")
		})

		it("returns Completed for done sessions", () => {
			expect(getSessionSubtitle({}, "done", true)).toBe("Completed")
			expect(getSessionSubtitle({ metadata: { step: "Finished all tasks" } }, "idle", true)).toBe(
				"Finished all tasks",
			)
		})

		it("does not return raw UUID or internal AHP URIs as subtitles", () => {
			expect(
				getSessionSubtitle(
					{ external_session_id: "4a232034-1e05-4a0f-9fa3-31f04a34f574" },
					"idle",
					false,
					true,
				),
			).toBe("")
			expect(
				getSessionSubtitle(
					{ external_session_id: "ahp:copilotUri/session-123" },
					"idle",
					false,
					true,
				),
			).toBe("")
			expect(
				getSessionSubtitle(
					{ metadata: { step: "4a232034-1e05-4a0f-9fa3-31f04a34f574" } },
					"running",
					false,
					true,
				),
			).toBe("")
			expect(
				getSessionSubtitle({ external_session_id: "friendly-session-id" }, "idle", false, true),
			).toBe("friendly-session-id")
		})
	})

	it("renders active sessions in 2-row layout with header row and details row", () => {
		const sessions = [
			{
				id: "s-1",
				title: "Database Migration for Bot Token Index",
				status: "waiting_for_input",
				updated_at: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
				metadata: {
					step: "Awaiting human approval before running database migration",
					project: { name: "core-db" },
				},
			},
		]

		const { container } = render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Worker", bot_type: "ahp", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={sessions}
				selectedConversationId="s-1"
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		// Button has 2-row container class
		const convItem = container.querySelector(".conv-item--two-row")
		expect(convItem).toBeInTheDocument()

		// Row 1 contains title and timestamp
		const rowTop = container.querySelector(".conv-row--top")
		expect(rowTop).toBeInTheDocument()
		expect(rowTop.querySelector(".conv-title")).toHaveTextContent(
			"Database Migration for Bot Token Index",
		)
		expect(rowTop.querySelector(".conv-time")).toHaveTextContent("50m")

		// Row 2 contains project pill, action icon, and step preview text
		const rowBottom = container.querySelector(".conv-row--bottom")
		expect(rowBottom).toBeInTheDocument()
		expect(rowBottom.querySelector(".conv-project-pill")).toHaveTextContent("core-db")
		expect(rowBottom.querySelector(".conv-step-preview")).toHaveTextContent(
			"Awaiting human approval before running database migration",
		)
		expect(screen.getByLabelText("Needs input")).toBeInTheDocument()
	})

	it("renders session alarm indicator when session has alarm armed", () => {
		localStorage.setItem("messaging.session_alarms", JSON.stringify({ "conv-alarm-1": true }))

		const { container } = render(
			<Sidebar
				token="token"
				bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
				selectedBotId="bot-1"
				conversations={[
					{
						id: "conv-alarm-1",
						title: "Alarmed Session",
						status: "running",
					},
				]}
				selectedConversationId="conv-alarm-1"
				onSelectConversation={vi.fn()}
				onCreateConversation={vi.fn()}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		const alarmIndicator = container.querySelector(".session-alarm-indicator")
		expect(alarmIndicator).toBeInTheDocument()
		expect(alarmIndicator).toHaveAttribute("aria-label", "Alarm active")
	})

	it("renders branch pill and worktree pill in row 2 of conversation items", () => {
		const { container } = render(
			<Sidebar
				bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
				selectedBotId="bot-1"
				conversations={[
					{
						id: "conv-branch-1",
						title: "Branch Session",
						status: "idle",
						metadata: { base_branch: "feat/user-auth", use_worktree: false },
					},
					{
						id: "conv-worktree-1",
						title: "Worktree Session",
						status: "idle",
						metadata: { base_branch: "main", use_worktree: true },
					},
				]}
				selectedConversationId="conv-branch-1"
				onSelectConversation={vi.fn()}
				onCreateConversation={vi.fn()}
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		const branchPill = container.querySelector('[data-testid="conv-branch-pill"]')
		expect(branchPill).toBeInTheDocument()
		expect(branchPill).toHaveTextContent("feat/user-auth")

		const worktreePill = container.querySelector('[data-testid="conv-worktree-pill"]')
		expect(worktreePill).toBeInTheDocument()
		expect(worktreePill).toHaveTextContent("worktree: main")
	})

	describe("groupSessionsByProject and project groups", () => {
		beforeEach(() => {
			localStorage.setItem("messaging.group_by_project", "true")
		})

		afterEach(() => {
			localStorage.clear()
		})

		const sampleConversations = [
			{
				id: "s-1",
				title: "Deploy Production Kubernetes",
				status: "running",
				updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
				metadata: { project: { name: "infra-k8s" } },
			},
			{
				id: "s-2",
				title: "Fix Migration Lock",
				status: "idle",
				updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
				metadata: { project: { name: "backend-api" } },
			},
			{
				id: "s-3",
				title: "Refactor Authentication",
				status: "waiting_for_input",
				updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
				metadata: { project: { name: "backend-api" } },
			},
			{
				id: "s-4",
				title: "General Question",
				status: "idle",
				updated_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
			},
		]

		it("groups sessions by project and marks active groups", () => {
			const groups = groupSessionsByProject(sampleConversations)
			expect(groups.length).toBe(3)

			const infra = groups.find((g) => g.name === "infra-k8s")
			expect(infra).toBeDefined()
			expect(infra.hasActiveSession).toBe(true)
			expect(infra.conversations.length).toBe(1)

			const backend = groups.find((g) => g.name === "backend-api")
			expect(backend).toBeDefined()
			expect(backend.hasActiveSession).toBe(true)
			expect(backend.conversations.length).toBe(2)

			const noProj = groups.find((g) => g.name === "No Project")
			expect(noProj).toBeDefined()
			expect(noProj.hasActiveSession).toBe(false)
			expect(noProj.conversations.length).toBe(1)
		})

		it("sorts project folders statically alphabetically regardless of active session state", () => {
			const convs = [
				{
					id: "z-1",
					title: "Zeta Task",
					status: "running", // active, but project Z
					updated_at: new Date().toISOString(),
					metadata: { project: { name: "zeta-project" } },
				},
				{
					id: "a-1",
					title: "Alpha Task",
					status: "idle", // idle, but project A
					updated_at: new Date(Date.now() - 100000).toISOString(),
					metadata: { project: { name: "alpha-project" } },
				},
				{
					id: "m-1",
					title: "Middle Task",
					status: "idle",
					updated_at: new Date(Date.now() - 50000).toISOString(),
					metadata: { project: { name: "middle-project" } },
				},
				{
					id: "n-1",
					title: "No Project Task",
					status: "running",
					updated_at: new Date().toISOString(),
				},
			]

			const groups = groupSessionsByProject(convs)
			const groupNames = groups.map((g) => g.name)
			// Alphabetical order for named projects, No Project last
			expect(groupNames).toEqual(["alpha-project", "middle-project", "zeta-project", "No Project"])
		})

		it("renders project headers and expands/collapses sessions on click", async () => {
			const user = userEvent.setup()

			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={sampleConversations}
					selectedConversationId="s-1"
					onSelectConversation={vi.fn()}
					onCreateConversation={vi.fn()}
					onSelectBot={vi.fn()}
					onBotsChange={vi.fn()}
					onDeleteBot={vi.fn()}
					userEmail="user@example.com"
					onLogout={vi.fn()}
					isOpen
					appConnection="online"
				/>,
			)

			// Project group headers are visible
			expect(screen.getByRole("button", { name: /Project: infra-k8s/i })).toBeInTheDocument()
			expect(screen.getByRole("button", { name: /Project: backend-api/i })).toBeInTheDocument()
			expect(screen.getByRole("button", { name: /Project: No Project/i })).toBeInTheDocument()

			// Sessions are initially visible because groups start expanded
			expect(screen.getByText("Fix Migration Lock")).toBeInTheDocument()
			expect(screen.getByText("Refactor Authentication")).toBeInTheDocument()

			// Click backend-api project header to collapse it
			const backendHeader = screen.getByRole("button", {
				name: /Project: backend-api, 2 items/i,
			})
			expect(backendHeader).toHaveAttribute("aria-expanded", "true")
			await user.click(backendHeader)

			// backend-api header is now collapsed and its items hidden
			expect(backendHeader).toHaveAttribute("aria-expanded", "false")
			expect(screen.queryByText("Fix Migration Lock")).not.toBeInTheDocument()
			expect(screen.queryByText("Refactor Authentication")).not.toBeInTheDocument()

			// infra-k8s is still expanded
			expect(screen.getByText("Deploy Production Kubernetes")).toBeInTheDocument()

			// Click backend-api again to expand it
			await user.click(backendHeader)
			expect(backendHeader).toHaveAttribute("aria-expanded", "true")
			expect(screen.getByText("Fix Migration Lock")).toBeInTheDocument()
		})

		it("toggles between grouped view and flat list view", async () => {
			const user = userEvent.setup()

			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={sampleConversations}
					selectedConversationId="s-1"
					onSelectConversation={vi.fn()}
					onCreateConversation={vi.fn()}
					onSelectBot={vi.fn()}
					onBotsChange={vi.fn()}
					onDeleteBot={vi.fn()}
					userEmail="user@example.com"
					onLogout={vi.fn()}
					isOpen
					appConnection="online"
				/>,
			)

			// Starts in grouped mode (folder icon has active state or title "View as flat list")
			const toggleGroupBtn = screen.getByRole("button", { name: "View as flat list" })
			expect(toggleGroupBtn).toBeInTheDocument()
			expect(screen.getByRole("button", { name: /Project: infra-k8s/i })).toBeInTheDocument()

			// Click to switch to flat list
			await user.click(toggleGroupBtn)
			expect(screen.queryByRole("button", { name: /Project: infra-k8s/i })).not.toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Group by project" })).toBeInTheDocument()

			// All sessions are still present
			expect(screen.getByText("Deploy Production Kubernetes")).toBeInTheDocument()
			expect(screen.getByText("Fix Migration Lock")).toBeInTheDocument()
		})

		it("sorts sessions within each project group by active status and last updated timestamp descending", () => {
			const now = Date.now()
			const projectConversations = [
				{
					id: "conv-1",
					title: "Older Idle Session",
					status: "idle",
					updated_at: new Date(now - 50 * 60 * 1000).toISOString(),
					metadata: { project: { name: "my-service" } },
				},
				{
					id: "conv-2",
					title: "Newer Idle Session",
					status: "idle",
					updated_at: new Date(now - 10 * 60 * 1000).toISOString(),
					metadata: { project: { name: "my-service" } },
				},
				{
					id: "conv-3",
					title: "Active Session Earlier",
					status: "waiting_for_input",
					updated_at: new Date(now - 30 * 60 * 1000).toISOString(),
					metadata: { project: { name: "my-service" } },
				},
				{
					id: "conv-4",
					title: "Active Session Later",
					status: "running",
					updated_at: new Date(now - 20 * 60 * 1000).toISOString(),
					metadata: { project: { name: "my-service" } },
				},
			]

			const groups = groupSessionsByProject(projectConversations)
			expect(groups.length).toBe(1)
			const myService = groups[0]
			expect(myService.name).toBe("my-service")

			// Expect active sessions first (sorted by last updated: conv-4 then conv-3)
			// Then idle sessions (sorted by last updated: conv-2 then conv-1)
			const ids = myService.conversations.map((c) => c.id)
			expect(ids).toEqual(["conv-4", "conv-3", "conv-2", "conv-1"])
		})

		it("does not treat raw UUIDs or workspace hashes as project names", () => {
			const convs = [
				{
					id: "u-1",
					title: "UUID Project Conv",
					status: "idle",
					metadata: {
						project: { name: "4a232034-1e05-4a0f-9fa3-31f04a34f574" },
					},
				},
			]
			const groups = groupSessionsByProject(convs)
			expect(groups.length).toBe(1)
			expect(groups[0].name).toBe("No Project")
		})

		it("formats raw UUID titles into clean session labels in the sidebar", () => {
			const convs = [
				{
					id: "u-1",
					title: "4a232034-1e05-4a0f-9fa3-31f04a34f574",
					status: "idle",
				},
				{
					id: "u-2",
					title: "Session 05e927fa-e4aa-49fa-9860-2ff586202ba3",
					status: "idle",
				},
			]
			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={convs}
					selectedConversationId="u-1"
					onSelectConversation={vi.fn()}
					isOpen
				/>,
			)

			expect(screen.getByText("Session (4a232034)")).toBeInTheDocument()
			expect(screen.getByText("Session (05e927fa)")).toBeInTheDocument()
			expect(screen.queryByText("4a232034-1e05-4a0f-9fa3-31f04a34f574")).not.toBeInTheDocument()
		})

		it("adds a new session directly to that project by clicking the plus button on the project header", async () => {
			const user = userEvent.setup()
			const onCreateConversation = vi.fn()

			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={sampleConversations}
					selectedConversationId="s-1"
					onSelectConversation={vi.fn()}
					onCreateConversation={onCreateConversation}
					isOpen
				/>,
			)

			// Find plus button for backend-api
			const addBtn = screen.getByRole("button", { name: "New session in backend-api" })
			expect(addBtn).toBeInTheDocument()

			await user.click(addBtn)

			expect(onCreateConversation).toHaveBeenCalledTimes(1)
			expect(onCreateConversation).toHaveBeenCalledWith(
				expect.objectContaining({
					projectName: "backend-api",
					title: "backend-api Session",
					metadata: expect.objectContaining({
						project: expect.objectContaining({ name: "backend-api" }),
					}),
				}),
			)
		})

		it("auto-expands collapsed project group when plus button is clicked", async () => {
			const user = userEvent.setup()
			const onCreateConversation = vi.fn()

			// Start with backend-api collapsed
			localStorage.setItem("messaging.collapsed_projects", JSON.stringify(["backend-api"]))

			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={sampleConversations}
					selectedConversationId="s-1"
					onSelectConversation={vi.fn()}
					onCreateConversation={onCreateConversation}
					isOpen
				/>,
			)

			// Verify backend-api is collapsed initially
			const backendHeader = screen.getByRole("button", {
				name: /Project: backend-api, 2 items/i,
			})
			expect(backendHeader).toHaveAttribute("aria-expanded", "false")
			expect(screen.queryByText("Fix Migration Lock")).not.toBeInTheDocument()

			// Click plus button on backend-api
			const addBtn = screen.getByRole("button", { name: "New session in backend-api" })
			await user.click(addBtn)

			// Verify onCreateConversation was called
			expect(onCreateConversation).toHaveBeenCalledTimes(1)

			// Verify project group is now expanded and items are visible
			expect(backendHeader).toHaveAttribute("aria-expanded", "true")
			expect(screen.getByText("Fix Migration Lock")).toBeInTheDocument()
		})

		it("deduplicates conversations by id and external_session_id so only 1 session item appears per session", () => {
			const duplicateConversations = [
				{
					id: 101,
					external_session_id: "ext-101",
					title: "morpheus-ui Session",
					status: "idle",
					metadata: { project: { name: "morpheus-ui" } },
				},
				// Duplicate object with same id as number
				{
					id: 101,
					external_session_id: "ext-101",
					title: "morpheus-ui Session",
					status: "idle",
					metadata: { project: { name: "morpheus-ui" } },
				},
				// Duplicate object with id as string
				{
					id: "101",
					external_session_id: "ext-101",
					title: "morpheus-ui Session",
					status: "idle",
					metadata: { project: { name: "morpheus-ui" } },
				},
				{
					id: 102,
					external_session_id: "ext-102",
					title: "Triage UI bugs",
					status: "running",
					metadata: { project: { name: "morpheus-ui" } },
				},
			]

			render(
				<Sidebar
					token="token"
					bots={[{ id: "bot-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="bot-1"
					conversations={duplicateConversations}
					selectedConversationId={101}
					onSelectConversation={vi.fn()}
					isOpen
				/>,
			)

			// There should only be 1 instance of morpheus-ui Session rendered, NOT 3
			const sessionItems = screen.getAllByText("morpheus-ui Session")
			expect(sessionItems).toHaveLength(1)

			// Badge should show 2 total sessions under morpheus-ui
			expect(screen.getByText("2")).toBeInTheDocument()
		})
	})

	it("dispatches sync-active-conversation event when clicking already active conversation", async () => {
		const user = userEvent.setup()
		const onSelectConversation = vi.fn()
		const dispatchSpy = vi.spyOn(window, "dispatchEvent")

		const sessions = [
			{
				id: 42,
				title: "Active Coding Task",
				status: "running",
				bot_token_id: 1,
			},
		]

		render(
			<Sidebar
				bots={[{ id: 1, name: "Bot 1", bot_type: "ahp" }]}
				selectedBotId={1}
				conversations={sessions}
				selectedConversationId={42}
				onSelectBot={vi.fn()}
				onSelectConversation={onSelectConversation}
				onCreateConversation={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				onArchiveConversation={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen={true}
				appConnection="connected"
			/>,
		)

		const sessionBtn = screen.getByText("Active Coding Task").closest(".conv-item")
		expect(sessionBtn).toBeInTheDocument()

		await user.click(sessionBtn)
		expect(onSelectConversation).toHaveBeenCalledWith(42)

		const dispatchedEvent = dispatchSpy.mock.calls.find(
			(call) => call[0]?.type === "sync-active-conversation",
		)
		expect(dispatchedEvent).toBeDefined()
		expect(dispatchedEvent[0].detail).toEqual({ conversationId: 42 })

		dispatchSpy.mockRestore()
	})

	it("selects conversation on single click or tap", async () => {
		const user = userEvent.setup()
		const onSelectConversation = vi.fn()
		const sessions = [{ id: 99, title: "Mobile Task", status: "idle", bot_token_id: 1 }]

		render(
			<Sidebar
				bots={[{ id: 1, name: "Bot 1" }]}
				selectedBotId={1}
				conversations={sessions}
				selectedConversationId={null}
				onSelectBot={vi.fn()}
				onSelectConversation={onSelectConversation}
				onCreateConversation={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen={true}
				appConnection="connected"
			/>,
		)

		const item = screen.getByText("Mobile Task").closest(".conv-item")
		await user.click(item)

		expect(onSelectConversation).toHaveBeenCalledWith(99)
	})

	describe("Nested sessions in sidebar", () => {
		it.each([false, true])(
			"excludes subagents from search and counts with project grouping %s",
			async (grouped) => {
				localStorage.setItem("messaging.group_by_project", String(grouped))
				const user = userEvent.setup()
				const sessions = [
					{
						id: 1,
						title: "Review pass",
						external_session_id: "main",
						metadata: { project: { name: "Example" }, child_session_ids: ["reverse-child"] },
					},
					{ id: 2, title: "Review child", metadata: { parent_session_id: "main" } },
					{ id: 3, title: "Review worker", metadata: { is_subagent: true } },
					{ id: 4, title: "Review URI child", external_session_id: "ahp-chat://subagent/main/4" },
					{ id: 5, title: "Review reverse child", external_session_id: "reverse-child" },
					{ id: 6, title: "Review done child", status: "done", parent_session_id: "main" },
				]
				render(
					<Sidebar
						bots={[{ id: 1, name: "AHP Agent", bot_type: "ahp" }]}
						selectedBotId={1}
						conversations={sessions}
						isOpen
					/>,
				)

				expect(document.querySelectorAll(".conv-item")).toHaveLength(1)
				expect(screen.getByText("Review pass")).toBeInTheDocument()
				expect(screen.queryByLabelText("Show hidden & completed chats")).not.toBeInTheDocument()
				if (grouped) {
					expect(screen.getByLabelText("Project: Example, 1 items")).toBeInTheDocument()
				}

				await user.type(screen.getByPlaceholderText("Search sessions..."), "Review")
				expect(document.querySelectorAll(".conv-item")).toHaveLength(1)
				await user.clear(screen.getByPlaceholderText("Search sessions..."))
				await user.type(screen.getByPlaceholderText("Search sessions..."), "worker")
				expect(document.querySelectorAll(".conv-item")).toHaveLength(0)
			},
		)

		it("shows only main sessions even when a nested session is selected", () => {
			const sessions = [
				{
					id: 101,
					title: "Main Orchestrator Task",
					status: "running",
					external_session_id: "parent-main",
					bot_token_id: "ahp-1",
				},
				{
					id: 102,
					title: "Sub-task: Compiling Code",
					status: "running",
					external_session_id: "child-compile",
					parent_session_id: "parent-main",
					bot_token_id: "ahp-1",
				},
			]

			render(
				<Sidebar
					bots={[{ id: "ahp-1", name: "AHP Agent", bot_type: "ahp" }]}
					selectedBotId="ahp-1"
					conversations={sessions}
					selectedConversationId={102}
					onSelectBot={vi.fn()}
					onSelectConversation={vi.fn()}
					onCreateConversation={vi.fn()}
					onBotsChange={vi.fn()}
					onDeleteBot={vi.fn()}
					userEmail="user@example.com"
					onLogout={vi.fn()}
					isOpen={true}
					appConnection="connected"
				/>,
			)

			expect(screen.queryByText("Sub-task: Compiling Code")).not.toBeInTheDocument()
			expect(screen.queryByTestId("nested-pill")).not.toBeInTheDocument()
			const parentButton = screen.getByText("Main Orchestrator Task").closest(".conv-item")
			expect(parentButton).not.toHaveClass("conv-item--nested")
			expect(parentButton).not.toHaveAttribute("data-nested")
		})

		it("places nested sessions directly under their parent session in project groups", () => {
			const parentA = {
				id: 1,
				external_session_id: "p-a",
				title: "Parent Alpha",
				status: "idle",
				metadata: { project: { name: "my-proj" } },
			}
			const parentB = {
				id: 2,
				external_session_id: "p-b",
				title: "Parent Beta",
				status: "idle",
				metadata: { project: { name: "my-proj" } },
			}
			const childA = {
				id: 3,
				external_session_id: "c-a",
				parent_session_id: "p-a",
				title: "Child of Alpha",
				status: "idle",
				metadata: { project: { name: "my-proj" } },
			}

			const groups = groupSessionsByProject([parentB, childA, parentA])
			expect(groups.length).toBe(1)
			const groupConvs = groups[0].conversations

			// Child of Alpha should appear right after Parent Alpha
			const pAIdx = groupConvs.findIndex((c) => c.id === 1)
			const cAIdx = groupConvs.findIndex((c) => c.id === 3)
			expect(cAIdx).toBe(pAIdx + 1)
		})

		it("formats tooltip with parent session information for nested sessions", () => {
			const parent = { id: 1, external_session_id: "root-1", title: "Root Architecture" }
			const child = {
				id: 2,
				external_session_id: "sub-1",
				parent_session_id: "root-1",
				title: "Child Sub",
				last_modified_time: "2026-10-28T12:00:00Z",
			}

			const tooltip = getSessionDisplayTooltip(child, [parent, child])
			expect(tooltip).toContain('Nested under: "Root Architecture"')
		})
	})
})
