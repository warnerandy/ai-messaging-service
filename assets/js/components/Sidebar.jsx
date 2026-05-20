import React, { useState } from "react"
import { createBot } from "../lib/data.js"
import BotTokenReveal from "./BotTokenReveal.jsx"

export default function Sidebar({
	token,
	bots,
	selectedBotId,
	onSelectBot,
	onBotsChange,
	onDeleteBot,
	userEmail,
	onLogout,
	isOpen,
	appConnection,
}) {
	const [newBotName, setNewBotName] = useState("")
	const [createdToken, setCreatedToken] = useState(null)
	const [creating, setCreating] = useState(false)
	const [deletingId, setDeletingId] = useState(null)
	const [showBotForm, setShowBotForm] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }

	async function handleCreateBot(e) {
		e.preventDefault()
		const name = newBotName.trim()
		if (!name) return
		setCreating(true)
		try {
			const created = await createBot(token, name)
			if (created?.token) setCreatedToken(created.token)
			setNewBotName("")
			setShowBotForm(false)
			await onBotsChange()
			if (created?.id) onSelectBot(created.id)
		} catch (err) {
			console.error("Failed to create bot:", err)
		} finally {
			setCreating(false)
		}
	}

	function requestDeleteBot(e, bot) {
		e.stopPropagation()
		e.preventDefault()
		setConfirmDelete({ id: bot.id, name: bot.name })
	}

	async function confirmDeleteBot() {
		if (!confirmDelete) return
		setDeletingId(confirmDelete.id)
		setConfirmDelete(null)
		try {
			await onDeleteBot(confirmDelete.id)
		} finally {
			setDeletingId(null)
		}
	}

	return (
		<aside className={`sidebar ${isOpen ? "sidebar--open" : ""}`}>
			{/* User info */}
			<div className="sidebar-user">
				<div className="user-avatar">{(userEmail || "U")[0].toUpperCase()}</div>
				<div className="sidebar-user-meta">
					<span className="user-email">{userEmail || "User"}</span>
					<div className={`sidebar-app-status sidebar-app-status--${appConnection}`}>
						<span className={`sidebar-app-status-dot sidebar-app-status-dot--${appConnection}`} />
						<span className="sidebar-app-status-label">
							{appConnection === "online"
								? "App online"
								: appConnection === "offline"
									? "App offline"
									: "Checking app"}
						</span>
					</div>
				</div>
			</div>

			{/* Bot selector */}
			<div className="sidebar-section">
				<div className="sidebar-section-header">
					<span className="sidebar-section-label">Bots</span>
					<button
						type="button"
						className="sidebar-icon-btn"
						onClick={() => setShowBotForm(!showBotForm)}
						title="Add bot"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
							<path
								d="M8 3v10M3 8h10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{showBotForm && (
					<form onSubmit={handleCreateBot} className="inline-create-form">
						<input
							type="text"
							className="inline-input"
							placeholder="Bot name…"
							value={newBotName}
							onChange={(e) => setNewBotName(e.target.value)}
							autoFocus
						/>
						<button type="submit" className="inline-submit" disabled={creating}>
							{creating ? "…" : "Add"}
						</button>
					</form>
				)}

				{createdToken && (
					<BotTokenReveal token={createdToken} onDismiss={() => setCreatedToken(null)} />
				)}

				<div className="bot-pills">
					{bots.map((bot) => (
						<div
							key={bot.id}
							className={`bot-pill ${bot.id === selectedBotId ? "bot-pill--active" : ""}`}
							onClick={() => onSelectBot(bot.id)}
							role="button"
							tabIndex={0}
						>
							<span className={`bot-dot ${bot.is_connected ? "bot-dot--online" : ""}`} />
							<span className="bot-pill-name">{bot.name}</span>
							<button
								type="button"
								className="bot-pill-delete"
								onClick={(e) => requestDeleteBot(e, bot)}
								aria-label={`Delete ${bot.name}`}
							>
								{deletingId === bot.id ? "…" : "×"}
							</button>
						</div>
					))}
					{bots.length === 0 && <p className="sidebar-hint">No bots yet</p>}
				</div>
			</div>

			{/* Logout */}
			<button type="button" className="sidebar-logout" onClick={onLogout}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path
						d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6M10.5 11.5L14 8l-3.5-3.5M14 8H6"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				Sign Out
			</button>

			{/* Delete confirmation modal */}
			{confirmDelete && (
				<div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
					<div className="modal-card" onClick={(e) => e.stopPropagation()}>
						<div className="modal-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
								<path
									d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									stroke="#ef4444"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
						</div>
						<h3 className="modal-title">Delete Bot</h3>
						<p className="modal-text">
							Are you sure you want to delete <strong>{confirmDelete.name}</strong>? This action
							cannot be undone.
						</p>
						<div className="modal-actions">
							<button
								type="button"
								className="modal-btn modal-btn--cancel"
								onClick={() => setConfirmDelete(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="modal-btn modal-btn--danger"
								onClick={confirmDeleteBot}
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</aside>
	)
}
