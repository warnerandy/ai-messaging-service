import React, { useState, useEffect, useRef } from "react"
import BotTokenReveal from "./BotTokenReveal.jsx"
import CreateBotModal from "./CreateBotModal.jsx"
import { VSCodeLoadingIcon, VSCodeSparkleIcon, VSCodePulseDot } from "./VSCodeWorkingIcons.jsx"
import {
	getSessionProjectInfo,
	getProjectInfo,
	isUuidOrHash,
	formatSessionTitle,
	getProjectMetadataForGroup,
	getParentSessionId,
	isSessionNested,
	findParentSession,
	orderSessionsHierarchically,
} from "../lib/projectInfo.js"
import { getSessionAlarms } from "../lib/notifications.js"

export {
	getSessionProjectInfo,
	getProjectInfo,
	isUuidOrHash,
	formatSessionTitle,
	getProjectMetadataForGroup,
	getParentSessionId,
	isSessionNested,
	findParentSession,
	orderSessionsHierarchically,
}

export function highlightMatch(text, query) {
	if (!text) return ""
	if (!query || typeof query !== "string" || !query.trim()) {
		return text
	}
	const q = query.trim()
	const lowerText = text.toLowerCase()
	const lowerQ = q.toLowerCase()
	if (!lowerText.includes(lowerQ)) {
		return text
	}
	const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const regex = new RegExp(`(${escaped})`, "gi")
	const parts = text.split(regex)
	return (
		<>
			{parts.map((part, i) =>
				part.toLowerCase() === lowerQ ? (
					<mark key={i} className="search-match-highlight">
						{part}
					</mark>
				) : (
					part
				),
			)}
		</>
	)
}

export function groupSessionsByProject(conversations = []) {
	const groupsMap = new Map()

	for (const conv of conversations) {
		if (!conv) continue
		const projectInfo = getSessionProjectInfo(conv)
		let projectName = (projectInfo?.name || "").trim()
		if (isUuidOrHash(projectName)) {
			projectName = ""
		}
		const groupKey = projectName.toLowerCase() || "__no_project__"
		const displayName = projectName || "No Project"

		if (!groupsMap.has(groupKey)) {
			groupsMap.set(groupKey, {
				key: groupKey,
				name: displayName,
				hasProject: Boolean(projectName),
				path: projectInfo?.path || projectInfo?.uri || "",
				repository: projectInfo?.repository || "",
				branch: projectInfo?.branch || "",
				workingDirectories: projectInfo?.workingDirectories || [],
				conversations: [],
				latestTimestamp: 0,
				hasActiveSession: false,
			})
		}

		const group = groupsMap.get(groupKey)
		group.conversations.push(conv)

		const status = conv.status || "idle"
		if (
			status === "running" ||
			status === "waiting_for_input" ||
			status === "needs_input" ||
			status === "thinking"
		) {
			group.hasActiveSession = true
		}

		const ts = getSessionTimestamp(conv)
		const timeMs = ts ? new Date(ts).getTime() : 0
		if (timeMs > group.latestTimestamp) {
			group.latestTimestamp = timeMs
		}
	}

	// Sort sessions under each project group by active status first, then by last updated timestamp descending
	for (const group of groupsMap.values()) {
		group.conversations.sort((a, b) => {
			const aActive = isSessionActive(a)
			const bActive = isSessionActive(b)
			if (aActive !== bActive) {
				return aActive ? -1 : 1
			}

			const aTime = getConversationUpdatedTimestamp(a)
			const bTime = getConversationUpdatedTimestamp(b)
			if (bTime !== aTime) {
				return bTime - aTime
			}

			return getSessionStableId(b) - getSessionStableId(a)
		})

		group.conversations = orderSessionsHierarchically(group.conversations)
	}

	return Array.from(groupsMap.values()).sort((a, b) => {
		if (a.hasActiveSession && !b.hasActiveSession) return -1
		if (!a.hasActiveSession && b.hasActiveSession) return 1
		if (b.latestTimestamp !== a.latestTimestamp) {
			return b.latestTimestamp - a.latestTimestamp
		}
		if (a.hasProject && !b.hasProject) return -1
		if (!a.hasProject && b.hasProject) return 1
		return a.name.localeCompare(b.name)
	})
}

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
	const activeStatuses = ["waiting_for_input", "needs_input", "running", "thinking", "active"]

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

