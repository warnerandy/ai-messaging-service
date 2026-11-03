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
})
