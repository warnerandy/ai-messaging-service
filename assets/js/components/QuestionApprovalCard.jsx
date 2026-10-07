import React, { useState } from "react"
import {
	VSCodePulseDot,
	VSCodePassIcon,
	VSCodeLoadingIcon,
} from "./VSCodeWorkingIcons.jsx"

export default function QuestionApprovalCard({
	question,
	onAnswer,
}) {
	const [customAnswer, setCustomAnswer] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [answeredValue, setAnsweredValue] = useState(null)

	if (!question) return null

	const {
		id: questionId,
		title = "Action Approval Required",
		prompt = "",
		message = "",
		details = "",
		options = ["Approve", "Reject"],
		default_action: defaultAction,
	} = question

	const displayText = prompt || message || details || "Please confirm or provide guidance."

	async function handleSelectOption(option) {
		if (submitting || answeredValue) return
		setSubmitting(true)
		setAnsweredValue(option)
		try {
			await onAnswer({
				question_id: questionId,
				answer: option,
				approved: option.toLowerCase().includes("approve") || option.toLowerCase().includes("yes"),
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
		if (!customAnswer.trim() || submitting || answeredValue) return
		setSubmitting(true)
		setAnsweredValue(customAnswer.trim())
		try {
			await onAnswer({
				question_id: questionId,
				answer: customAnswer.trim(),
				approved: true,
				comment: customAnswer.trim(),
			})
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
					<VSCodePassIcon size={16} className="approval-answered-check text-emerald-400 inline mr-1" />
					<span>Submitted: <strong>{answeredValue}</strong></span>
				</div>
			) : (
				<div className="approval-card-actions">
					<div className="approval-options-row">
						{options.map((opt, i) => {
							const isDanger =
								opt.toLowerCase().includes("reject") ||
								opt.toLowerCase().includes("deny") ||
								opt.toLowerCase().includes("cancel")
							const isPrimary =
								opt.toLowerCase().includes("approve") ||
								opt.toLowerCase().includes("yes") ||
								opt === defaultAction

							return (
								<button
									key={i}
									type="button"
									disabled={submitting}
									className={`approval-btn ${
										isDanger
											? "approval-btn--danger"
											: isPrimary
												? "approval-btn--primary"
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
							placeholder="Or type a custom reply / instructions..."
							value={customAnswer}
							onChange={(e) => setCustomAnswer(e.target.value)}
							disabled={submitting}
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
