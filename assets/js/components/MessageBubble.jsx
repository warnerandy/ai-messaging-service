import React from "react"
import { AssistantProcessTurn } from "./AssistantAgentProcess.jsx"
import { CompassIcon, BotIcon, SlidersIcon, PaperclipIcon } from "./Icons.jsx"

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
							<CompassIcon size={11} className="inline mr-1" />
							Steer Instruction
						</span>
					)}
					{message.metadata?.agent_type && message.metadata.agent_type !== "general" && (
						<span className="msg-agent-badge" title={`Agent: ${message.metadata.agent_type}`}>
							<BotIcon size={11} className="inline mr-1" />
							{message.metadata.agent_type}
						</span>
					)}
					{message.metadata?.skill && message.metadata.skill !== "none" && (
						<span className="msg-skill-badge" title={`Skill: ${message.metadata.skill}`}>
							<SlidersIcon size={11} className="inline mr-1" />
							{message.metadata.skill}
						</span>
					)}
					{message.metadata?.url && (
						<div className="msg-attachment-wrap">
							{message.content_type === "image" ||
							(typeof message.metadata.url === "string" &&
								/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(message.metadata.url)) ? (
								<img
									src={message.metadata.url}
									alt={message.metadata.filename || "Attached image"}
									className="msg-attachment-img"
									loading="lazy"
								/>
							) : (
								<a
									href={message.metadata.url}
									target="_blank"
									rel="noreferrer"
									className="msg-attachment-link"
								>
									<PaperclipIcon size={12} className="inline mr-1" />
									{message.metadata.filename || "Attachment"}
								</a>
							)}
						</div>
					)}
					{message.body && <p className="msg-text">{message.body}</p>}
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
