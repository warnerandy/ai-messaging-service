import React, { useMemo } from "react"
import { renderMarkdown } from "../lib/renderMarkdown.js"

export default function MessageBubble({ message, onSuggestion, usedSuggestion }) {
	const isUser = message.role === "user"
	const botBodyHtml = useMemo(
		() => (!isUser && message.body ? renderMarkdown(message.body) : ""),
		[isUser, message.body],
	)

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

	const actions =
		message.content_type === "actions" && Array.isArray(message.metadata?.actions)
			? message.metadata.actions
			: []

	const botAvatarSvg = (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
			<path
				d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<circle cx="9" cy="11" r="1.25" fill="currentColor" />
			<circle cx="15" cy="11" r="1.25" fill="currentColor" />
		</svg>
	)

	return (
		<div className="msg msg--bot">
			<div className="msg-avatar">{botAvatarSvg}</div>
			<div className="msg-content">
				{message.body && (
					<div className="msg-bubble msg-bubble--bot">
						<div
							className="msg-text msg-text--markdown"
							dangerouslySetInnerHTML={{ __html: botBodyHtml }}
						/>
						{message.model && <span className="msg-model">{message.model}</span>}
					</div>
				)}
				{message.content_type === "image" && message.metadata?.url && (
					<div className="msg-bubble msg-bubble--bot">
						<img src={message.metadata.url} alt="Bot shared image" className="msg-image" />
					</div>
				)}
				{message.content_type === "file" && message.metadata?.url && (
					<div className="msg-bubble msg-bubble--bot">
						<div className="msg-file">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
								<path
									d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								<path
									d="M13 2v7h7"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<a
								href={message.metadata.url}
								download={message.metadata.filename}
								className="msg-file-link"
							>
								{message.metadata.filename || "File"}
							</a>
						</div>
					</div>
				)}
				{actions.length > 0 && (
					<div className="msg-suggestions">
						{actions.map((action, index) => {
							const label = typeof action === "string" ? action : action.label
							const value = typeof action === "string" ? action : (action.value ?? action.label)
							const isUsed = usedSuggestion === value
							const isDisabled = usedSuggestion !== undefined

							return (
								<button
									key={index}
									type="button"
									disabled={isDisabled}
									onClick={() => !isDisabled && onSuggestion && onSuggestion(value)}
									className={[
										"suggestion-chip",
										isUsed ? "suggestion-chip--used" : "",
										isDisabled && !isUsed ? "suggestion-chip--dismissed" : "",
									]
										.filter(Boolean)
										.join(" ")}
									aria-pressed={isUsed}
								>
									{isUsed && (
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none">
											<path
												d="M5 12h14M13 6l6 6-6 6"
												stroke="currentColor"
												strokeWidth="2.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
									{label}
									{isUsed && <span className="suggestion-chip__sent">Sent</span>}
								</button>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
