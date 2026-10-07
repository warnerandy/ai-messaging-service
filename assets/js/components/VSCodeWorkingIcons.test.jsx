import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
	VSCodeLoadingIcon,
	VSCodeSyncIcon,
	VSCodeGearIcon,
	VSCodeSparkleIcon,
	VSCodePassIcon,
	VSCodeErrorIcon,
	VSCodeCircleIcon,
	VSCodePulseDot,
	VSCodeProgressBar,
	VSCodeWorkingStateIcon,
	VSCodeIconsShowcase,
} from "./VSCodeWorkingIcons.jsx"

describe("VSCodeWorkingIcons", () => {
	describe("VSCodeLoadingIcon", () => {
		it("renders with stepped spin by default", () => {
			render(<VSCodeLoadingIcon size={20} ariaLabel="Loading files" />)
			const icon = screen.getByRole("img", { name: "Loading files" })
			expect(icon).toBeInTheDocument()
			expect(icon).toHaveClass("vscode-codicon-loading")
			expect(icon).toHaveClass("vscode-spin")
			expect(icon).toHaveAttribute("width", "20")
		})

		it("supports smooth spin and disabled spin", () => {
			const { rerender } = render(<VSCodeLoadingIcon smooth ariaLabel="Loading smooth" />)
			expect(screen.getByRole("img", { name: "Loading smooth" })).toHaveClass("vscode-spin-smooth")

			rerender(<VSCodeLoadingIcon spin={false} ariaLabel="Loading stopped" />)
			expect(screen.getByRole("img", { name: "Loading stopped" })).not.toHaveClass("vscode-spin")
			expect(screen.getByRole("img", { name: "Loading stopped" })).not.toHaveClass("vscode-spin-smooth")
		})
	})

	describe("VSCodeSyncIcon", () => {
		it("renders sync icon with spin class", () => {
			render(<VSCodeSyncIcon size={18} ariaLabel="Syncing repository" />)
			const icon = screen.getByRole("img", { name: "Syncing repository" })
			expect(icon).toHaveClass("vscode-codicon-sync")
			expect(icon).toHaveClass("vscode-spin")
		})
	})

	describe("VSCodeGearIcon", () => {
		it("renders gear icon with slow spin", () => {
			render(<VSCodeGearIcon spin size={16} ariaLabel="Running background task" />)
			const icon = screen.getByRole("img", { name: "Running background task" })
			expect(icon).toHaveClass("vscode-codicon-gear")
			expect(icon).toHaveClass("vscode-spin-slow")
		})
	})

	describe("VSCodeSparkleIcon", () => {
		it("renders Copilot sparkle with animation wrapper", () => {
			render(<VSCodeSparkleIcon animated size={16} ariaLabel="AI Thinking" />)
			const wrapper = screen.getByRole("img", { name: "AI Thinking" })
			expect(wrapper).toHaveClass("vscode-sparkle-animated")
			expect(wrapper.querySelector(".vscode-codicon-sparkle")).toBeInTheDocument()
		})
	})

	describe("VSCodePassIcon and VSCodeErrorIcon", () => {
		it("renders pass / checkmark icon", () => {
			render(<VSCodePassIcon size={16} ariaLabel="Task succeeded" />)
			expect(screen.getByRole("img", { name: "Task succeeded" })).toHaveClass("vscode-codicon-pass")
		})

		it("renders error mark icon", () => {
			render(<VSCodeErrorIcon size={16} ariaLabel="Build failed" />)
			expect(screen.getByRole("img", { name: "Build failed" })).toHaveClass("vscode-codicon-error")
		})
	})

	describe("VSCodePulseDot", () => {
		it("renders sonar radar pulse dot", () => {
			render(<VSCodePulseDot size={12} ariaLabel="Awaiting approval" />)
			const dot = screen.getByRole("img", { name: "Awaiting approval" })
			expect(dot).toHaveClass("vscode-pulse-sonar")
		})
	})

	describe("VSCodeProgressBar", () => {
		it("renders indeterminate progress bar when active", () => {
			render(<VSCodeProgressBar active variant="thinking" />)
			const bar = screen.getByRole("progressbar")
			expect(bar).toHaveClass("vscode-progress-bar")
			expect(bar).toHaveClass("vscode-progress-bar--thinking")
		})

		it("returns null when active is false", () => {
			const { container } = render(<VSCodeProgressBar active={false} />)
			expect(container).toBeEmptyDOMElement()
		})
	})

	describe("VSCodeWorkingStateIcon mapping", () => {
		it("maps 'thinking' to animated sparkle", () => {
			render(<VSCodeWorkingStateIcon status="thinking" />)
			expect(screen.getByRole("img", { name: "Thinking" })).toBeInTheDocument()
		})

		it("maps 'running' to loading spinner", () => {
			render(<VSCodeWorkingStateIcon status="running" />)
			expect(screen.getByRole("img", { name: "Running" })).toBeInTheDocument()
		})

		it("maps 'toolActive' to gear spinner regardless of status", () => {
			render(<VSCodeWorkingStateIcon status="running" toolActive />)
			expect(screen.getByRole("img", { name: "Executing tool" })).toBeInTheDocument()
		})

		it("maps 'waiting_for_input' to pulse dot", () => {
			render(<VSCodeWorkingStateIcon status="waiting_for_input" />)
			expect(screen.getByRole("img", { name: "Waiting for input" })).toBeInTheDocument()
		})

		it("maps 'completed' to pass checkmark", () => {
			render(<VSCodeWorkingStateIcon status="completed" />)
			expect(screen.getByRole("img", { name: "Completed" })).toBeInTheDocument()
		})

		it("maps 'error' to error icon", () => {
			render(<VSCodeWorkingStateIcon status="error" />)
			expect(screen.getByRole("img", { name: "Error" })).toBeInTheDocument()
		})

		it("maps 'idle' to circle outline", () => {
			render(<VSCodeWorkingStateIcon status="idle" />)
			expect(screen.getByRole("img", { name: "Idle" })).toBeInTheDocument()
		})
	})

	describe("VSCodeIconsShowcase", () => {
		it("renders showcase with state buttons and toggle controls", async () => {
			const user = userEvent.setup()
			render(<VSCodeIconsShowcase />)

			expect(screen.getByText("VS Code Working State Icons")).toBeInTheDocument()
			expect(screen.getByText("Stepped Spin (steps: 30)")).toBeInTheDocument()
			expect(screen.getByText("Smooth Spin (linear)")).toBeInTheDocument()

			const smoothBtn = screen.getByRole("button", { name: "Smooth Spin (linear)" })
			await user.click(smoothBtn)
			expect(smoothBtn).toHaveClass("vscode-toggle-btn--active")
		})
	})
})
