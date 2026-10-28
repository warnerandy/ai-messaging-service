import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import LiveThinking from "./LiveThinking.jsx"

describe("LiveThinking", () => {
	it("renders nothing when idle with no thinking text or tool calls", () => {
		const { container } = render(<LiveThinking status="idle" thinkingText="" toolCalls={[]} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders thinking text and formatted status for waiting_for_input", () => {
		render(
			<LiveThinking
				status="waiting_for_input"
				thinkingText="Evaluating playwright test config..."
			/>,
		)

		expect(screen.getByText("Waiting for Input")).toBeInTheDocument()
		expect(screen.getByText("Reasoning & Execution Log:")).toBeInTheDocument()
		expect(screen.getByText("Evaluating playwright test config...")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Collapse thinking/i })).toBeInTheDocument()
	})

	it("toggles collapse and expand when clicking toggle button", () => {
		render(<LiveThinking status="thinking" thinkingText="Deep thoughts in progress..." />)

		expect(screen.getByText("Deep thoughts in progress...")).toBeInTheDocument()

		const toggleBtn = screen.getByRole("button", { name: /Collapse thinking/i })
		fireEvent.click(toggleBtn)

		expect(screen.queryByText("Deep thoughts in progress...")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Expand thinking/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: /Expand thinking/i }))
		expect(screen.getByText("Deep thoughts in progress...")).toBeInTheDocument()
	})

	it("renders steer and stop buttons when busy and callbacks provided", () => {
		const handleStop = vi.fn()
		const handleSteer = vi.fn()

		render(
			<LiveThinking
				status="running"
				thinkingText="Running tools..."
				onStop={handleStop}
				onSteer={handleSteer}
			/>,
		)

		const stopBtn = screen.getByRole("button", { name: /Stop/i })
		fireEvent.click(stopBtn)
		expect(handleStop).toHaveBeenCalledTimes(1)

		const steerBtn = screen.getByRole("button", { name: /Steer/i })
		fireEvent.click(steerBtn)

		const input = screen.getByPlaceholderText(/Give redirection instruction/i)
		fireEvent.change(input, { target: { value: "Try another approach" } })
		fireEvent.click(screen.getByRole("button", { name: /Send Instruction/i }))

		expect(handleSteer).toHaveBeenCalledWith("Try another approach")
	})
})
