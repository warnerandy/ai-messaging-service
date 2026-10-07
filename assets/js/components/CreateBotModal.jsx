import React, { useEffect, useState } from "react"
import { createBot } from "../lib/data.js"
import { VSCodeLoadingIcon } from "./VSCodeWorkingIcons.jsx"

export default function CreateBotModal({
	token,
	isOpen,
	onClose,
	onBotCreated,
}) {
	const [name, setName] = useState("")
	const [botType, setBotType] = useState("chat")
	const [creating, setCreating] = useState(false)
	const [error, setError] = useState(null)

	useEffect(() => {
		function handleKeyDown(e) {
			if (e.key === "Escape") {
				onClose()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [onClose])

	async function handleSubmit(e) {
		e.preventDefault()
		const trimmedName = name.trim()
		if (!trimmedName || creating) return

		setCreating(true)
		setError(null)
		try {
			const created = await createBot(token, trimmedName, botType)
			setName("")
			setBotType("chat")
			onBotCreated && onBotCreated(created)
		} catch (err) {
			console.error("Failed to create bot:", err)
			setError(err.message || "Failed to create bot. Please try again.")
		} finally {
			setCreating(false)
		}
	}

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div
				className="modal-card modal-card--create-bot"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="create-bot-modal-title"
			>
				<div className="modal-header">
					<div className="modal-title-row">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-blue-400"
							aria-hidden="true"
						>
							<path d="M12 8V4H8" />
							<rect width="16" height="12" x="4" y="8" rx="2" />
							<path d="M2 14h2" />
							<path d="M20 14h2" />
							<path d="M15 13v2" />
							<path d="M9 13v2" />
						</svg>
						<div>
							<h3 id="create-bot-modal-title" className="modal-title">
								Create New Bot
							</h3>
							<p className="modal-subtitle">
								Choose a name and integration type to configure your bot
							</p>
						</div>
					</div>
					<button
						type="button"
						className="modal-close-btn"
						onClick={onClose}
						aria-label="Close"
					>
						✕
					</button>
				</div>

				<form onSubmit={handleSubmit} className="modal-form">
					<div className="form-group">
						<label htmlFor="create-bot-name-input" className="form-label">
							Bot Name
						</label>
						<input
							id="create-bot-name-input"
							type="text"
							className="modal-input"
							placeholder="Bot name…"
							value={name}
							onChange={(e) => setName(e.target.value)}
							autoFocus
							disabled={creating}
						/>
					</div>

					<div className="form-group">
						<span className="form-label">Bot Type</span>
						<div className="bot-type-cards">
							<div
								className={`bot-type-card bot-type-card--chat ${botType === "chat" ? "bot-type-card--active" : ""}`}
								onClick={() => setBotType("chat")}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault()
										setBotType("chat")
									}
								}}
							>
								<div className="bot-type-card-header">
									<div className="bot-type-card-radio">
										<span
											className={`bot-type-radio-dot ${botType === "chat" ? "bot-type-radio-dot--checked" : ""}`}
										/>
									</div>
									<div className="bot-type-card-title-group">
										<span className="bot-type-card-title">Chat Bot</span>
										<span className="config-type-badge config-type-badge--chat">
											CHAT
										</span>
									</div>
								</div>
								<p className="bot-type-card-desc">
									Standard conversational assistant for interactive messaging and chat.
								</p>
							</div>

							<div
								className={`bot-type-card bot-type-card--ahp ${botType === "ahp" ? "bot-type-card--active" : ""}`}
								onClick={() => setBotType("ahp")}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault()
										setBotType("ahp")
									}
								}}
							>
								<div className="bot-type-card-header">
									<div className="bot-type-card-radio">
										<span
											className={`bot-type-radio-dot ${botType === "ahp" ? "bot-type-radio-dot--checked" : ""}`}
										/>
									</div>
									<div className="bot-type-card-title-group">
										<span className="bot-type-card-title">AHP Agent</span>
										<span className="config-type-badge config-type-badge--ahp">
											AHP
										</span>
									</div>
								</div>
								<p className="bot-type-card-desc">
									Agent Host Protocol worker with workspace tools, live thinking & approvals.
								</p>
							</div>
						</div>
					</div>

					{error && <div className="modal-error-banner">{error}</div>}

					<div className="modal-actions">
						<button
							type="button"
							className="modal-btn modal-btn--cancel"
							onClick={onClose}
							disabled={creating}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="modal-btn modal-btn--primary"
							disabled={!name.trim() || creating}
						>
							{creating ? (
								<>
									<VSCodeLoadingIcon size={14} spin className="inline mr-2" />
									Creating…
								</>
							) : (
								"Create Bot"
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
