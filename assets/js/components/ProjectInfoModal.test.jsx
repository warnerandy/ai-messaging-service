import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ProjectInfoModal from "./ProjectInfoModal.jsx"

describe("ProjectInfoModal", () => {
	const defaultProjectInfo = {
		hasProject: true,
		name: "ai-messaging-service",
		path: "C:/repos/ai-messaging-service",
		uri: "file:///C:/repos/ai-messaging-service",
		branch: "feature/project-header",
		repository: "warne/ai-messaging-service",
		workingDirectories: ["C:/repos/ai-messaging-service", "C:/repos/another-dir"],
	}

	const defaultActiveConv = {
		id: 42,
		title: "Refactor Topbar",
		metadata: {
			step: "Generating test cases",
		},
	}

	const defaultBot = {
		name: "Botimus",
		bot_type: "ahp",
	}

	it("does not render when isOpen is false", () => {
		const { container } = render(
			<ProjectInfoModal
				isOpen={false}
				onClose={vi.fn()}
				projectInfo={defaultProjectInfo}
				activeConv={defaultActiveConv}
				bot={defaultBot}
			/>,
		)
		expect(container.firstChild).toBeNull()
	})

	it("renders project details when isOpen is true", () => {
		render(
			<ProjectInfoModal
				isOpen={true}
				onClose={vi.fn()}
				projectInfo={defaultProjectInfo}
				activeConv={defaultActiveConv}
				bot={defaultBot}
				sessionStatus="running"
			/>,
		)

		expect(screen.getByText("Project & Workspace Info")).toBeInTheDocument()
		expect(screen.getByText("ai-messaging-service")).toBeInTheDocument()
		expect(screen.getAllByText("feature/project-header").length).toBeGreaterThan(0)
		expect(screen.getByText("warne/ai-messaging-service")).toBeInTheDocument()
		expect(screen.getAllByText("C:/repos/ai-messaging-service").length).toBeGreaterThan(0)
		expect(screen.getByText("Refactor Topbar")).toBeInTheDocument()
		expect(screen.getByText("Botimus")).toBeInTheDocument()
		expect(screen.getByText("Generating test cases")).toBeInTheDocument()
	})

	it("calls onClose when clicking close button or pressing Escape", async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()

		render(
			<ProjectInfoModal
				isOpen={true}
				onClose={onClose}
				projectInfo={defaultProjectInfo}
				activeConv={defaultActiveConv}
				bot={defaultBot}
			/>,
		)

		await user.click(screen.getByLabelText("Close project info modal"))
		expect(onClose).toHaveBeenCalledTimes(1)

		await user.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalledTimes(2)
	})

	it("handles copy path action", async () => {
		const user = userEvent.setup()
		const writeTextMock = vi.fn().mockResolvedValue()
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: writeTextMock },
			configurable: true,
			writable: true,
		})

		render(
			<ProjectInfoModal
				isOpen={true}
				onClose={vi.fn()}
				projectInfo={defaultProjectInfo}
				activeConv={defaultActiveConv}
				bot={defaultBot}
			/>,
		)

		const copyBtn = screen.getByRole("button", { name: /Copy Path/i })
		await user.click(copyBtn)

		expect(writeTextMock).toHaveBeenCalledWith("C:/repos/ai-messaging-service")
	})

	it("renders worktree and base branch details in the modal", () => {
		render(
			<ProjectInfoModal
				isOpen={true}
				onClose={vi.fn()}
				projectInfo={defaultProjectInfo}
				activeConv={defaultActiveConv}
				bot={defaultBot}
				useWorktree={true}
				baseBranch="feature/worktree-branch"
			/>,
		)

		expect(screen.getByTestId("project-git-section")).toBeInTheDocument()
		expect(screen.getByText("feature/worktree-branch")).toBeInTheDocument()
		expect(screen.getByText("⚡ Isolated Worktree")).toBeInTheDocument()
		expect(
			screen.getByText(/Working in isolated git worktree against base branch/i),
		).toBeInTheDocument()
	})
})
