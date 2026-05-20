import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TypingIndicator from "./TypingIndicator.jsx"
import { THINKING_BLURBS } from "../lib/thinkingConfig.js"

describe("TypingIndicator", () => {
	it("renders a deterministic thinking blurb and timer", () => {
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0)

		try {
			render(<TypingIndicator />)

			expect(screen.getByText(THINKING_BLURBS.witty[0])).toBeInTheDocument()
			expect(screen.getByLabelText("Bot has been thinking for 0:00")).toBeInTheDocument()
		} finally {
			randomSpy.mockRestore()
		}
	})
})
