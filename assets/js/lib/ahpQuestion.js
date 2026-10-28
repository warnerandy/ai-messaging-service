/**
 * Cleans iOS / macOS smart/curly quotes into standard straight quotes.
 */
export function cleanCurlyQuotes(str) {
	if (!str || typeof str !== "string") return str
	return str
		.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
}

/**
 * Extracts question ID from various possible schema formats.
 */
export function resolveQuestionId(question) {
	if (!question) return "0"
	const subId = Array.isArray(question.questions) ? question.questions[0]?.id : null
	return question.id ?? question.question_id ?? question.questionId ?? subId ?? "0"
}

/**
 * Extracts requested JSON keys from question prompt text (e.g. "keyed by: next, creds").
 */
export function extractExpectedKeys(promptText) {
	if (!promptText || typeof promptText !== "string") return []
	const match = promptText.match(
		/(?:keyed by|keys|key(?:s)? are|with keys?)\s*[:=]?\s*([a-zA-Z0-9_,\s]+)/i,
	)
	if (!match) return []
	return match[1]
		.split(/[,|\s]+/)
		.map((k) => k.trim())
		.filter((k) => k && !["and", "by", "the", "a", "or", "object"].includes(k.toLowerCase()))
}

/**
 * Parses user input into a JSON object if possible, handling:
 * - Direct valid JSON
 * - Smart quotes from mobile devices
 * - Relaxed JS object format (unquoted keys, single quotes)
 * - Key-value format (e.g. "next: baselining, creds: shell")
 * - Text mapped to requested keys in question prompt
 * - Fallback structured JSON object for AHP questions
 */
export function parseSmartJson(raw, questionPrompt = "", questionId = "0") {
	if (!raw || typeof raw !== "string") return raw
	const trimmed = raw.trim()
	const text = cleanCurlyQuotes(trimmed)

	// 1. Try direct JSON parse
	try {
		const parsed = JSON.parse(text)
		if (parsed && typeof parsed === "object") return parsed
	} catch {}

	// 2. Try wrapping in braces if missing but looks like key-values: 'next: baselining, creds: shell'
	let braceText = text
	if (!braceText.startsWith("{") && (braceText.includes(":") || braceText.includes("="))) {
		braceText = "{" + braceText + "}"
	}

	// 3. Relaxed key-value parsing (handles "k: v, k2: v2" or "{k: v}")
	try {
		if (braceText.startsWith("{") && braceText.endsWith("}")) {
			const inner = braceText.slice(1, -1).trim()
			const pairs = inner
				.split(/[,;\n]+/)
				.map((p) => p.trim())
				.filter(Boolean)
			const obj = {}
			let hasKeys = false
			for (const pair of pairs) {
				const sepIdx = pair.indexOf(":") !== -1 ? pair.indexOf(":") : pair.indexOf("=")
				if (sepIdx !== -1) {
					const k = pair
						.slice(0, sepIdx)
						.trim()
						.replace(/^['"]|['"]$/g, "")
					let v = pair.slice(sepIdx + 1).trim()
					if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
						v = v.slice(1, -1)
					}
					if (k) {
						obj[k] = v
						hasKeys = true
					}
				}
			}
			if (hasKeys) return obj
		}
	} catch {}

	// 4. Check if prompt explicitly asked for specific keys: e.g. 'Reply with JSON object keyed by: next, creds'
	const expectedKeys = extractExpectedKeys(questionPrompt)
	if (expectedKeys.length > 0) {
		const obj = {}
		const parts = text
			.split(/[,;\n]+/)
			.map((p) => p.trim())
			.filter(Boolean)
		if (parts.length === expectedKeys.length) {
			expectedKeys.forEach((k, idx) => {
				obj[k] = parts[idx]
			})
			return obj
		} else {
			expectedKeys.forEach((k, idx) => {
				obj[k] = idx === 0 ? text : ""
			})
			return obj
		}
	}

	// 5. If question explicitly requires a JSON answer, structure it into a JSON object
	const requiresJson = /json/i.test(questionPrompt) || /json/i.test(JSON.stringify(questionPrompt))

	if (requiresJson) {
		return {
			[questionId || "0"]: text,
			answer: text,
		}
	}

	return text
}

/**
 * Builds a multi-compatible payload for answering an AHP question,
 * ensuring both raw strings, parsed JSON objects, and question ID maps
 * are present so any AHP runner/bridge succeeds.
 */
export function formatQuestionAnswer(rawAnswer, question = {}) {
	const questionId = resolveQuestionId(question)
	const displayText =
		question.prompt ||
		question.message ||
		question.question ||
		question.text ||
		question.details ||
		""

	const trimmed = typeof rawAnswer === "string" ? rawAnswer.trim() : rawAnswer
	const parsed =
		typeof trimmed === "string" ? parseSmartJson(trimmed, displayText, questionId) : trimmed

	const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)

	return {
		question_id: questionId,
		answer: parsed,
		raw_answer: typeof rawAnswer === "string" ? rawAnswer.trim() : JSON.stringify(rawAnswer),
		answers: isObject ? parsed : { [questionId]: parsed },
		[questionId]: parsed,
		approved: true,
		comment: typeof rawAnswer === "string" ? rawAnswer.trim() : JSON.stringify(rawAnswer),
		...(isObject ? parsed : {}),
	}
}

