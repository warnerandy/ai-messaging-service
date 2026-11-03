import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AgentPromptControls from "./AgentPromptControls.jsx"

describe("AgentPromptControls", () => {
	it("renders all three agent modes with correct active mode highlighted", () => {
		const onModeChange = vi.fn()
		render(
			<AgentPromptControls
				mode="interactive"
				onModeChange={onModeChange}
				useWorktree={false}
				baseBranch="main"
				agentType="workspace"
			/>,
		)

		const interactiveTab = screen.getByRole("tab", { name: /interactive mode/i })
		const planTab = screen.getByRole("tab", { name: /plan mode/i })
		const autopilotTab = screen.getByRole("tab", { name: /autopilot mode/i })

		expect(interactiveTab).toBeInTheDocument()
		expect(planTab).toBeInTheDocument()
		expect(autopilotTab).toBeInTheDocument()

		expect(interactiveTab).toHaveAttribute("aria-selected", "true")
		expect(planTab).toHaveAttribute("aria-selected", "false")
		expect(autopilotTab).toHaveAttribute("aria-selected", "false")
	})

	it("calls onModeChange when switching to plan or autopilot", () => {
		const onModeChange = vi.fn()
		render(
			<AgentPromptControls
				mode="interactive"
				onModeChange={onModeChange}
				useWorktree={false}
				baseBranch="main"
				agentType="workspace"
			/>,
		)

		fireEvent.click(screen.getByRole("tab", { name: /plan mode/i }))
		expect(onModeChange).toHaveBeenCalledWith("plan")

		fireEvent.click(screen.getByRole("tab", { name: /autopilot mode/i }))
		expect(onModeChange).toHaveBeenCalledWith("autopilot")
	})

	it("renders direct branch mode and opens worktree/branch popover", async () => {
		const onWorktreeChange = vi.fn()
		const onBaseBranchChange = vi.fn()

		render(
			<AgentPromptControls
				mode="plan"
				useWorktree={false}
				onWorktreeChange={onWorktreeChange}
				baseBranch="feature/payments"
				onBaseBranchChange={onBaseBranchChange}
			/>,
		)

		expect(screen.getByText("feature/payments")).toBeInTheDocument()
		expect(screen.getByText(/Branch:/)).toBeInTheDocument()

		// Click to open popover
		fireEvent.click(screen.getByLabelText(/configure working branch and worktree/i))

		expect(screen.getByText("Working Target")).toBeInTheDocument()
		expect(screen.getByText("Direct Branch")).toBeInTheDocument()
		expect(screen.getByText("Git Worktree")).toBeInTheDocument()

		// Switch to Git Worktree
		fireEvent.click(screen.getByText("Git Worktree"))
		expect(onWorktreeChange).toHaveBeenCalledWith(true)

		// Change base branch
		const input = screen.getByLabelText(/base git branch/i)
		fireEvent.change(input, { target: { value: "release/1.0" } })
		fireEvent.click(screen.getByRole("button", { name: /save/i }))

		expect(onBaseBranchChange).toHaveBeenCalledWith("release/1.0")
	})

	it("renders worktree active state when useWorktree is true", () => {
		render(
			<AgentPromptControls
				mode="autopilot"
				useWorktree={true}
				baseBranch="main"
				agentType="coder"
			/>,
		)

		expect(screen.getByText(/Worktree:/)).toBeInTheDocument()
		expect(screen.getByText("main")).toBeInTheDocument()
	})

	it("renders agent type selector and allows selecting a different agent type", () => {
		const onAgentTypeChange = vi.fn()
		render(
			<AgentPromptControls
				mode="interactive"
				useWorktree={false}
				baseBranch="main"
				agentType="workspace"
				onAgentTypeChange={onAgentTypeChange}
				agentTypes={["workspace", "coder", "architect", "reviewer"]}
			/>,
		)

		const typeBtn = screen.getByLabelText(/select agent type/i)
		expect(typeBtn).toBeInTheDocument()
		expect(screen.getByText("Workspace (@workspace)")).toBeInTheDocument()

		// Open dropdown
		fireEvent.click(typeBtn)

		expect(screen.getByRole("menu", { name: /available agent types/i })).toBeInTheDocument()
		expect(screen.getByRole("menuitem", { name: /architect/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole("menuitem", { name: /architect/i }))
		expect(onAgentTypeChange).toHaveBeenCalledWith("architect")
	})

	it("shows live sync indicator for AHP protocol", () => {
		render(
			<AgentPromptControls
				isAHP={true}
				mode="interactive"
			/>,
		)

		expect(screen.getByText("Synced")).toBeInTheDocument()
	})

	it("renders custom dynamic modes synced from the integration", () => {
		const onModeChange = vi.fn()
		const customModes = [
			{ id: "chat", label: "Chat Assistant", description: "General discussion" },
			{ id: "code", label: "Code Generator", description: "Writes implementation" },
			{ id: "audit", label: "Security Audit", description: "Inspects vulnerabilities" },
		]

		render(
			<AgentPromptControls
				modes={customModes}
				mode="code"
				onModeChange={onModeChange}
			/>,
		)

		expect(screen.getByText("Chat Assistant")).toBeInTheDocument()
		expect(screen.getByText("Code Generator")).toBeInTheDocument()
		expect(screen.getByText("Security Audit")).toBeInTheDocument()

		const codeTab = screen.getByRole("tab", { name: /code generator mode/i })
		expect(codeTab).toHaveAttribute("aria-selected", "true")

		fireEvent.click(screen.getByRole("tab", { name: /security audit mode/i }))
		expect(onModeChange).toHaveBeenCalledWith("audit")
	})

	it("renders repository branches synced from integration and allows selection", () => {
		const onBaseBranchChange = vi.fn()
		const repoBranches = ["main", "feature/sync-options", "release/v2"]

		render(
			<AgentPromptControls
				baseBranch="main"
				availableBranches={repoBranches}
				onBaseBranchChange={onBaseBranchChange}
			/>,
		)

		fireEvent.click(screen.getByLabelText(/configure working branch and worktree/i))

		expect(screen.getByText(/Repository Branches \(3\)/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /feature\/sync-options/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: /feature\/sync-options/i }))
		expect(onBaseBranchChange).toHaveBeenCalledWith("feature/sync-options")
	})

	it("renders custom agent types synced from integration", () => {
		const onAgentTypeChange = vi.fn()
		const customTypes = [
			{ id: "lead_architect", label: "Lead Architect", description: "High-level design" },
			{ id: "qa_engineer", label: "QA Specialist", description: "Writes test suites" },
		]

		render(
			<AgentPromptControls
				agentType="lead_architect"
				agentTypes={customTypes}
				onAgentTypeChange={onAgentTypeChange}
			/>,
		)

		expect(screen.getByText("Lead Architect")).toBeInTheDocument()

		fireEvent.click(screen.getByLabelText(/select agent type/i))
		expect(screen.getByText("QA Specialist")).toBeInTheDocument()
		expect(screen.getByText("Writes test suites")).toBeInTheDocument()

		fireEvent.click(screen.getByRole("menuitem", { name: /qa specialist/i }))
		expect(onAgentTypeChange).toHaveBeenCalledWith("qa_engineer")
	})

	it("adapts when worktreeSupported is false", () => {
		render(
			<AgentPromptControls
				worktreeSupported={false}
				useWorktree={false}
				baseBranch="main"
			/>,
		)

		fireEvent.click(screen.getByLabelText(/configure working branch and worktree/i))
		expect(screen.getByText(/worktree isolation is disabled or not supported/i)).toBeInTheDocument()
		expect(screen.queryByText("Git Worktree")).not.toBeInTheDocument()
	})
})
