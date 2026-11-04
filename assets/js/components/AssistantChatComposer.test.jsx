import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AssistantChatComposer, { AGENT_TYPES, SKILLS } from "./AssistantChatComposer.jsx"

describe("AssistantChatComposer", () => {
	const defaultModels = [
		{ name: "gpt-4o", context_sizes: [4000, 8000, 128000] },
		{ name: "claude-3-5-sonnet", context_sizes: [8000, 200000] },
	]

	it("renders input, model select, and submit button", () => {
		render(
			<AssistantChatComposer value="Hello world" models={defaultModels} selectedModel="gpt-4o" />,
		)

		expect(screen.getByPlaceholderText("What do you want to know?")).toBeInTheDocument()
		expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument()
		expect(screen.getByLabelText("Model")).toHaveValue("gpt-4o")
		expect(screen.getByLabelText("Send message")).toBeInTheDocument()
	})

	it("calls onChange when typing prompt", () => {
		const handleChange = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				onChange={handleChange}
				models={defaultModels}
				selectedModel="gpt-4o"
			/>,
		)

		const input = screen.getByPlaceholderText("What do you want to know?")
		fireEvent.change(input, { target: { value: "New prompt text" } })
		expect(handleChange).toHaveBeenCalledWith("New prompt text")
	})

	it("calls onSubmit when submitting form", () => {
		const handleSubmit = vi.fn()
		render(
			<AssistantChatComposer
				value="Run precommit"
				onSubmit={handleSubmit}
				models={defaultModels}
				selectedModel="gpt-4o"
			/>,
		)

		const sendBtn = screen.getByLabelText("Send message")
		fireEvent.click(sendBtn)
		expect(handleSubmit).toHaveBeenCalled()
	})

	it("selects agent type from dropdown menu", () => {
		const handleSelectAgent = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				models={defaultModels}
				selectedModel="gpt-4o"
				selectedAgentType="general"
				onSelectAgentType={handleSelectAgent}
			/>,
		)

		const agentPill = screen.getByTestId("agent-type-picker")
		expect(agentPill).toHaveTextContent("Auto")

		fireEvent.click(agentPill)
		expect(screen.getByTestId("agent-type-menu")).toBeInTheDocument()

		const coderOption = screen.getByText("Coder")
		fireEvent.click(coderOption)
		expect(handleSelectAgent).toHaveBeenCalledWith("coder")
	})

	it("selects skill from dropdown menu", () => {
		const handleSelectSkill = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				models={defaultModels}
				selectedModel="gpt-4o"
				selectedSkill="none"
				onSelectSkill={handleSelectSkill}
			/>,
		)

		const skillPill = screen.getByTestId("skill-picker")
		expect(skillPill).toHaveTextContent("Standard")

		fireEvent.click(skillPill)
		expect(screen.getByTestId("skill-menu")).toBeInTheDocument()

		const refactorOption = screen.getByText("Refactor")
		fireEvent.click(refactorOption)
		expect(handleSelectSkill).toHaveBeenCalledWith("refactor")
	})

	it("renders attachments with thumbnail and delete button", () => {
		const handleRemoveAttachment = vi.fn()
		const testAttachments = [
			{
				id: "att-1",
				name: "screenshot.png",
				size: 2048,
				type: "image/png",
				previewUrl: "blob:http://localhost/test",
			},
		]

		render(
			<AssistantChatComposer
				value=""
				models={defaultModels}
				selectedModel="gpt-4o"
				attachments={testAttachments}
				onRemoveAttachment={handleRemoveAttachment}
			/>,
		)

		expect(screen.getByTestId("aui-composer-attachments")).toBeInTheDocument()
		expect(screen.getByText("screenshot.png")).toBeInTheDocument()
		expect(screen.getByText("2 KB")).toBeInTheDocument()

		const removeBtn = screen.getByLabelText("Remove attachment")
		fireEvent.click(removeBtn)
		expect(handleRemoveAttachment).toHaveBeenCalledWith("att-1")
	})

	it("attaches pasted images from mobile or desktop clipboard on the fly", () => {
		const handleAddAttachments = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				models={defaultModels}
				selectedModel="gpt-4o"
				onAddAttachments={handleAddAttachments}
			/>,
		)

		const input = screen.getByPlaceholderText("What do you want to know?")
		const pastedImageBlob = new Blob(["mobile-image"], { type: "image/png" })

		fireEvent.paste(input, {
			clipboardData: {
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: () => pastedImageBlob,
					},
				],
				files: [],
			},
		})

		expect(handleAddAttachments).toHaveBeenCalledTimes(1)
		const passedFiles = handleAddAttachments.mock.calls[0][0]
		expect(passedFiles).toHaveLength(1)
		expect(passedFiles[0].type).toBe("image/png")
		expect(passedFiles[0].name).toMatch(/^pasted-image-.*\.png$/)
	})

	it("renders mobile camera/photo quick-attach button and triggers onAddAttachments", () => {
		const handleAddAttachments = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				models={defaultModels}
				selectedModel="gpt-4o"
				onAddAttachments={handleAddAttachments}
			/>,
		)

		expect(screen.getByTestId("camera-attach-btn")).toBeInTheDocument()
		const cameraInput = screen.getByTestId("camera-image-input")
		const photoFile = new File(["photo-bytes"], "phone-photo.jpg", { type: "image/jpeg" })

		fireEvent.change(cameraInput, { target: { files: [photoFile] } })
		expect(handleAddAttachments).toHaveBeenCalledWith([photoFile])
	})

	it("renders steering bar and handles steer action when agent is running", () => {
		const handleViewProgress = vi.fn()
		const handleStop = vi.fn()
		const handleSteerSubmit = vi.fn()

		render(
			<AssistantChatComposer
				value="Adjust tests to use vitest"
				effectiveStatus="running"
				isAgentBusy={true}
				effectiveMetadata={{ step: "Running test suite" }}
				models={defaultModels}
				selectedModel="gpt-4o"
				onViewProgress={handleViewProgress}
				onStop={handleStop}
				onSteerSubmit={handleSteerSubmit}
			/>,
		)

		expect(screen.getByTestId("chat-steering-bar")).toBeInTheDocument()
		expect(screen.getByText("Agent is running")).toBeInTheDocument()
		expect(screen.getByText("Running test suite")).toBeInTheDocument()

		const progressBtn = screen.getByTitle("Jump to live progress")
		fireEvent.click(progressBtn)
		expect(handleViewProgress).toHaveBeenCalled()

		const stopBtn = screen.getByTitle("Stop agent")
		fireEvent.click(stopBtn)
		expect(handleStop).toHaveBeenCalled()

		const steerBtn = screen.getByTestId("steer-agent-btn")
		fireEvent.click(steerBtn)
		expect(handleSteerSubmit).toHaveBeenCalled()
	})

	it("hides capabilities when not a new session and shows send button", () => {
		render(
			<AssistantChatComposer
				value="Follow-up instructions"
				isNewSession={false}
				models={defaultModels}
				selectedModel="gpt-4o"
			/>,
		)

		// Model select and extra pickers are hidden in existing sessions
		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
		expect(screen.queryByTestId("agent-type-picker")).not.toBeInTheDocument()
		expect(screen.queryByTestId("skill-picker")).not.toBeInTheDocument()

		// Send button and capabilities toggle are always present
		expect(screen.getByLabelText("Send message")).toBeInTheDocument()
		const toggleBtn = screen.getByTestId("toggle-capabilities-btn")
		expect(toggleBtn).toBeInTheDocument()

		// Clicking toggle reveals capabilities
		fireEvent.click(toggleBtn)
		expect(screen.getByLabelText("Model")).toBeInTheDocument()
		expect(screen.getByTestId("agent-type-picker")).toBeInTheDocument()
		expect(screen.getByTestId("skill-picker")).toBeInTheDocument()
	})

	it("displays clean agent name instead of raw file path", () => {
		render(
			<AssistantChatComposer
				value=""
				isNewSession={true}
				models={defaultModels}
				selectedModel="gpt-4o"
				selectedAgentType="file:///users/andywarner/.copilot/agents/project%20orchestrator.agent.md"
				agentTypes={["file:///users/andywarner/.copilot/agents/project%20orchestrator.agent.md"]}
			/>,
		)

		const agentPill = screen.getByTestId("agent-type-picker")
		expect(agentPill).toHaveTextContent("Project Orchestrator")
		expect(agentPill).not.toHaveTextContent("file://")
	})

	it("always displays send button regardless of prompt content", () => {
		render(<AssistantChatComposer value="" isNewSession={false} models={defaultModels} />)

		const sendBtn = screen.getByLabelText("Send message")
		expect(sendBtn).toBeInTheDocument()
		expect(sendBtn).toBeDisabled()
	})

	it("allows selecting git worktree from docked pill bar on a new session", () => {
		const handleWorktreeChange = vi.fn()
		render(
			<AssistantChatComposer
				value=""
				isNewSession={true}
				models={defaultModels}
				worktreeSupported={true}
				useWorktree={false}
				onWorktreeChange={handleWorktreeChange}
				baseBranch="main"
			/>,
		)

		const worktreePill = screen.getByTestId("aui-docked-worktree-pill")
		expect(worktreePill).toBeInTheDocument()
		expect(worktreePill).toHaveTextContent("Direct Branch")

		// Clicking opens popover menu
		fireEvent.click(worktreePill)
		const worktreeOption = screen.getByTestId("aui-worktree-opt-worktree")
		expect(worktreeOption).toBeInTheDocument()

		fireEvent.click(worktreeOption)
		expect(handleWorktreeChange).toHaveBeenCalledWith(true)
	})
})
