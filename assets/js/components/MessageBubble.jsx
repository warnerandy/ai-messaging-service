import React from "react"
import { AssistantProcessTurn } from "./AssistantAgentProcess.jsx"

export default function MessageBubble({ message, onSuggestion, usedSuggestion }) {
	const isUser = message.role === "user"
	const isSystem = message.role === "system"

	if (isSystem) {
		return (
			<div className="msg msg--system">
				<div className="msg-system-banner">{message.body}</div>
			</div>
		)
	}

	if (isUser) {
		return (
			<div
				className={`msg msg--user ${message.pending ? "msg--pending" : ""} ${message.failed ? "msg--failed" : ""}`}
			>
				<div className="msg-bubble">
					{message.fromSuggestion && (
						<span className="msg-suggestion-origin">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none">
								<path
									d="M5 12h14M13 6l6 6-6 6"
									stroke="currentColor"
									strokeWidth="2.2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							Suggestion
						</span>
					)}
					{(message.metadata?.is_steer || message.is_steer) && (
						<span className="msg-steer-badge" title="Steering instruction sent to running agent">
							🧭 Steer Instruction
						</span>
					)}
					<p className="msg-text">{message.body}</p>
					{message.pending && <span className="msg-status">Sending…</span>}
					{message.failed && <span className="msg-status msg-status--error">Failed</span>}
					{!message.pending &&
						!message.failed &&
						message.acknowledged &&
						!message.awaitingResponse && (
							<span className="msg-status msg-status--delivered">Delivered</span>
						)}
					{!message.pending && !message.failed && !message.acknowledged && (
						<span className="msg-status msg-status--sent">Sent</span>
					)}
				</div>
			</div>
		)
	}

	return (
		<AssistantProcessTurn
			message={message}
			onSuggestion={onSuggestion}
			usedSuggestion={usedSuggestion}
		/>
	)
}
