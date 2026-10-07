import React from "react"

export default function PromptQueue({
	queue = [],
	onRemovePrompt,
}) {
	if (!queue || queue.length === 0) return null

	return (
		<div className="prompt-queue-container">
			<div className="prompt-queue-header">
				<span className="prompt-queue-icon">⚡</span>
				<span className="prompt-queue-title">
					Queued Prompts ({queue.length})
				</span>
				<span className="prompt-queue-hint">
					Will dispatch automatically when agent is idle
				</span>
			</div>

			<div className="prompt-queue-list">
				{queue.map((item, idx) => {
					const text = typeof item === "string" ? item : item.body || item.prompt || ""
					const id = typeof item === "object" ? item.id : idx

					return (
						<div key={id || idx} className="prompt-queue-chip">
							<span className="prompt-queue-badge">#{idx + 1}</span>
							<span className="prompt-queue-preview" title={text}>
								{text.length > 60 ? `${text.slice(0, 60)}...` : text}
							</span>
							{onRemovePrompt && (
								<button
									type="button"
									className="prompt-queue-remove"
									onClick={() => onRemovePrompt(id)}
									title="Remove from queue"
									aria-label="Remove prompt"
								>
									✕
								</button>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
