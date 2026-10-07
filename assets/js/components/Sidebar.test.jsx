import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Sidebar from "./Sidebar.jsx"
import { createBot } from "../lib/data.js"

vi.mock("../lib/data.js", () => ({
	createBot: vi.fn(),
}))

vi.mock("./BotTokenReveal.jsx", () => ({
	default: ({ token, onDismiss }) => (
		<div data-testid="bot-token-reveal">
			<span>{token}</span>
			<button type="button" onClick={onDismiss}>
				Dismiss token
			</button>
		</div>
	),
}))

describe("Sidebar", () => {
	beforeEach(() => {
		createBot.mockReset()
	})

	it("creates a bot and refreshes the bot list", async () => {
		const user = userEvent.setup()
		const onBotsChange = vi.fn().mockResolvedValue(undefined)
		const onSelectBot = vi.fn()
		createBot.mockResolvedValue({ id: "bot-2", token: "bot-token-2" })

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={onSelectBot}
				onBotsChange={onBotsChange}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Add bot" }))
		await user.type(screen.getByPlaceholderText("Bot name…"), "Helper Bot")
		await user.click(screen.getByRole("button", { name: "Add" }))

		await waitFor(() => {
			expect(createBot).toHaveBeenCalledWith("token-1", "Helper Bot")
			expect(onBotsChange).toHaveBeenCalledTimes(1)
			expect(onSelectBot).toHaveBeenCalledWith("bot-2")
		})
		expect(screen.getByTestId("bot-token-reveal")).toHaveTextContent("bot-token-2")
	})

	it("confirms bot deletion before calling the handler", async () => {
		const user = userEvent.setup()
		const onDeleteBot = vi.fn().mockResolvedValue(undefined)

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				onSelectBot={vi.fn()}
				onBotsChange={vi.fn()}
				onDeleteBot={onDeleteBot}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Delete Alpha" }))
		expect(screen.getByText("Delete Bot")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Delete" }))

		await waitFor(() => {
			expect(onDeleteBot).toHaveBeenCalledWith("bot-1")
		})
	})

	it("renders conversations and calls onSelectConversation and onCreateConversation", async () => {
		const user = userEvent.setup()
		const onSelectConversation = vi.fn()
		const onCreateConversation = vi.fn()

		render(
			<Sidebar
				token="token-1"
				bots={[{ id: "bot-1", name: "Alpha", is_connected: true }]}
				selectedBotId="bot-1"
				conversations={[
					{ id: "conv-1", title: "Project Discussion" },
					{ id: "conv-2", title: "Bug Analysis" },
				]}
				selectedConversationId="conv-1"
				onSelectBot={vi.fn()}
				onSelectConversation={onSelectConversation}
				onCreateConversation={onCreateConversation}
				onBotsChange={vi.fn()}
				onDeleteBot={vi.fn()}
				userEmail="user@example.com"
				onLogout={vi.fn()}
				isOpen
				appConnection="online"
			/>,
		)

		expect(screen.getByText("Project Discussion")).toBeInTheDocument()
		expect(screen.getByText("Bug Analysis")).toBeInTheDocument()

		await user.click(screen.getByText("Bug Analysis"))
		expect(onSelectConversation).toHaveBeenCalledWith("conv-2")

		await user.click(screen.getByRole("button", { name: "New conversation" }))
		expect(onCreateConversation).toHaveBeenCalledTimes(1)
	})
})
