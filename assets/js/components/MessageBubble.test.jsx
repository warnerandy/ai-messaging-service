import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import MessageBubble from "./MessageBubble.jsx"
import { renderMarkdown } from "../lib/renderMarkdown.js"

vi.mock("../lib/renderMarkdown.js", () => ({
	renderMarkdown: vi.fn(() => "<strong>hello</strong>"),
}))

describe("MessageBubble", () => {
	it("shows user delivery states", () => {
		render(<MessageBubble message={{ role: "user", body: "Hello", pending: true }} />)
		expect(screen.getByText("Sending…")).toBeInTheDocument()
	})

	it("renders bot content and suggestion actions", async () => {
		const user = userEvent.setup()
		const onSuggestion = vi.fn()

		const { rerender } = render(
			<MessageBubble
				message={{
					role: "bot",
					body: "hello",
					model: "gpt-4",
					content_type: "actions",
					metadata: { actions: [{ label: "Try again", value: "retry" }] },
				}}
				onSuggestion={onSuggestion}
			/>,
		)

		expect(renderMarkdown).toHaveBeenCalledWith("hello")
		expect(screen.getByText("gpt-4")).toBeInTheDocument()
		expect(screen.getByText("Try again")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Try again" }))
		expect(onSuggestion).toHaveBeenCalledWith("retry")

		rerender(
			<MessageBubble
				message={{
					role: "bot",
					body: "hello",
					model: "gpt-4",
					content_type: "actions",
					metadata: { actions: [{ label: "Try again", value: "retry" }] },
				}}
				onSuggestion={onSuggestion}
				usedSuggestion="retry"
			/>,
		)

		const usedSuggestionButton = screen.getByRole("button", { name: /Try again/i })
		expect(usedSuggestionButton).toBeDisabled()
		expect(usedSuggestionButton).toHaveAttribute("aria-pressed", "true")
	})

	it("renders model and context size tag", () => {
		render(
			<MessageBubble
				message={{
					role: "bot",
					body: "response with context",
					model: "gpt-4o",
					context_size: 32768,
				}}
			/>,
		)

		expect(screen.getByText(/gpt-4o \(33k\)/)).toBeInTheDocument()
	})
})
