import React, { act } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AssistantProcessTurn, convertToAssistantMessage } from "./AssistantAgentProcess.jsx"

describe("AssistantAgentProcess (@assistant-ui/react integration)", () => {
	it("converts an agent message with thinking, tool calls, and body into ThreadMessageLike parts", () => {
		const msg = {
			id: 42,
			role: "bot",
			body: "Refactored the authentication pipeline.",
			metadata: {
				thinking: "Analyzing router scopes and plugs...",
				tool_calls: [
					{
						id: "call-1",
						name: "read_file",
						args: { Path: "lib/messaging_web/router.ex" },
						result: 'scope "/" do ...',
					},
				],
			},
		}

		const converted = convertToAssistantMessage(msg)
		expect(converted.role).toBe("assistant")
		expect(converted.content).toHaveLength(3)
		expect(converted.content[0]).toEqual({
			type: "reasoning",
			text: "Analyzing router scopes and plugs...",
		})
		expect(converted.content[1]).toMatchObject({
			type: "tool-call",
			toolCallId: "call-1",
			toolName: "read_file",
			args: { Path: "lib/messaging_web/router.ex" },
		})
		expect(converted.content[2]).toEqual({
			type: "text",
			text: "Refactored the authentication pipeline.",
		})
	})

	it("renders an agent response as a standardized agent process with expandable thinking, tool processes, plan, and output", () => {
		const message = {
			id: 99,
			role: "bot",
			body: "All tests pass after updating the channel handler.",
			model: "claude-sonnet-4",
			context_size: 64000,
			metadata: {
				step: "Verifying BotChannel AHP events",
				thinking: "Step 1: Check handle_in clauses.\nStep 2: Run mix test.",
				plan: [
					{ title: "Inspect BotChannel", done: true },
					{ title: "Add subagent event persistence", done: true },
				],
				changeset: { files: ["lib/messaging_web/channels/bot_channel.ex"] },
				subagents: [{ id: "sub-1", title: "Test Runner", status: "completed" }],
				tool_calls: [
					{
						id: "tc-run-1",
						name: "run_command",
						args: { CommandLine: "mix test" },
						result: "25 tests, 0 failures",
					},
				],
			},
		}

		render(<AssistantProcessTurn message={message} onSuggestion={vi.fn()} />)

		// Standardized agent process header
		expect(screen.getByText("Agent Output")).toBeInTheDocument()
		expect(screen.getByText("Verifying BotChannel AHP events")).toBeInTheDocument()
		expect(screen.getByText(/1 process/i)).toBeInTheDocument()
		expect(screen.getByText(/1 subagent/i)).toBeInTheDocument()
		expect(screen.getByText(/1 file/i)).toBeInTheDocument()
		expect(screen.getByText(/✓ Completed/i)).toBeInTheDocument()

		// Execution plan rendered
		expect(screen.getByTestId("aui-turn-plan")).toBeInTheDocument()
		expect(screen.getByText("Add subagent event persistence")).toBeInTheDocument()

		// Reasoning block rendered via @assistant-ui/react MessagePrimitive.Parts
		const reasoningBlock = screen.getByTestId("aui-reasoning-block")
		expect(reasoningBlock).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Thinking Process/i }))
		expect(screen.getByText(/Step 1: Check handle_in clauses/i)).toBeInTheDocument()

		// Tool call card rendered via @assistant-ui/react MessagePrimitive.Parts
		const toolCard = screen.getByTestId("aui-tool-call-card")
		expect(toolCard).toHaveTextContent("run_command")
		expect(toolCard).toHaveTextContent("mix test")
		fireEvent.click(screen.getByRole("button", { name: /run_command/i }))
		expect(screen.getByText("25 tests, 0 failures")).toBeInTheDocument()

		// Final output & model badge
		expect(
			screen.getByText("All tests pass after updating the channel handler."),
		).toBeInTheDocument()
		expect(screen.getByText("claude-sonnet-4 (64k)")).toBeInTheDocument()
	})

	it("copies response text to clipboard when copy button is clicked", async () => {
		const writeTextMock = vi.fn().mockResolvedValue(undefined)
		Object.assign(navigator, {
			clipboard: {
				writeText: writeTextMock,
			},
		})

		const message = {
			id: 101,
			role: "bot",
			body: "Here is the refactored code explanation.",
			metadata: {},
		}

		render(<AssistantProcessTurn message={message} />)

		const copyBtn = screen.getByRole("button", { name: /Copy response/i })
		expect(copyBtn).toBeInTheDocument()
		expect(copyBtn).toHaveTextContent("📋 Copy")

		await act(async () => {
			fireEvent.click(copyBtn)
		})

		expect(writeTextMock).toHaveBeenCalledWith("Here is the refactored code explanation.")
		expect(copyBtn).toHaveTextContent("✓ Copied")
	})
})
