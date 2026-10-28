import { describe, expect, it } from "vitest"
import {
	cleanCurlyQuotes,
	resolveQuestionId,
	extractExpectedKeys,
	parseSmartJson,
	formatQuestionAnswer,
	resolvePendingQuestion,
} from "./ahpQuestion.js"

describe("ahpQuestion", () => {
	it("cleans iOS smart curly quotes into straight quotes", () => {
		const raw = "{\u201cnext\u201d: \u201cbaselining\u201d, \u201ccreds\u201d: \u2018export\u2019}"
		expect(cleanCurlyQuotes(raw)).toBe('{"next": "baselining", "creds": \'export\'}')
	})

	it("resolves question ID from various schema shapes", () => {
		expect(resolveQuestionId({ id: "q-1" })).toBe("q-1")
		expect(resolveQuestionId({ question_id: "q-2" })).toBe("q-2")
		expect(resolveQuestionId({ questionId: "q-3" })).toBe("q-3")
		expect(resolveQuestionId({ questions: [{ id: "sub-1" }] })).toBe("sub-1")
		expect(resolveQuestionId({})).toBe("0")
	})

	it("extracts expected keys from question prompt", () => {
		expect(extractExpectedKeys("Reply with JSON object keyed by: next, creds.")).toEqual([
			"next",
			"creds",
		])
		expect(extractExpectedKeys("Please reply with keys: action, reason")).toEqual([
			"action",
			"reason",
		])
		expect(extractExpectedKeys("Just a regular prompt")).toEqual([])
	})

	it("parses direct JSON properly", () => {
		const res = parseSmartJson('{"next": "baselining", "creds": "shell"}')
		expect(res).toEqual({ next: "baselining", creds: "shell" })
	})

	it("parses JSON containing iOS curly quotes", () => {
		const res = parseSmartJson(
			"{\u201cnext\u201d: \u201cbaselining\u201d, \u201ccreds\u201d: \u201cshell\u201d}",
		)
		expect(res).toEqual({ next: "baselining", creds: "shell" })
	})

	it("parses relaxed JS object syntax", () => {
		const res = parseSmartJson("{next: 'baselining', creds: 'shell'}")
		expect(res).toEqual({ next: "baselining", creds: "shell" })
	})

	it("parses key-value pairs without braces", () => {
		const res = parseSmartJson("next: baselining, creds: shell")
		expect(res).toEqual({ next: "baselining", creds: "shell" })
	})

	it("maps text to prompt requested keys when key-values are not given", () => {
		const prompt = "Reply with JSON object keyed by: next, creds."
		const res = parseSmartJson("baselining", prompt)
		expect(res).toEqual({ next: "baselining", creds: "" })
	})

	it("structures text into a JSON object when question mentions JSON", () => {
		const prompt = "This question requires a JSON answer."
		const res = parseSmartJson("Approve with changes", prompt, "q-99")
		expect(res).toEqual({
			"q-99": "Approve with changes",
			answer: "Approve with changes",
		})
	})

	it("formats full question answer payload with all needed compatibility fields", () => {
		const question = {
			id: "q-42",
			prompt: "Reply with JSON object keyed by: next, creds.",
		}
		const payload = formatQuestionAnswer("next: baseline, creds: shell", question)

		expect(payload.question_id).toBe("q-42")
		expect(payload.answer).toEqual({ next: "baseline", creds: "shell" })
		expect(payload.next).toBe("baseline")
		expect(payload.creds).toBe("shell")
		expect(payload.approved).toBe(true)
		expect(payload.raw_answer).toBe("next: baseline, creds: shell")
	})

	describe("resolvePendingQuestion", () => {
		it("returns null for idle or running sessions without questions", () => {
			expect(resolvePendingQuestion("idle", {})).toBeNull()
			expect(resolvePendingQuestion("running", { step: "Executing query" })).toBeNull()
			expect(resolvePendingQuestion("completed", {})).toBeNull()
		})

		it("returns explicit direct question regardless of status", () => {
			const direct = { id: "q-1", prompt: "Approve deploy?", options: ["Yes", "No"] }
			expect(resolvePendingQuestion("running", {}, direct)).toBe(direct)
			expect(resolvePendingQuestion("waiting_for_input", {}, direct)).toBe(direct)
		})

		it("resolves question from metadata.question", () => {
			const q = { id: "q-meta", prompt: "Confirm deletion?", options: ["Delete", "Cancel"] }
			expect(resolvePendingQuestion("waiting_for_input", { question: q })).toBe(q)
		})

		it("resolves question from metadata.questions array", () => {
			const subQ = { id: "sub-1", prompt: "Pick option", options: ["A", "B"] }
			expect(resolvePendingQuestion("waiting_for_input", { questions: [subQ] })).toBe(subQ)
		})

		it("synthesizes interactive question when waiting_for_input with empty metadata", () => {
			const res = resolvePendingQuestion("waiting_for_input", {})
			expect(res).not.toBeNull()
			expect(res.id).toBe("waiting-for-input")
			expect(res.title).toBe("Agent Waiting for Input")
			expect(res.options).toEqual(["Continue", "Cancel"])
			expect(res.prompt).toContain("waiting for your response")
		})

		it("synthesizes question incorporating metadata.step when waiting_for_input", () => {
			const res = resolvePendingQuestion("waiting_for_input", {
				step: "Awaiting confirmation before git push",
			})
			expect(res).not.toBeNull()
			expect(res.prompt).toBe("Awaiting confirmation before git push")
			expect(res.title).toBe("Action Waiting for Guidance")
			expect(res.options).toEqual(["Continue", "Cancel"])
		})
	})
})
