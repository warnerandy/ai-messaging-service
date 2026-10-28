import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import QuestionApprovalCard from "./QuestionApprovalCard.jsx"

describe("QuestionApprovalCard", () => {
	it("renders title, prompt, and options", () => {
		const question = {
			id: "q-1",
			title: "Database Migration",
			prompt: "Allow running mix ecto.migrate?",
			options: ["Approve", "Deny"],
		}

		render(<QuestionApprovalCard question={question} onAnswer={vi.fn()} />)

		expect(screen.getByText("Database Migration")).toBeInTheDocument()
		expect(screen.getByText("Allow running mix ecto.migrate?")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument()
	})

	it("calls onAnswer with question_id and option on option click", async () => {
		const onAnswer = vi.fn().mockResolvedValue({})
		const question = {
			id: "q-42",
			options: ["Proceed", "Abort"],
		}

		render(<QuestionApprovalCard question={question} onAnswer={onAnswer} />)

		fireEvent.click(screen.getByRole("button", { name: "Proceed" }))

		await waitFor(() => {
			expect(onAnswer).toHaveBeenCalledWith(
				expect.objectContaining({
					question_id: "q-42",
					answer: "Proceed",
					approved: true,
				}),
			)
		})
	})

	it("parses JSON formatted response when typing in custom reply input", async () => {
		const onAnswer = vi.fn().mockResolvedValue({})
		const question = {
			question_id: "q-json",
			prompt: "Reply with JSON object keyed by: next, creds.",
			options: [],
		}

		render(<QuestionApprovalCard question={question} onAnswer={onAnswer} />)

		const input = screen.getByPlaceholderText(/e\.g\. next: baselining/i)
		fireEvent.change(input, {
			target: { value: '{"next": "baselining", "creds": "exported in shell"}' },
		})
		fireEvent.click(screen.getByRole("button", { name: /Send/i }))

		await waitFor(() => {
			expect(onAnswer).toHaveBeenCalledWith(
				expect.objectContaining({
					question_id: "q-json",
					answer: { next: "baselining", creds: "exported in shell" },
					next: "baselining",
					creds: "exported in shell",
					approved: true,
				}),
			)
		})
	})

	it("parses key-value pairs without braces and handles mobile smart quotes", async () => {
		const onAnswer = vi.fn().mockResolvedValue({})
		const question = {
			id: "q-smart",
			prompt: "Reply with JSON object keyed by: next, creds.",
			options: [],
		}

		render(<QuestionApprovalCard question={question} onAnswer={onAnswer} />)

		const input = screen.getByPlaceholderText(/e\.g\. next: baselining/i)
		fireEvent.change(input, {
			target: { value: "next: baselining, creds: exported in shell" },
		})
		fireEvent.click(screen.getByRole("button", { name: /Send/i }))

		await waitFor(() => {
			expect(onAnswer).toHaveBeenCalledWith(
				expect.objectContaining({
					question_id: "q-smart",
					answer: { next: "baselining", creds: "exported in shell" },
					next: "baselining",
					creds: "exported in shell",
				}),
			)
		})
	})

	it("renders default Continue and Cancel buttons when options array is empty", () => {
		const question = {
			id: "waiting-for-input",
			title: "Agent Waiting for Input",
			prompt:
				"The agent has paused execution and is waiting for your response or instructions to continue.",
			options: [],
			isGenericWaiting: true,
		}

		render(<QuestionApprovalCard question={question} onAnswer={vi.fn()} />)

		expect(screen.getByText("Agent Waiting for Input")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
		expect(screen.getByPlaceholderText(/Type your instructions or response/i)).toBeInTheDocument()
	})
})
