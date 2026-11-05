import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import SubagentsPanel from "./SubagentsPanel.jsx"
import { getConversation } from "../lib/data.js"

vi.mock("../lib/data.js", () => ({
	getConversation: vi.fn(),
}))

describe("SubagentsPanel", () => {
	const ahpBot = { id: 1, name: "AHP Coding Agent", bot_type: "ahp" }
	const parentConv = {
		id: 10,
		external_session_id: "sess-parent",
		title: "Implement Authentication",
		status: "running",
		metadata: {},
	}
	const runningSubagentConv = {
		id: 11,
		external_session_id: "sess-sub-1",
		parent_session_id: "sess-parent",
		title: "Database Debugger",
		status: "running",
		metadata: {
			role: "Database Debugger",
			prompt: "Verify Ecto migrations and indexes",
			step: "Running mix ecto.migrate",
			tool: "run_command",
			thinking: "Checking schema constraints in priv/repo/migrations...",
			tool_calls: [{ name: "read_file", step: "Reading migration file" }],
		},
	}
	const idleSubagentConv = {
		id: 12,
		external_session_id: "sess-sub-2",
		parent_session_id: "sess-parent",
		title: "Codebase Researcher",
		status: "completed",
		metadata: {
			role: "Codebase Researcher",
			step: "Completed survey of auth modules",
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
		getConversation.mockResolvedValue({
			conversation: runningSubagentConv,
			messages: [{ id: 501, role: "bot", body: "Found missing index on users_tokens table." }],
		})
	})

	it("renders running and completed subagents on an AHP session and opens inspector on click", async () => {
		const onSelectConversation = vi.fn()

		render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				onSelectConversation={onSelectConversation}
			/>,
		)

		expect(screen.getByTestId("subagents-section")).toBeInTheDocument()
		expect(screen.getByText("1 running")).toBeInTheDocument()
		expect(screen.getByText("2 total")).toBeInTheDocument()

		const subCard = screen.getByTestId("subagent-card-sess-sub-1")
		expect(subCard).toHaveTextContent("Database Debugger")
		expect(subCard).toHaveTextContent("Running mix ecto.migrate")

		// Click on the running subagent to see what it is doing
		fireEvent.click(subCard)

		const inspector = screen.getByTestId("subagent-inspector")
		expect(inspector).toBeInTheDocument()
		expect(screen.getByText("Verify Ecto migrations and indexes")).toBeInTheDocument()
		expect(
			screen.getByText("Checking schema constraints in priv/repo/migrations..."),
		).toBeInTheDocument()
		expect(screen.getByText("read_file")).toBeInTheDocument()

		await waitFor(() => {
			expect(screen.getByText("Found missing index on users_tokens table.")).toBeInTheDocument()
		})

		// Click "Open Subagent Session ->" to navigate directly to the subagent conversation
		fireEvent.click(screen.getByTestId("open-subagent-session-btn"))
		expect(onSelectConversation).toHaveBeenCalledWith(11)
	})

	it("renders running processes on the session and expands process details when clicked", () => {
		render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv]}
				sessionStatus="running"
				sessionMetadata={{
					processes: [
						{
							id: "proc-1",
							pid: 9812,
							name: "mix test",
							command: "mix test test/messaging/chat_test.exs",
							step: "Executing backend test suite",
							status: "running",
							output: "14 tests, 0 failures",
							args: { file: "test/messaging/chat_test.exs" },
						},
					],
				}}
			/>,
		)

		expect(screen.getByTestId("running-processes-section")).toBeInTheDocument()
		expect(screen.getByText("1 active")).toBeInTheDocument()

		const procItem = screen.getByTestId("process-item-proc-1")
		expect(procItem).toHaveTextContent("mix test")
		expect(procItem).toHaveTextContent("PID 9812")
		expect(procItem).toHaveTextContent("Executing backend test suite")

		// Click on the running process to inspect its command, arguments, and output
		fireEvent.click(procItem)

		const details = screen.getByTestId("process-details-proc-1")
		expect(details).toBeInTheDocument()
		expect(screen.getByText("mix test test/messaging/chat_test.exs")).toBeInTheDocument()
		expect(screen.getByText("14 tests, 0 failures")).toBeInTheDocument()
	})

	it("renders parent session breadcrumb bar when viewing a nested subagent session", () => {
		const onSelectConversation = vi.fn()

		render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={runningSubagentConv}
				conversations={[parentConv, runningSubagentConv]}
				sessionStatus="running"
				sessionMetadata={runningSubagentConv.metadata}
				onSelectConversation={onSelectConversation}
			/>,
		)

		const parentBar = screen.getByTestId("subagent-parent-bar")
		expect(parentBar).toHaveTextContent("Subagent Session")
		expect(parentBar).toHaveTextContent("Implement Authentication")

		fireEvent.click(screen.getByRole("button", { name: /Back to Parent Session/i }))
		expect(onSelectConversation).toHaveBeenCalledWith(10)
	})

	it("closes the drawer when clicking the close button or pressing Escape", () => {
		const onClose = vi.fn()

		const { rerender } = render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				isOpen={true}
				onClose={onClose}
			/>,
		)

		expect(screen.getByTestId("subagents-drawer")).toBeInTheDocument()

		// Click the close button
		fireEvent.click(screen.getByTestId("close-subagents-panel"))
		expect(onClose).toHaveBeenCalledTimes(1)

		// Test Escape key
		fireEvent.keyDown(window, { key: "Escape" })
		expect(onClose).toHaveBeenCalledTimes(2)

		// When isOpen is false, drawer is not in the document
		rerender(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				isOpen={false}
				onClose={onClose}
			/>,
		)
		expect(screen.queryByTestId("subagents-drawer")).not.toBeInTheDocument()
	})

	it("collapses completed subagents into a single item with a toggle to expand/collapse them", () => {
		render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				isOpen={true}
			/>,
		)

		// Running subagent is visible directly
		expect(screen.getByTestId("subagent-card-sess-sub-1")).toBeInTheDocument()

		// Completed subagent is collapsed into a single group item by default
		expect(screen.getByTestId("completed-subagents-group")).toBeInTheDocument()
		const toggleBtn = screen.getByTestId("toggle-completed-subagents")
		expect(toggleBtn).toBeInTheDocument()
		expect(toggleBtn).toHaveTextContent("Completed Subagents")
		expect(toggleBtn).toHaveTextContent("(1)")
		expect(toggleBtn).toHaveTextContent("Expand")
		expect(screen.queryByTestId("subagent-card-sess-sub-2")).not.toBeInTheDocument()

		// Click the toggle to expand completed subagents
		fireEvent.click(toggleBtn)
		expect(toggleBtn).toHaveTextContent("Collapse")
		expect(screen.getByTestId("completed-subagents-list")).toBeInTheDocument()
		expect(screen.getByTestId("subagent-card-sess-sub-2")).toBeInTheDocument()

		// Click again to collapse them back
		fireEvent.click(toggleBtn)
		expect(toggleBtn).toHaveTextContent("Expand")
		expect(screen.queryByTestId("subagent-card-sess-sub-2")).not.toBeInTheDocument()
	})

	it("filters by running subagents by default and allows switching to all subagents", () => {
		render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				isOpen={true}
			/>,
		)

		// By default on running tab, running subagent is visible, completed is NOT in grid
		expect(screen.getByTestId("subagent-card-sess-sub-1")).toBeInTheDocument()
		expect(screen.queryByTestId("subagent-card-sess-sub-2")).not.toBeInTheDocument()

		// Switch to "All Subagents" tab
		fireEvent.click(screen.getByTestId("tab-all-subagents"))

		// Both subagents are now visible
		expect(screen.getByTestId("subagent-card-sess-sub-1")).toBeInTheDocument()
		expect(screen.getByTestId("subagent-card-sess-sub-2")).toBeInTheDocument()
	})

	it("does not show subagents from other sessions when switching to an unrelated session", () => {
		const unrelatedConv = {
			id: 99,
			external_session_id: "sess-unrelated",
			title: "Unrelated Chat",
			status: "idle",
			metadata: {},
		}

		const { rerender } = render(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv, unrelatedConv]}
				sessionStatus="running"
				sessionMetadata={{}}
				isOpen={true}
			/>,
		)

		// On parent session: has subagents
		expect(screen.getByTestId("subagent-card-sess-sub-1")).toBeInTheDocument()

		// Switch to unrelated session: should have NO subagents
		rerender(
			<SubagentsPanel
				token="test-token"
				bot={ahpBot}
				activeConv={unrelatedConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv, unrelatedConv]}
				sessionStatus="idle"
				sessionMetadata={{}}
				isOpen={true}
			/>,
		)

		expect(screen.queryByTestId("subagent-card-sess-sub-1")).not.toBeInTheDocument()
		expect(screen.queryByTestId("subagent-card-sess-sub-2")).not.toBeInTheDocument()
		expect(screen.queryByTestId("subagents-section")).not.toBeInTheDocument()
	})

	it.each([false, true])("keeps every navigation section available (docked: %s)", (isDocked) => {
		render(
			<SubagentsPanel
				bot={ahpBot}
				activeConv={parentConv}
				conversations={[parentConv, runningSubagentConv, idleSubagentConv]}
				sessionMetadata={{
					processes: [{ id: "nav-process", name: "Run tests", status: "running" }],
					changeset: { files: ["assets/css/app.css"] },
					plan: ["Review navigation"],
				}}
				isOpen={true}
				isDocked={isDocked}
			/>,
		)

		expect(screen.getAllByRole("tab")).toHaveLength(5)
		for (const section of [
			"running-subagents",
			"processes",
			"changeset",
			"plan",
			"all-subagents",
		]) {
			const tab = screen.getByTestId(`tab-${section}`)
			fireEvent.click(tab)
			expect(tab).toHaveAttribute("aria-selected", "true")
			expect(
				screen.getAllByRole("tab").filter((item) => item.getAttribute("aria-selected") === "true"),
			).toHaveLength(1)
		}
		expect(screen.getByTestId("subagent-card-sess-sub-2")).toBeInTheDocument()
	})
})
