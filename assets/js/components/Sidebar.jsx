import React, { useState } from "react"
import BotTokenReveal from "./BotTokenReveal.jsx"
import CreateBotModal from "./CreateBotModal.jsx"
import {
	VSCodeLoadingIcon,
	VSCodeSparkleIcon,
	VSCodePulseDot,
} from "./VSCodeWorkingIcons.jsx"

export function isSessionActive(conv) {
	if (!conv) return false

	if (
		conv.unread ||
		conv.has_unread ||
		(typeof conv.unread_count === "number" && conv.unread_count > 0) ||
		conv.metadata?.unread ||
		conv.metadata?.has_unread ||
		(typeof conv.metadata?.unread_count === "number" && conv.metadata?.unread_count > 0)
	) {
		return true
	}

	const status = (conv.status || "idle").toLowerCase()
	const activeStatuses = [
		"waiting_for_input",
		"needs_input",
		"running",
		"thinking",
		"active",
	]

	if (activeStatuses.includes(status)) {
		return true
	}

	const inactiveStatuses = ["idle", "completed", "archived", "closed"]
	if (status && !inactiveStatuses.includes(status)) {
		return true
	}

	return false
}

export function isSessionDone(conv) {
	if (!conv) return false
	const status = (conv.status || "").toLowerCase()
	if (["done", "completed", "archived", "closed"].includes(status)) {
		return true
	}
	if (conv.metadata?.done || conv.metadata?.is_done || conv.metadata?.completed) {
		return true
	}
	return false
}

export const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000

export function isSessionOlderThanDays(conv, days = 5, now = Date.now()) {
	if (!conv) return false
	const dateStr = getSessionTimestamp(conv)
	if (!dateStr) return false
	const time = new Date(dateStr).getTime()
	if (Number.isNaN(time)) return false
	return now - time > days * 24 * 60 * 60 * 1000
}

export function getSessionProjectInfo(conv) {
	if (!conv || !conv.metadata) return null
	const meta = conv.metadata
	const project = meta.project
	if (typeof project === "object" && project !== null) {
		return {
			name: project.name || "",
			uri: project.uri || "",
		}
	}
	if (typeof project === "string" && project.trim() !== "") {
		return {
			name: project.trim(),
			uri: "",
		}
	}
	if (Array.isArray(meta.working_directories) && meta.working_directories.length > 0) {
		const uri = meta.working_directories[0]
		const name = String(uri).split("/").filter(Boolean).pop() || "project"
		return { name, uri }
	}
	return null
}

export function getSessionSubtitle(conv, status, isDone, isAhp = false) {
	if (!conv) return ""
	const meta = conv.metadata || {}

	if (isDone) {
		return meta.step || meta.current_step || "Completed"
	}

	if (status === "waiting_for_input" || status === "needs_input") {
		return meta.step || meta.question?.title || meta.current_step || meta.question?.prompt || ""
	}

	if (status === "running") {
		return meta.step || meta.current_step || meta.action || (meta.tool ? `Running ${meta.tool}...` : "")
	}

	if (status === "thinking") {
		return meta.step || meta.current_step || (meta.tool ? `Evaluating ${meta.tool}...` : "")
	}

	// idle or other statuses
	if (meta.current_step) return meta.current_step
	if (meta.step) return meta.step
	if (meta.action) return meta.action
	if (Array.isArray(meta.prompt_queue) && meta.prompt_queue.length > 0) {
		return `${meta.prompt_queue.length} prompt${meta.prompt_queue.length > 1 ? "s" : ""} queued`
	}
	if (meta.preview) return meta.preview
	if (isAhp && conv.external_session_id) {
		return conv.external_session_id
	}
	return ""
}