export function getSessionSubtitle(conv, status, isDone, isAhp = false) {
	if (!conv) return ""
	const meta = conv.metadata || {}

	if (isDone) {
		const step = meta.step || meta.current_step || "Completed"
		return isUuidOrHash(step) ? "Completed" : step
	}

	if (status === "waiting_for_input" || status === "needs_input") {
		const text =
			meta.step || meta.question?.title || meta.current_step || meta.question?.prompt || ""
		return isUuidOrHash(text) ? "" : text
	}

	if (status === "running") {
		const text =
			meta.step || meta.current_step || meta.action || (meta.tool ? `Running ${meta.tool}...` : "")
		return isUuidOrHash(text) ? "" : text
	}

	if (status === "thinking") {
		const text = meta.step || meta.current_step || (meta.tool ? `Evaluating ${meta.tool}...` : "")
		return isUuidOrHash(text) ? "" : text
	}

	// idle or other statuses
	const candidate =
		meta.current_step ||
		meta.step ||
		meta.action ||
		(Array.isArray(meta.prompt_queue) && meta.prompt_queue.length > 0
			? `${meta.prompt_queue.length} prompt${meta.prompt_queue.length > 1 ? "s" : ""} queued`
			: null) ||
		meta.preview

	if (candidate && !isUuidOrHash(candidate)) {
		return candidate
	}

	if (isAhp && conv.external_session_id && !isUuidOrHash(conv.external_session_id)) {
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
		conv.updated_at,
		conv.updatedAt,
		conv.last_used_at,
		conv.lastUsedAt,
		conv.metadata?.last_used_at,
		conv.metadata?.lastUsedAt,
		conv.metadata?.timestamp,
		conv.timestamp,
		conv.inserted_at,
		conv.insertedAt,
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

export function getConversationUpdatedTimestamp(conv) {
	if (!conv) return 0
	const dateStr = getSessionTimestamp(conv)
	if (dateStr) {
		const time = new Date(dateStr).getTime()
		if (!Number.isNaN(time)) return time
	}
	const fallback = conv.updated_at || conv.inserted_at
	if (fallback) {
		const time = new Date(fallback).getTime()
		if (!Number.isNaN(time)) return time
	}
	return 0
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

export function getSessionDisplayTooltip(conv, allConversations = []) {
	if (!conv) return ""
	const dateStr = getSessionTimestamp(conv)
	const timeFormatted =
		dateStr && !Number.isNaN(new Date(dateStr).getTime()) ? new Date(dateStr).toLocaleString() : ""
	const isNested = isSessionNested(conv, allConversations)
	if (isNested) {
		const parent = findParentSession(conv, allConversations)
		const parentId = getParentSessionId(conv)
		const parentTitle = parent
			? formatSessionTitle(parent.title || parent.external_session_id)
			: parentId
		const prefix = parentTitle ? `Nested under: "${parentTitle}"` : "Nested session"
		return timeFormatted ? `${prefix} • ${timeFormatted}` : prefix
	}
	return timeFormatted
}

export function getSessionLastUsedTimestamp(conv) {
	if (!conv) return 0
	const dateStr =
		conv.last_user_input_time ||
		conv.lastUserInputTime ||
		conv.metadata?.last_user_input_time ||
		conv.metadata?.lastUserInputTime ||
		conv.last_message_at ||
		conv.lastMessageAt ||
		conv.metadata?.last_message_at ||
		conv.metadata?.lastMessageAt ||
		conv.last_modified_time ||
		conv.lastModifiedTime ||
		conv.metadata?.last_modified_time ||
		conv.metadata?.lastModifiedTime ||
		conv.metadata?.source_updated_at ||
		conv.source_updated_at
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
				getSessionLastUsedTimestamp(a) || (a.updated_at ? new Date(a.updated_at).getTime() : 0)
			const bTime =
				getSessionLastUsedTimestamp(b) || (b.updated_at ? new Date(b.updated_at).getTime() : 0)

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
	onOpenSettings,
	isOpen,
	appConnection,
}) {
	const [createdToken, setCreatedToken] = useState(null)
	const [deletingId, setDeletingId] = useState(null)
	const [showCreateModal, setShowCreateModal] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
	const [searchQuery, setSearchQuery] = useState("")
	const [hideDone, setHideDone] = useState(() => {
		const saved = localStorage.getItem("messaging.hide_done_sessions")
		return saved !== "false"
	})
	const [sessionAlarms, setSessionAlarms] = useState(() => getSessionAlarms())

	useEffect(() => {
		const handleAlarmChange = () => setSessionAlarms(getSessionAlarms())
		window.addEventListener("session-alarm-changed", handleAlarmChange)
		return () => window.removeEventListener("session-alarm-changed", handleAlarmChange)
	}, [])

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
		if (!c || c.status === "archived") return false
		if (isSessionDone(c)) return true
		if (!isSessionActive(c) && isSessionOlderThanDays(c, 5)) return true
		return false
	}).length

	const hasSearch = Boolean(searchQuery.trim())
	const normalizedQuery = searchQuery.trim().toLowerCase()

	const activeConversations = hasSearch
		? sortConversations(
				(conversations || []).filter((c) => {
					if (!c || c.status === "archived") return false
					const t = (c.title || "").toLowerCase()
					const ft = formatSessionTitle(c.title).toLowerCase()
					return t.includes(normalizedQuery) || ft.includes(normalizedQuery)
				}),
				isAhp,
			)
		: orderSessionsHierarchically(
				sortConversations(
					(conversations || []).filter((c) => {
						if (!c || c.status === "archived") return false

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
				),
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

	const [groupByProject, setGroupByProject] = useState(() => {
		try {
			const saved = localStorage.getItem("messaging.group_by_project")
			if (saved !== null) return saved === "true"
		} catch (e) {}
		return false
	})

	const [collapsedProjects, setCollapsedProjects] = useState(() => {
		try {
			const saved = localStorage.getItem("messaging.collapsed_projects")
			if (saved) {
				const parsed = JSON.parse(saved)
				if (Array.isArray(parsed)) return new Set(parsed)
			}
		} catch (e) {}
		return new Set()
	})

	function toggleGroupByProject() {
		setGroupByProject((prev) => {
			const next = !prev
			try {
				localStorage.setItem("messaging.group_by_project", String(next))
			} catch (e) {}
			return next
		})
	}

	function toggleProjectCollapse(projectKey) {
		setCollapsedProjects((prev) => {
			const next = new Set(prev)
			if (next.has(projectKey)) {
				next.delete(projectKey)
			} else {
				next.add(projectKey)
			}
			try {
				localStorage.setItem("messaging.collapsed_projects", JSON.stringify(Array.from(next)))
			} catch (e) {}
			return next
		})
	}

	// Auto-expand the project group of the active conversation if needed
	useEffect(() => {
		if (!selectedConversationId) return
		const current = (conversations || []).find((c) => c.id === selectedConversationId)
		if (!current) return
		const info = getSessionProjectInfo(current)
		const groupKey = (info?.name || "").trim().toLowerCase() || "__no_project__"
		if (collapsedProjects.has(groupKey)) {
			setCollapsedProjects((prev) => {
				if (!prev.has(groupKey)) return prev
				const next = new Set(prev)
				next.delete(groupKey)
				try {
					localStorage.setItem("messaging.collapsed_projects", JSON.stringify(Array.from(next)))
				} catch (e) {}
				return next
			})
		}
	}, [selectedConversationId, conversations])

	function renderConversationItem(conv, isGrouped = false) {
		const status = conv.status || "idle"
		const isDone = isSessionDone(conv)
		const subtitleText = getSessionSubtitle(conv, status, isDone, isAhp)
		const timeText = formatCompactRelativeTime(conv)
		const tooltipText = getSessionDisplayTooltip(conv, conversations)
		const projectInfo = getSessionProjectInfo(conv)
		const isAlarmArmed = Boolean(sessionAlarms[String(conv.id)])
		const isNested = isSessionNested(conv, conversations)
		const parentConv = findParentSession(conv, conversations)
		const parentId = getParentSessionId(conv)
		const parentTitle = parentConv
			? formatSessionTitle(parentConv.title || parentConv.external_session_id)
			: parentId

		return (
			<div
				key={conv.id}
				className={`conv-item-wrapper ${isNested ? "conv-item-wrapper--nested" : ""} ${conv.id === selectedConversationId ? "conv-item-wrapper--active" : ""}`}
			>
				<button
					type="button"
					className={`conv-item conv-item--two-row ${isNested ? "conv-item--nested" : ""} ${conv.id === selectedConversationId ? "conv-item--active" : ""} ${isDone ? "conv-item--done" : ""}`}
					data-nested={isNested ? "true" : undefined}
					data-parent-id={parentId || undefined}
					onClick={() => {
						if (onSelectConversation) {
							onSelectConversation(conv.id)
						}
						if (conv.id === selectedConversationId) {
							window.dispatchEvent(
								new CustomEvent("sync-active-conversation", {
									detail: { conversationId: conv.id },
								}),
							)
						}
					}}
					title={tooltipText}
				>
					{/* Row 1: Status Dot, Title, and Actions / Time */}
					<div className="conv-row conv-row--top">
						<div className="conv-title-col">
							{isNested && (
								<span
									className="conv-nested-icon"
									title={parentTitle ? `Nested under: ${parentTitle}` : "Nested session"}
									aria-label="Nested session"
									data-testid="nested-icon"
								>
									<svg
										width="11"
										height="11"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="conv-nested-arrow-icon"
										aria-hidden="true"
									>
										<polyline points="4 2 4 10 12 10" />
										<polyline points="9 7 12 10 9 13" />
									</svg>
								</span>
							)}
							<span className={`conv-status-dot conv-status-dot--${status}`} />
							<span className="conv-title" title={conv.title || "Session"}>
								{highlightMatch(formatSessionTitle(conv.title), searchQuery)}
							</span>
							{isAlarmArmed && (
								<span
									className="session-alarm-indicator"
									title="Alarm active for this session"
									aria-label="Alarm active"
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="session-alarm-bell"
										aria-hidden="true"
									>
										<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
										<path d="M13.73 21a2 2 0 0 1-3.46 0" />
									</svg>
								</span>
							)}
						</div>

						<div className="conv-item-actions">
							{Boolean(
								conv.unread ||
								conv.has_unread ||
								conv.metadata?.unread ||
								(typeof conv.unread_count === "number" && conv.unread_count > 0),
							) && (
								<span
									className="conv-action-icon conv-action-icon--unread"
									title={
										typeof conv.unread_count === "number" && conv.unread_count > 0
											? `${conv.unread_count} unread`
											: "Unread"
									}
									aria-label="Unread"
								>
									<span className="unread-dot" />
									{typeof conv.unread_count === "number" && conv.unread_count > 0
										? conv.unread_count
										: null}
								</span>
							)}
							{isDone && (
								<span
									className="conv-done-indicator"
									title="Done / Completed"
									aria-label="Done / Completed"
								>
									✓
								</span>
							)}
							{timeText && (
								<span className="conv-time" title={tooltipText}>
									{timeText}
								</span>
							)}
						</div>
					</div>

					{/* Row 2: Secondary Info (Project Pill, Nested Pill, Status Working Icon, Step Preview) */}
					<div className="conv-row conv-row--bottom">
						<div className="conv-meta-col">
							{isNested && (
								<span
									className="conv-nested-pill"
									title={parentTitle ? `Nested under: ${parentTitle}` : "Nested session"}
									data-testid="nested-pill"
								>
									↳ Nested
								</span>
							)}
							{(!isGrouped || !isAhp) && projectInfo?.name && (
								<span className="conv-project-pill" title={projectInfo.uri || projectInfo.name}>
									{projectInfo.name}
								</span>
							)}
							{(status === "waiting_for_input" || status === "needs_input") && (
								<span
									className="conv-action-icon conv-action-icon--waiting"
									title="Needs input"
									aria-label="Needs input"
								>
									<VSCodePulseDot size={10} />
								</span>
							)}
							{status === "running" && (
								<span
									className="conv-action-icon conv-action-icon--running"
									title="Running"
									aria-label="Running"
								>
									<VSCodeLoadingIcon size={12} spin smooth={false} />
								</span>
							)}
							{status === "thinking" && (
								<span className="conv-action-icon conv-action-icon--thinking" title="Thinking">
									<VSCodeSparkleIcon size={12} animated />
								</span>
							)}
							{subtitleText && (
								<span
									className={`conv-step-preview conv-step-preview--${status}`}
									title={subtitleText}
								>
									{subtitleText}
								</span>
							)}
						</div>
					</div>
				</button>

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
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="2" y="3" width="20" height="5" rx="1" />
							<path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
							<path d="M10 12h4" />
						</svg>
					</button>
				)}
			</div>
		)
	}

	return (
		<aside className={`sidebar ${isOpen ? "sidebar--open" : ""}`}>
			{/* User info & Settings trigger */}
			<button
				type="button"
				className="sidebar-user"
				onClick={() => {
					if (onOpenSettings) {
						onOpenSettings()
					} else {
						window.dispatchEvent(
							new CustomEvent("open-settings", {
								detail: { tab: "states" },
							}),
						)
					}
				}}
				title="Open settings (AHP statuses & alert list)"
				aria-label={`Open settings for ${userEmail || "User"}`}
			>
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
				<span className="sidebar-user-settings-icon" aria-hidden="true">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				</span>
			</button>

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
							{isAhp && (
								<button
									type="button"
									className={`sidebar-icon-btn ${groupByProject ? "sidebar-icon-btn--active" : ""}`}
									onClick={toggleGroupByProject}
									title={groupByProject ? "View as flat list" : "Group by project"}
									aria-label={groupByProject ? "View as flat list" : "Group by project"}
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
									</svg>
								</button>
							)}
							{hiddenCount > 0 && (
								<button
									type="button"
									className={`sidebar-icon-btn ${!hideDone ? "sidebar-icon-btn--active" : ""}`}
									onClick={toggleHideDone}
									title={
										hideDone ? "Show hidden & completed chats" : "Hide completed & older chats"
									}
									aria-label={
										hideDone ? "Show hidden & completed chats" : "Hide completed & older chats"
									}
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
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

					<div className="sidebar-search-wrapper">
						<div className="sidebar-search-box">
							<svg
								className="sidebar-search-icon"
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<circle cx="11" cy="11" r="8" />
								<line x1="21" y1="21" x2="16.65" y2="16.65" />
							</svg>
							<input
								type="text"
								className="sidebar-search-input"
								data-testid="session-search-input"
								placeholder={
									selectedBot?.bot_type === "ahp" ? "Search sessions..." : "Search conversations..."
								}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setSearchQuery("")
								}}
							/>
							{searchQuery && (
								<button
									type="button"
									className="sidebar-search-clear"
									onClick={() => setSearchQuery("")}
									aria-label="Clear search input"
								>
									✕
								</button>
							)}
						</div>
						{hasSearch && (
							<div className="sidebar-search-meta">
								<span className="sidebar-search-count">
									{activeConversations.length}{" "}
									{activeConversations.length === 1 ? "match" : "matches"}
								</span>
							</div>
						)}
					</div>

					<div className="conv-list">
						{hasSearch ? (
							activeConversations.length > 0 ? (
								activeConversations.map((conv) => renderConversationItem(conv, false))
							) : (
								<div className="sidebar-search-empty">
									<p>No sessions matching &quot;{searchQuery}&quot;</p>
									<button
										type="button"
										className="sidebar-clear-search-btn sidebar-search-reset-btn"
										onClick={() => setSearchQuery("")}
									>
										Clear search
									</button>
								</div>
							)
						) : isAhp && groupByProject ? (
							groupSessionsByProject(activeConversations).map((group) => {
								const isCollapsed = collapsedProjects.has(group.key)
								const primaryConversation = group.conversations[0]
								return (
									<div key={group.key} className="project-group">
										<div className="project-group-header-wrapper">
											<button
												type="button"
												className="project-group-header"
												onClick={() => {
													toggleProjectCollapse(group.key)
													if (primaryConversation && onSelectConversation) {
														onSelectConversation(primaryConversation.id)
													}
												}}
												aria-expanded={!isCollapsed}
												aria-label={`Project: ${group.name}, ${group.conversations.length} items`}
											>
												<span
													className="project-group-chevron-hit"
													onClick={(e) => {
														e.stopPropagation()
														toggleProjectCollapse(group.key)
													}}
													title={isCollapsed ? "Expand project" : "Collapse project"}
												>
													<svg
														className={`project-group-chevron ${isCollapsed ? "" : "project-group-chevron--expanded"}`}
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2.5"
														strokeLinecap="round"
														strokeLinejoin="round"
													>
														<polyline points="9 18 15 12 9 6" />
													</svg>
												</span>
												<svg
													className="project-group-icon"
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
												</svg>
												<span className="project-group-name" title={group.path || group.name}>
													{group.name}
												</span>
												{group.hasActiveSession && (
													<span
														className="project-group-active-dot"
														title="Has active sessions"
														aria-label="Has active sessions"
													/>
												)}
												<span className="project-group-badge">{group.conversations.length}</span>
											</button>

											{onCreateConversation && (
												<button
													type="button"
													className="project-group-add-btn"
													onClick={(e) => {
														e.stopPropagation()
														if (isCollapsed) {
															toggleProjectCollapse(group.key)
														}
														const metadata = getProjectMetadataForGroup(group)
														const title =
															group.hasProject && group.name && group.name !== "No Project"
																? `${group.name} Session`
																: undefined
														onCreateConversation({
															project: group,
															projectName: group.hasProject ? group.name : undefined,
															title,
															metadata,
														})
													}}
													title={`New session in ${group.name}`}
													aria-label={`New session in ${group.name}`}
												>
													<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
														<path
															d="M8 3v10M3 8h10"
															stroke="currentColor"
															strokeWidth="1.75"
															strokeLinecap="round"
														/>
													</svg>
												</button>
											)}
										</div>

										{!isCollapsed && (
											<div className="project-group-items">
												{group.conversations.map((conv) => renderConversationItem(conv, true))}
											</div>
										)}
									</div>
								)
							})
						) : (
							activeConversations.map((conv) => renderConversationItem(conv, false))
						)}
						{!hasSearch && activeConversations.length === 0 && (
							<p className="sidebar-hint">
								{selectedBot?.bot_type === "ahp" ? "No active sessions" : "No conversations yet"}
							</p>
						)}
					</div>
				</div>
			)}

			{/* Sidebar Footer with Settings and Logout */}
			<div className="sidebar-footer">
				<button
					type="button"
					className="sidebar-settings-btn"
					onClick={() => {
						if (onOpenSettings) {
							onOpenSettings()
						} else {
							window.dispatchEvent(new CustomEvent("open-settings", { detail: { tab: "alerts" } }))
						}
					}}
					aria-label="Settings and working states"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
						<path
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
					</svg>
					Settings
				</button>
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
			</div>

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
