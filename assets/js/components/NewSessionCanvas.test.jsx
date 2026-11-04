import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import NewSessionCanvas from "./NewSessionCanvas.jsx"

describe("NewSessionCanvas", () => {
	const defaultBot = { id: 1, name: "Botamus Prime", bot_type: "ahp" }
	const defaultProject = { hasProject: true, name: "my-web-app", path: "/workspace/my-web-app" }

	it("renders the canvas header, bot title, protocol badge, and project info", () => {
		render(<NewSessionCanvas bot={defaultBot} projectInfo={defaultProject} baseBranch="main" />)

		expect(screen.getByText("Start a conversation with Botamus Prime")).toBeInTheDocument()
		expect(screen.getByText("AHP Protocol")).toBeInTheDocument()
		expect(screen.getByText("📁 my-web-app")).toBeInTheDocument()
		expect(screen.getByTestId("canvas-git-section")).toBeInTheDocument()
	})

	it("renders Direct Branch and Git Worktree options and handles selection", async () => {
		const user = userEvent.setup()
		const onWorktreeChange = vi.fn()

		render(
			<NewSessionCanvas
				bot={defaultBot}
				baseBranch="feature/auth"
				useWorktree={false}
				worktreeSupported={true}
				onWorktreeChange={onWorktreeChange}
			/>,
		)

		const directCard = screen.getByTestId("canvas-opt-direct-branch")
		const worktreeCard = screen.getByTestId("canvas-opt-worktree")

		expect(directCard).toHaveClass("canvas-target-card--active")
		expect(worktreeCard).not.toHaveClass("canvas-target-card--active")

		await user.click(worktreeCard)
		expect(onWorktreeChange).toHaveBeenCalledWith(true)
	})

	it("renders worktree active state when useWorktree is true", () => {
		render(
			<NewSessionCanvas
				bot={defaultBot}
				baseBranch="main"
				useWorktree={true}
				worktreeSupported={true}
			/>,
		)

		const worktreeCard = screen.getByTestId("canvas-opt-worktree")
		expect(worktreeCard).toHaveClass("canvas-target-card--active")
		expect(screen.getByText("✓ Worktree Active")).toBeInTheDocument()
	})

	it("displays available branches and allows selecting a branch", async () => {
		const user = userEvent.setup()
		const onBaseBranchChange = vi.fn()

		render(
			<NewSessionCanvas
				bot={defaultBot}
				baseBranch="main"
				availableBranches={["main", "develop", "feature/checkout"]}
				onBaseBranchChange={onBaseBranchChange}
			/>,
		)

		expect(screen.getByText("develop")).toBeInTheDocument()
		expect(screen.getByText("feature/checkout")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "feature/checkout" }))
		expect(onBaseBranchChange).toHaveBeenCalledWith("feature/checkout")
	})

	it("allows typing and applying a custom base branch", async () => {
		const user = userEvent.setup()
		const onBaseBranchChange = vi.fn()

		render(
			<NewSessionCanvas
				bot={defaultBot}
				baseBranch="main"
				onBaseBranchChange={onBaseBranchChange}
			/>,
		)

		const editBtn = screen.getByRole("button", { name: "Change Branch" })
		await user.click(editBtn)

		const input = screen.getByPlaceholderText(/e\.g\. main/i)
		expect(input).toBeInTheDocument()

		await user.clear(input)
		await user.type(input, "hotfix/v1.2")
		await user.click(screen.getByRole("button", { name: "Set Base Branch" }))

		expect(onBaseBranchChange).toHaveBeenCalledWith("hotfix/v1.2")
	})

	it("renders execution mode cards and triggers onModeChange", async () => {
		const user = userEvent.setup()
		const onModeChange = vi.fn()

		render(<NewSessionCanvas bot={defaultBot} mode="interactive" onModeChange={onModeChange} />)

		const planCard = screen.getByTestId("canvas-mode-plan")
		expect(planCard).toBeInTheDocument()

		await user.click(planCard)
		expect(onModeChange).toHaveBeenCalledWith("plan")
	})

	it("renders agent role pills and triggers onAgentTypeChange", async () => {
		const user = userEvent.setup()
		const onAgentTypeChange = vi.fn()

		render(
			<NewSessionCanvas
				bot={defaultBot}
				agentType="workspace"
				onAgentTypeChange={onAgentTypeChange}
			/>,
		)

		const coderBtn = screen.getByRole("button", { name: /coder/i })
		await user.click(coderBtn)
		expect(onAgentTypeChange).toHaveBeenCalledWith("coder")
	})

	it("renders starter prompt buttons and invokes onSelectStarter", async () => {
		const user = userEvent.setup()
		const onSelectStarter = vi.fn()

		render(
			<NewSessionCanvas bot={defaultBot} baseBranch="main" onSelectStarter={onSelectStarter} />,
		)

		const planStarter = screen.getByRole("button", { name: /plan next feature/i })
		await user.click(planStarter)

		expect(onSelectStarter).toHaveBeenCalledTimes(1)
		expect(onSelectStarter).toHaveBeenCalledWith(
			expect.stringContaining('Help me plan and design a new feature on branch "main"'),
		)
	})
})
