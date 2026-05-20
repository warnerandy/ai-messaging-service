import test from "node:test"
import assert from "node:assert/strict"

import { THINKING_BLURBS, formatThinkingDuration, pickThinkingBlurb } from "./lib/thinkingConfig.js"

test("pickThinkingBlurb returns a witty blurb from the default list", () => {
	const blurb = pickThinkingBlurb(THINKING_BLURBS.witty, () => 0)
	assert.equal(blurb, THINKING_BLURBS.witty[0])
})

test("pickThinkingBlurb handles empty input", () => {
	assert.equal(
		pickThinkingBlurb([], () => 0.5),
		"",
	)
})

test("formatThinkingDuration renders mm:ss", () => {
	assert.equal(formatThinkingDuration(0), "0:00")
	assert.equal(formatThinkingDuration(5_400), "0:05")
	assert.equal(formatThinkingDuration(65_000), "1:05")
})
