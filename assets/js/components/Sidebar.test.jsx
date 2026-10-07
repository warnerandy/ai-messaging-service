import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Sidebar, {
	formatCompactRelativeTime,
	getSessionSubtitle,
	isSessionActive,
	isSessionDone,
	isSessionOlderThanDays,
	sortConversations,
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
				{ id: 3, title: "Needs Input", status: "waiting_for_input", updated_at: "2026-10-07T07:00:00Z" },
				{ id: 4, title: "Idle Recent", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{ id: 5, title: "Thinking", status: "thinking", updated_at: "2026-10-07T09:30:00Z" },
			]

			const sorted = sortConversations(sessions, true)
			expect(sorted.map((s) => s.id)).toEqual([3, 5, 2, 4, 1])
		})

		it("sorts unread sessions above idle sessions", () => {
			const sessions = [
				{ id: 1, title: "Idle", status: "idle", updated_at: "2026-10-07T10:00:00Z" },
				{ id: 2, title: "Unread", status: "idle", unread: true, updated_at: "2026-10-07T08:00:00Z" },
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
		const sessions = [
			{ id: "s-1", title: "Idle Earlier", status: "idle", updated_at: "2026-10-07T08:00:00Z" },
			{ id: "s-2", title: "Running Job", status: "running", updated_at: "2026-10-07T09:00:00Z" },
			{ id: "s-3", title: "Needs Action", status: "waiting_for_input", updated_at: "2026-10-07T07:00:00Z" },
			{ id: "s-4", title: "Idle Latest", status: "idle", updated_at: "2026-10-07T11:00:00Z" },
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
			{ id: 1, title: "Active Work", status: "running", updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
			{ id: 2, title: "Recent Idle", status: "idle", updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
			{ id: 3, title: "Done Task", status: "completed", updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
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

		expect(screen.getByText("botamus-prime-copilot")).toBeInTheDocument()
	})

	describe("getSessionSubtitle", () => {
		it("returns step or tool text for running sessions", () => {
			expect(getSessionSubtitle({ metadata: { step: "Compiling..." } }, "running", false)).toBe("Compiling...")
			expect(getSessionSubtitle({ metadata: { tool: "view_file" } }, "running", false)).toBe("Running view_file...")
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
			expect(getSessionSubtitle({ metadata: { step: "Evaluating model response..." } }, "thinking", false)).toBe(
				"Evaluating model response...",
			)
		})

		it("returns Completed for done sessions", () => {
			expect(getSessionSubtitle({}, "done", true)).toBe("Completed")
			expect(getSessionSubtitle({ metadata: { step: "Finished all tasks" } }, "idle", true)).toBe(
				"Finished all tasks",
			)
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
		expect(rowTop.querySelector(".conv-title")).toHaveTextContent("Database Migration for Bot Token Index")
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
})