export function getSessionTimestamp(conv) {
	if (!conv) return null

	// Prioritize fields matching VS Code (last_user_input_time, last_modified_time, source_updated_at)
	// and message activity over raw DB row updated_at timestamps
	const candidates = [
		conv.last_user_input_time,
		conv.lastUserInputTime,
		conv.metadata?.last_user_input_time,
		conv.metadata?.lastUserInputTime,
		conv.last_modified_time,
		conv.lastModifiedTime,
		conv.metadata?.last_modified_time,
		conv.metadata?.lastModifiedTime,
		conv.metadata?.source_updated_at,
		conv.source_updated_at,
		conv.last_message_at,
		conv.lastMessageAt,
		conv.metadata?.last_message_at,
		conv.metadata?.lastMessageAt,
		conv.last_activity_at,
		conv.lastActivityAt,
		conv.metadata?.last_activity_at,
		conv.metadata?.lastActivityAt,
		conv.last_modified,
		conv.lastModified,
		conv.metadata?.last_modified,
		conv.metadata?.lastModified,
		conv.metadata?.updated_at,
		conv.metadata?.updatedAt,
		conv.last_used_at,
		conv.lastUsedAt,
		conv.metadata?.last_used_at,
		conv.metadata?.lastUsedAt,
		conv.metadata?.timestamp,
		conv.timestamp,
		conv.inserted_at,
		conv.insertedAt,
		conv.updated_at,
		conv.updatedAt,
	]

	for (const candidate of candidates) {
		if (candidate && typeof candidate === "string") {
			const time = new Date(candidate).getTime()
			if (!Number.isNaN(time)) return candidate
		}
		if (candidate && typeof candidate === "number" && !Number.isNaN(candidate) && candidate > 0) {
			return new Date(candidate).toISOString()
		}
	}

	return null
}

export function formatCompactRelativeTime(conv, now = Date.now()) {
	if (!conv) return ""
	const dateStr = getSessionTimestamp(conv)
	if (!dateStr) return ""
	const time = new Date(dateStr).getTime()
	if (Number.isNaN(time)) return ""

	const diff = Math.max(0, now - time)
	const diffSec = Math.floor(diff / 1000)
	const diffMin = Math.floor(diffSec / 60)
	const diffHours = Math.floor(diffMin / 60)
	const diffDays = Math.floor(diffHours / 24)
	const diffWeeks = Math.floor(diffDays / 7)
	const diffMonths = Math.floor(diffDays / 30)
	const diffYears = Math.floor(diffDays / 365)

	if (diffMin < 1) return "now"
	if (diffHours < 1) return `${diffMin}m`
	if (diffHours <= 24) return `${diffHours}h`
	if (diffDays < 7) return `${diffDays}d`
	if (diffMonths < 1) return `${diffWeeks}w`
	if (diffYears < 1) return `${diffMonths}mo`
	return `${diffYears}y`
}

