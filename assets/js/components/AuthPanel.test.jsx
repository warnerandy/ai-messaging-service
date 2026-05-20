import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AuthPanel from "./AuthPanel.jsx"
import { loginUser, registerUser } from "../lib/data.js"

vi.mock("@heroui/react", () => ({
	Spinner: () => <span data-testid="spinner" />,
}))

vi.mock("../lib/data.js", () => ({
	loginUser: vi.fn(),
	registerUser: vi.fn(),
}))

describe("AuthPanel", () => {
	beforeEach(() => {
		loginUser.mockReset()
		registerUser.mockReset()
	})

	it("submits the login form", async () => {
		const user = userEvent.setup()
		const onAuth = vi.fn()
		loginUser.mockResolvedValue({ token: "token-123" })

		render(<AuthPanel onAuth={onAuth} />)

		await user.type(screen.getByLabelText("Email"), "user@example.com")
		await user.type(screen.getByLabelText("Password"), "secret123")
		fireEvent.submit(document.getElementById("login-form"))

		await waitFor(() => {
			expect(loginUser).toHaveBeenCalledWith("user@example.com", "secret123")
			expect(onAuth).toHaveBeenCalledWith({ token: "token-123" })
		})
	})

	it("switches to register mode and submits the register form", async () => {
		const user = userEvent.setup()
		const onAuth = vi.fn()
		registerUser.mockResolvedValue({ token: "token-456" })

		render(<AuthPanel onAuth={onAuth} />)

		await user.click(screen.getByRole("button", { name: "Register" }))
		expect(screen.getByText("Create your account")).toBeInTheDocument()

		await user.type(screen.getByLabelText("Email"), "new@example.com")
		await user.type(screen.getByLabelText("Password"), "secret456")
		fireEvent.submit(document.getElementById("register-form"))

		await waitFor(() => {
			expect(registerUser).toHaveBeenCalledWith("new@example.com", "secret456")
			expect(onAuth).toHaveBeenCalledWith({ token: "token-456" })
		})
	})
})
