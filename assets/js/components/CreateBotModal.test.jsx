import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CreateBotModal from "./CreateBotModal.jsx"
import { createBot } from "../lib/data.js"

vi.mock("../lib/data.js", () => ({
	createBot: vi.fn(),
}))

describe("CreateBotModal", () => {
	beforeEach(() => {
		createBot.mockReset()
	})

	it("renders title, inputs, bot type options, and action buttons", () => {
		render(
			<CreateBotModal
				token="test-token"
				isOpen={true}
				onClose={vi.fn()}
				onBotCreated={vi.fn()}
			/>,
		)

		expect(screen.getByRole("dialog")).toBeInTheDocument()
		expect(screen.getByText("Create New Bot")).toBeInTheDocument()
		expect(screen.getByLabelText("Bot Name")).toBeInTheDocument()
		expect(screen.getByText("Chat Bot")).toBeInTheDocument()
		expect(screen.getByText("AHP Agent")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Create Bot" })).toBeDisabled()
	})

	it("creates a chat bot by default and calls onBotCreated", async () => {
		const user = userEvent.setup()
		const onBotCreated = vi.fn()
		const onClose = vi.fn()
		createBot.mockResolvedValue({ id: "new-bot", token: "tok-123" })

		render(
			<CreateBotModal
				token="test-token"
				isOpen={true}
				onClose={onClose}
				onBotCreated={onBotCreated}
			/>,
		)

		await user.type(screen.getByLabelText("Bot Name"), "Support Agent")
		const submitBtn = screen.getByRole("button", { name: "Create Bot" })
		expect(submitBtn).not.toBeDisabled()
		await user.click(submitBtn)

		await waitFor(() => {
			expect(createBot).toHaveBeenCalledWith("test-token", "Support Agent", "chat")
			expect(onBotCreated).toHaveBeenCalledWith({ id: "new-bot", token: "tok-123" })
		})
	})

	it("selects AHP agent and passes ahp type on creation", async () => {
		const user = userEvent.setup()
		const onBotCreated = vi.fn()
		createBot.mockResolvedValue({ id: "ahp-bot", token: "tok-456" })

		render(
			<CreateBotModal
				token="test-token"
				isOpen={true}
				onClose={vi.fn()}
				onBotCreated={onBotCreated}
			/>,
		)

		await user.type(screen.getByLabelText("Bot Name"), "Code Worker")
		await user.click(screen.getByText("AHP Agent"))
		await user.click(screen.getByRole("button", { name: "Create Bot" }))

		await waitFor(() => {
			expect(createBot).toHaveBeenCalledWith("test-token", "Code Worker", "ahp")
			expect(onBotCreated).toHaveBeenCalledWith({ id: "ahp-bot", token: "tok-456" })
		})
	})

	it("closes on Escape key press", async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()

		render(
			<CreateBotModal
				token="test-token"
				isOpen={true}
				onClose={onClose}
				onBotCreated={vi.fn()}
			/>,
		)

		await user.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalled()
	})

	it("displays error message if createBot fails", async () => {
		const user = userEvent.setup()
		createBot.mockRejectedValue(new Error("Network error creating bot"))

		render(
			<CreateBotModal
				token="test-token"
				isOpen={true}
				onClose={vi.fn()}
				onBotCreated={vi.fn()}
			/>,
		)

		await user.type(screen.getByLabelText("Bot Name"), "Failed Bot")
		await user.click(screen.getByRole("button", { name: "Create Bot" }))

		await waitFor(() => {
			expect(screen.getByText("Network error creating bot")).toBeInTheDocument()
		})
	})
})