export function getSessionDisplayTooltip(conv) {
	if (!conv) return ""
	const dateStr = getSessionTimestamp(conv)
	if (!dateStr) return ""
	const d = new Date(dateStr)
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

export function getSessionLastUsedTimestamp(conv) {
	if (!conv) return 0
	const dateStr = getSessionTimestamp(conv)
	if (dateStr) {
		const time = new Date(dateStr).getTime()
		if (!Number.isNaN(time)) return time
	}
	return 0
}

export function getSessionStableId(conv) {
	if (!conv) return 0
	if (typeof conv.id === "number") return conv.id
	const num = Number(conv.id)
	if (!Number.isNaN(num) && num > 0) return num
	const match = String(conv.id || "").match(/\d+/)
	if (match) return parseInt(match[0], 10)
	return 0
}

export function sortConversations(convs = [], isAhp = false) {
	return [...convs].sort((a, b) => {
		// 1. Active sessions always sorted above idle sessions
		const aActive = isSessionActive(a)
		const bActive = isSessionActive(b)

		if (aActive !== bActive) {
			return aActive ? -1 : 1
		}

		// 2. When both are active:
		// Prioritize needs input / unread over running / thinking
		if (aActive && bActive) {
			const getActivePriority = (conv) => {
				const status = (conv.status || "").toLowerCase()
				if (
					status === "waiting_for_input" ||
					status === "needs_input" ||
					conv.unread ||
					conv.has_unread ||
					conv.metadata?.unread
				) {
					return 2
				}
				return 1
			}

			const aPri = getActivePriority(a)
			const bPri = getActivePriority(b)
			if (aPri !== bPri) {
				return bPri - aPri
			}

			// Same active priority: sort by most recent activity timestamp (last_message_at or updated_at)
			const aTime =
				getSessionLastUsedTimestamp(a) ||
				(a.updated_at ? new Date(a.updated_at).getTime() : 0)
			const bTime =
				getSessionLastUsedTimestamp(b) ||
				(b.updated_at ? new Date(b.updated_at).getTime() : 0)

			if (aTime !== bTime) {
				return bTime - aTime
			}

			return getSessionStableId(b) - getSessionStableId(a)
		}

		// 3. Both are idle:
		// Keep idle sessions in a FIXED, STABLE order so they do not shuffle or reorder!
		// If either session has explicit chat message activity, prioritize that:
		const aMsgTime = getSessionLastUsedTimestamp(a)
		const bMsgTime = getSessionLastUsedTimestamp(b)

		if (aMsgTime !== bMsgTime) {
			return bMsgTime - aMsgTime
		}

		// Otherwise, keep idle sessions strictly ordered by stable creation / ID (descending)
		const aId = getSessionStableId(a)
		const bId = getSessionStableId(b)

		if (aId !== bId) {
			return bId - aId
		}

		// If IDs are equal or non-numeric, break ties stably by string key
		const aKey = String(a.external_session_id || a.title || a.id || "")
		const bKey = String(b.external_session_id || b.title || b.id || "")
		return aKey.localeCompare(bKey)
	})
}

export default function Sidebar({
	token,
	bots = [],
	selectedBotId,
	conversations = [],
	selectedConversationId,
	onSelectBot,
	onSelectConversation,
	onCreateConversation,
	onBotsChange,
	onDeleteBot,
	onArchiveConversation,
	userEmail,
	onLogout,
	isOpen,
	appConnection,
}) {
	const [createdToken, setCreatedToken] = useState(null)
	const [deletingId, setDeletingId] = useState(null)
	const [showCreateModal, setShowCreateModal] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
	const [hideDone, setHideDone] = useState(() => {
		const saved = localStorage.getItem("messaging.hide_done_sessions")
		return saved !== "false"
	})

	function toggleHideDone() {
		setHideDone((prev) => {
			const next = !prev
			localStorage.setItem("messaging.hide_done_sessions", String(next))
			return next
		})
	}

	const selectedBot = (bots || []).find((b) => b.id === selectedBotId)
	const isAhp = selectedBot?.bot_type === "ahp"

	const hiddenCount = (conversations || []).filter((c) => {
		if (!c) return false
		if (isSessionDone(c)) return true
		if (!isSessionActive(c) && isSessionOlderThanDays(c, 5)) return true
		return false
	}).length

	const activeConversations = sortConversations(
		(conversations || []).filter((c) => {
			if (!c) return false
			// Always keep current selected conversation visible so user doesn't lose context
			const isSelected = c.id === selectedConversationId
			if (isSelected) return true

			// Automatically hide idle/done conversations older than 5 days
			// (active sessions like running / waiting_for_input are kept visible)
			if (!isSessionActive(c) && isSessionOlderThanDays(c, 5)) {
				return !hideDone
			}

			// Hide completed/archived sessions when hideDone is enabled
			if (hideDone && isSessionDone(c)) return false

			return true
		}),
		isAhp,
	)

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
						onClick={() => setShowCreateModal(true)}
						title="Add bot"
						aria-label="Add bot"
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

				{createdToken && (
					<BotTokenReveal token={createdToken} onDismiss={() => setCreatedToken(null)} />
				)}

				<div className="bot-pills">
					{(bots || []).map((bot) => (
						<div
							key={bot.id}
							className={`bot-pill ${bot.id === selectedBotId ? "bot-pill--active" : ""}`}
							onClick={() => onSelectBot(bot.id)}
							role="button"
							tabIndex={0}
						>
							<span className={`bot-dot ${bot.is_connected ? "bot-dot--online" : ""}`} />
							<span className="bot-pill-name">{bot.name}</span>
							{bot.bot_type === "ahp" && (
								<span className="bot-type-chip" title="Agent Host Protocol Mode">
									AHP
								</span>
							)}
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
					{(bots || []).length === 0 && <p className="sidebar-hint">No bots yet</p>}
				</div>
			</div>

			{/* Conversations / Sessions */}
			{selectedBotId && (
				<div className="sidebar-section">
					<div className="sidebar-section-header">
						<span className="sidebar-section-label">
							{selectedBot?.bot_type === "ahp" ? "Active Sessions" : "Conversations"}
						</span>
						<div className="sidebar-section-actions">
							{hiddenCount > 0 && (
								<button
									type="button"
									className={`sidebar-icon-btn ${!hideDone ? "sidebar-icon-btn--active" : ""}`}
									onClick={toggleHideDone}
									title={hideDone ? "Show hidden & completed chats" : "Hide completed & older chats"}
									aria-label={hideDone ? "Show hidden & completed chats" : "Hide completed & older chats"}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<rect x="2" y="3" width="20" height="5" rx="1" />
										<path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
										<path d="M10 12h4" />
									</svg>
								</button>
							)}
							<button
								type="button"
								className="sidebar-icon-btn"
								onClick={onCreateConversation}
								title={selectedBot?.bot_type === "ahp" ? "New session" : "New conversation"}
								aria-label={selectedBot?.bot_type === "ahp" ? "New session" : "New conversation"}
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
					</div>

					<div className="conv-list">
						{activeConversations.map((conv) => {
							const status = conv.status || "idle"
							const isDone = isSessionDone(conv)
							const isAhp = selectedBot?.bot_type === "ahp"
							const subtitleText = getSessionSubtitle(conv, status, isDone, isAhp)
							const timeText = formatCompactRelativeTime(conv)
							const tooltipText = getSessionDisplayTooltip(conv)
							const projectInfo = getSessionProjectInfo(conv)

							return (
								<button
									key={conv.id}
									type="button"
									className={`conv-item conv-item--two-row ${conv.id === selectedConversationId ? "conv-item--active" : ""} ${isDone ? "conv-item--done" : ""}`}
									onClick={() => onSelectConversation && onSelectConversation(conv.id)}
									title={tooltipText}
								>
									{/* Row 1: Status Dot, Title, and Actions / Time */}
									<div className="conv-row conv-row--top">
										<div className="conv-title-col">
											<span className={`conv-status-dot conv-status-dot--${status}`} />
											<span className="conv-title" title={conv.title || "Session"}>
												{conv.title || "Session"}
											</span>
										</div>

										<div className="conv-item-actions">
											{Boolean(
												conv.unread ||
												conv.has_unread ||
												conv.metadata?.unread ||
												(typeof conv.unread_count === "number" && conv.unread_count > 0)
											) && (
												<span
													className="conv-action-icon conv-action-icon--unread"
													title={typeof conv.unread_count === "number" && conv.unread_count > 0 ? `${conv.unread_count} unread` : "Unread"}
													aria-label="Unread"
												>
													<span className="unread-dot" />
													{typeof conv.unread_count === "number" && conv.unread_count > 0 ? conv.unread_count : null}
												</span>
											)}
											{isDone && (
												<span className="conv-done-indicator" title="Done / Completed" aria-label="Done / Completed">
													✓
												</span>
											)}
											{onArchiveConversation && !isDone && (
												<button
													type="button"
													className="conv-archive-btn"
													onClick={(e) => {
														e.stopPropagation()
														onArchiveConversation(conv.id)
													}}
													title="Archive chat"
													aria-label="Archive chat"
												>
													<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
														<rect x="2" y="3" width="20" height="5" rx="1" />
														<path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
														<path d="M10 12h4" />
													</svg>
												</button>
											)}
											{timeText && (
												<span className="conv-time" title={tooltipText}>
													{timeText}
												</span>
											)}
										</div>
									</div>

									{/* Row 2: Secondary Info (Project Pill, Status Working Icon, Step Preview) */}
									<div className="conv-row conv-row--bottom">
										<div className="conv-meta-col">
											{projectInfo?.name && (
												<span className="conv-project-pill" title={projectInfo.uri || projectInfo.name}>
													{projectInfo.name}
												</span>
											)}
											{(status === "waiting_for_input" || status === "needs_input") && (
												<span className="conv-action-icon conv-action-icon--waiting" title="Needs input" aria-label="Needs input">
													<VSCodePulseDot size={10} />
												</span>
											)}
											{status === "running" && (
												<span className="conv-action-icon conv-action-icon--running" title="Running" aria-label="Running">
													<VSCodeLoadingIcon size={12} spin smooth={false} />
												</span>
											)}
											{status === "thinking" && (
												<span className="conv-action-icon conv-action-icon--thinking" title="Thinking" aria-label="Thinking">
													<VSCodeSparkleIcon size={12} animated />
												</span>
											)}
											{subtitleText && (
												<span className={`conv-step-preview conv-step-preview--${status}`} title={subtitleText}>
													{subtitleText}
												</span>
											)}
										</div>
									</div>
								</button>
							)
						})}
						{activeConversations.length === 0 && (
							<p className="sidebar-hint">
								{selectedBot?.bot_type === "ahp" ? "No active sessions" : "No conversations yet"}
							</p>
						)}
					</div>
				</div>
			)}

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

			{/* Create bot modal */}
			{showCreateModal && (
				<CreateBotModal
					token={token}
					onClose={() => setShowCreateModal(false)}
					onBotCreated={async (created) => {
						setShowCreateModal(false)
						if (created?.token) setCreatedToken(created.token)
						await onBotsChange()
						if (created?.id) onSelectBot(created.id)
					}}
				/>
			)}
		</aside>
	)
}
