import React, { useState } from "react"
import { VSCodePulseDot, VSCodePassIcon, VSCodeLoadingIcon } from "./VSCodeWorkingIcons.jsx"
import { formatQuestionAnswer, resolveQuestionId } from "../lib/ahpQuestion.js"

export default function QuestionApprovalCard({ question, onAnswer }) {
	const [customAnswer, setCustomAnswer] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [answeredValue, setAnsweredValue] = useState(null)

	if (!question) return null

	const questionId = resolveQuestionId(question)
	const firstSubQuestion = Array.isArray(question.questions) && question.questions[0]
	const effectiveQuestion = firstSubQuestion || question

	const {
		title = "Action Approval Required",
		prompt = "",
		message = "",
		question: questionText = "",
		text = "",
		details = "",
		default_action: defaultAction,
	} = effectiveQuestion

	const rawOptions = effectiveQuestion.options ?? question.options
	const options =
		Array.isArray(rawOptions) && rawOptions.length > 0 ? rawOptions : ["Continue", "Cancel"]

	const displayText =
		prompt ||
		message ||
		questionText ||
		text ||
		details ||
		"The agent is waiting for your response or instructions to continue."

	async function handleSelectOption(option) {
		if (submitting || answeredValue) return
		setSubmitting(true)
		setAnsweredValue(option)
		try {
			await onAnswer({
				question_id: questionId,
				answer: option,
				answers: { [questionId]: option },
				[questionId]: option,
				approved:
					option.toLowerCase().includes("approve") ||
					option.toLowerCase().includes("yes") ||
					option.toLowerCase().includes("proceed") ||
					option.toLowerCase().includes("confirm"),
				comment: customAnswer.trim() || undefined,
			})
		} catch (err) {
			console.error("Failed to answer question:", err)
			setAnsweredValue(null)
		} finally {
			setSubmitting(false)
		}
	}

	async function handleCustomSubmit(e) {
		e.preventDefault()
		const trimmed = customAnswer.trim()
		if (!trimmed || submitting || answeredValue) return
		setSubmitting(true)
		setAnsweredValue(trimmed)
		try {
			const payload = formatQuestionAnswer(trimmed, question)
			await onAnswer(payload)
		} catch (err) {
			console.error("Failed to submit custom answer:", err)
			setAnsweredValue(null)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="approval-card">
			<div className="approval-card-header">
				<div className="approval-card-icon">
					<VSCodePulseDot size={14} className="text-amber-400" />
				</div>
				<div className="approval-card-meta">
					<h4 className="approval-card-title">{title}</h4>
					<span className="approval-card-badge">Awaiting Input</span>
				</div>
			</div>

			<div className="approval-card-content">
				<p className="approval-card-text">{displayText}</p>
				{details && details !== displayText && (
					<pre className="approval-card-details">{details}</pre>
				)}
			</div>

			{answeredValue ? (
				<div className="approval-card-answered">
					<VSCodePassIcon
						size={16}
						className="approval-answered-check text-emerald-400 inline mr-1"
					/>
					<span>
						Submitted: <strong>{answeredValue}</strong>
					</span>
				</div>
			) : (
				<div className="approval-card-actions">
					<div className="approval-options-row">
						{options.map((opt, i) => {
							const optLower = opt.toLowerCase()
							const isRecommended =
								optLower.includes("recommended") ||
								optLower.includes("(recommended)") ||
								optLower.includes("suggested") ||
								opt === defaultAction
							const isPrimary =
								isRecommended ||
								optLower.includes("approve") ||
								optLower.includes("yes") ||
								optLower.includes("confirm")
							const isDanger =
								!isRecommended &&
								(optLower.includes("reject") ||
									optLower.includes("deny") ||
									optLower.includes("cancel") ||
									optLower.includes("delete"))

							return (
								<button
									key={i}
									type="button"
									disabled={submitting}
									className={`approval-btn ${
										isPrimary
											? "approval-btn--primary"
											: isDanger
												? "approval-btn--danger"
												: "approval-btn--secondary"
									}`}
									onClick={() => handleSelectOption(opt)}
								>
									{opt}
								</button>
							)
						})}
					</div>

					<form onSubmit={handleCustomSubmit} className="approval-custom-form">
						<input
							type="text"
							className="approval-custom-input"
							placeholder={
								/keyed by/i.test(displayText)
									? "e.g. next: baselining, creds: in shell"
									: question.isGenericWaiting
										? "Type your instructions or response..."
										: "Or type a custom reply / instructions..."
							}
							value={customAnswer}
							onChange={(e) => setCustomAnswer(e.target.value)}
							disabled={submitting}
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck="false"
						/>
						<button
							type="submit"
							className="approval-custom-submit"
							disabled={submitting || !customAnswer.trim()}
						>
							Send
						</button>
					</form>
				</div>
			)}
		</div>
	)
}