/**
 * Resolves a pending question object from status, metadata, or explicit question payloads.
 * If status indicates waiting for input but no explicit question was attached,
 * synthesizes a clear question/approval object from metadata (step, prompt, action)
 * or fallback guidance so an interactive approval card always renders.
 */
export function resolvePendingQuestion(status, metadata = {}, directQuestion = null) {
	// 1. Check explicit direct question argument
	if (directQuestion) {
		if (typeof directQuestion === "string") {
			return {
				id: "q-direct",
				title: "Agent Waiting for Input",
				prompt: directQuestion,
				options: ["Continue", "Cancel"],
			}
		}
		if (typeof directQuestion === "object" && directQuestion !== null) {
			return directQuestion
		}
	}

	const meta = metadata || {}

	// 2. Check metadata.question
	if (meta.question) {
		if (typeof meta.question === "string") {
			return {
				id: "q-meta",
				title: "Action Approval Required",
				prompt: meta.question,
				options: ["Continue", "Cancel"],
			}
		}
		if (typeof meta.question === "object" && meta.question !== null) {
			return meta.question
		}
	}

	// 3. Check metadata.questions (array or object)
	if (Array.isArray(meta.questions) && meta.questions.length > 0) {
		return meta.questions[0]
	}
	if (meta.questions && typeof meta.questions === "object") {
		return meta.questions
	}

	// 4. Check interaction or input_request
	if (meta.interaction && typeof meta.interaction === "object") {
		return meta.interaction
	}
	if (meta.input_request && typeof meta.input_request === "object") {
		return meta.input_request
	}

	// 5. If status is waiting_for_input or needs_input, synthesize interactive prompt
	if (status === "waiting_for_input" || status === "needs_input") {
		const promptText =
			meta.step ||
			meta.prompt ||
			meta.message ||
			meta.action ||
			meta.current_step ||
			meta.description ||
			"The agent has paused execution and is waiting for your response or instructions to continue."

		const titleText =
			meta.title || (meta.step ? "Action Waiting for Guidance" : "Agent Waiting for Input")

		const rawOptions = meta.options
		const options =
			Array.isArray(rawOptions) && rawOptions.length > 0 ? rawOptions : ["Continue", "Cancel"]

		return {
			id: meta.id || meta.question_id || "waiting-for-input",
			title: titleText,
			prompt: promptText,
			options,
			isGenericWaiting: !meta.question && !meta.prompt,
		}
	}

	return null
}
