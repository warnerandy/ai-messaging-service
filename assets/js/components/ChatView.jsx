import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react"
import { Socket } from "phoenix"
import MessageBubbleView from "./MessageBubble.jsx"
import TypingIndicatorView from "./TypingIndicator.jsx"
import LiveThinking from "./LiveThinking.jsx"
import SubagentsPanel from "./SubagentsPanel.jsx"
import QuestionApprovalCard from "./QuestionApprovalCard.jsx"
import PromptQueue from "./PromptQueue.jsx"
import BotConfigModal from "./BotConfigModal.jsx"
import SettingsModal from "./SettingsModal.jsx"
import ProjectInfoModal from "./ProjectInfoModal.jsx"
import {
	getProjectInfo,
	formatSessionTitle,
	isSessionNested,
	findParentSession,
	getParentSessionId,
	getSessionSubagents,
	getSessionProcesses,
} from "../lib/projectInfo.js"
import { formatQuestionAnswer, resolvePendingQuestion } from "../lib/ahpQuestion.js"
import {
	VSCodeWorkingStateIcon,
	VSCodeProgressBar,
	VSCodeSparkleIcon,
} from "./VSCodeWorkingIcons.jsx"
import {
	createConversationTimeoutMessage,
	createConversationMessage,
	getConversation,
	getConversationChannel,
	uploadConversationAsset,
} from "../lib/data.js"
import {
	notifyBotResponse,
	notifySessionCompleted,
	notifyWaitingForInput,
	requestNotificationPermission,
	getNotificationPermission,
	isNotificationSupported,
	showNotificationIfBackgrounded,
	isSessionAlarmEnabled,
	toggleSessionAlarm,
	unlockAudio,
	playConfirmationPing,
	triggerConfirmationVibration,
} from "../lib/notifications.js"
import { startThinkingTimer, stopThinkingTimer } from "../thinkingTimer.mjs"

const BOT_RESPONSE_TIMEOUT_MS = 10 * 60 * 1000

function getTimeoutStartMs(message) {
	const timestamp = message.acknowledged_at ?? message.inserted_at
	const parsed = timestamp ? Date.parse(timestamp) : Number.NaN
	return Number.isNaN(parsed) ? null : parsed
}

function isBotTimeoutSystemMessage(message) {
	const timeoutForMessageId = Number(message.metadata?.timeout_for_message_id)
	return (
		message.role === "system" &&
		message.metadata?.kind === "bot_timeout" &&
		Number.isInteger(timeoutForMessageId)
	)
}

export function deriveConversationState(messages) {
	let hasBotResponseAfter = false
	const nextMessages = [...messages]
	const timedOutMessageIds = new Set(
		nextMessages
			.filter((message) => isBotTimeoutSystemMessage(message))
			.map((message) => Number(message.metadata.timeout_for_message_id)),
	)

	for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
		const message = nextMessages[index]

		if (message.role === "bot") {
			hasBotResponseAfter = true
			continue
		}

		if (message.role === "user") {
			const awaitingResponse =
				Boolean(message.acknowledged) &&
				!hasBotResponseAfter &&
				!timedOutMessageIds.has(message.id) &&
				!message.timeoutReported

			nextMessages[index] = {
				...message,
				awaitingResponse,
			}

			// This user message consumes the "no bot response" state;
			// earlier user messages need their own bot response after them.
			hasBotResponseAfter = false
			continue
		}

		if (isBotTimeoutSystemMessage(message)) {
			hasBotResponseAfter = true
		}
	}

	return {
		messages: nextMessages,
		botIsTyping: nextMessages.some(
			(message) => message.role === "user" && message.awaitingResponse,
		),
	}
}

export function normalizeMessage(message, fallback = {}) {
	const fromSuggestion =
		message.fromSuggestion ??
		message.is_suggestion ??
		fallback.fromSuggestion ??
		fallback.is_suggestion ??
		false

	return {
		...fallback,
		...message,
		acknowledged: message.acknowledged ?? fallback.acknowledged ?? false,
		timeoutReported: message.timeoutReported ?? fallback.timeoutReported ?? false,
		fromSuggestion,
	}
}

export default function ChatView({
	token,
	bot,
	conversations,
	selectedConversationId,
	models,
	onRefreshModels,
	onBotStatusChange,
	onConversationStatusChange,
	onConversationTouch,
	onSessionsUpdated,
	onArchiveConversation,
	onSelectConversation,
	onToggleSidebar,
}) {
	const [messages, setMessages] = useState([])
	const [inputValue, setInputValue] = useState("")
	const [selectedModel, setSelectedModel] = useState("")
	const [selectedContextSize, setSelectedContextSize] = useState("")
	const [botIsTyping, setBotIsTyping] = useState(false)
	const [sending, setSending] = useState(false)
	const [selectedFile, setSelectedFile] = useState(null)
	const [uploading, setUploading] = useState(false)
	// Maps message id -> value of the suggestion the user clicked
	const [usedSuggestions, setUsedSuggestions] = useState({})
	const [sessionStatus, setSessionStatus] = useState("idle")
	const [sessionMetadata, setSessionMetadata] = useState({})
	const [thinkingText, setThinkingText] = useState("")
	const [toolCalls, setToolCalls] = useState([])
	const [pendingQuestion, setPendingQuestion] = useState(null)
	const [promptQueue, setPromptQueue] = useState([])
	const [isLoadingMessages, setIsLoadingMessages] = useState(false)
	const [showConfigModal, setShowConfigModal] = useState(false)
	const [showSettingsModal, setShowSettingsModal] = useState(false)
	const [settingsInitialTab, setSettingsInitialTab] = useState("alerts")
	const [showProjectModal, setShowProjectModal] = useState(false)
	const [showSubagentsDrawer, setShowSubagentsDrawer] = useState(false)

	useEffect(() => {
		setShowSubagentsDrawer(false)
	}, [selectedConversationId])

	useEffect(() => {
		const handleOpenSettings = (e) => {
			setSettingsInitialTab(e?.detail?.tab || "alerts")
			setShowSettingsModal(true)
		}
		window.addEventListener("open-settings", handleOpenSettings)
		return () => window.removeEventListener("open-settings", handleOpenSettings)
	}, [])
	const messagesEndRef = useRef(null)
	const messagesContainerRef = useRef(null)
	const isAtBottomRef = useRef(true)
	const socketRef = useRef(null)
	const channelRef = useRef(null)
	const renderedIdsRef = useRef(new Set())
	const hasJoinedConversationRef = useRef(false)
	const messagesRef = useRef([])
	const messagesCacheRef = useRef(new Map())
	const typingTimeoutRef = useRef(null)
	const responseTimeoutsRef = useRef(new Map())
	const timeoutRequestsRef = useRef(new Set())
	const inputRef = useRef(null)

	const [notificationPermission, setNotificationPermission] = useState(() =>
		getNotificationPermission(),
	)
	const [alarmArmed, setAlarmArmed] = useState(() => isSessionAlarmEnabled(selectedConversationId))
	const [alarmBanner, setAlarmBanner] = useState(null)

	useEffect(() => {
		setAlarmArmed(isSessionAlarmEnabled(selectedConversationId))
	}, [selectedConversationId])

	useEffect(() => {
		const handleAlarmChange = (e) => {
			if (e.detail?.conversationId === selectedConversationId) {
				setAlarmArmed(!!e.detail.enabled)
			}
		}
		window.addEventListener("session-alarm-changed", handleAlarmChange)
		return () => window.removeEventListener("session-alarm-changed", handleAlarmChange)
	}, [selectedConversationId])

	useEffect(() => {
		const handleAlarmFired = (e) => {
			const { conversationId, botName, title, type, question } = e.detail || {}
			const bannerTitle = title || botName || "Session"
			const bannerMessage =
				type === "waiting_for_input"
					? question?.prompt || question?.title || "Waiting for your answer / approval"
					: type === "session_completed"
						? "Session turn completed"
						: "New response received"

			setAlarmBanner({
				conversationId,
				title: bannerTitle,
				message: bannerMessage,
			})

			const timer = setTimeout(() => {
				setAlarmBanner(null)
			}, 8000)
			return () => clearTimeout(timer)
		}

		window.addEventListener("session-alarm-fired", handleAlarmFired)
		return () => window.removeEventListener("session-alarm-fired", handleAlarmFired)
	}, [])

	const prevSessionStatusRef = useRef(sessionStatus)

	useEffect(() => {
		prevSessionStatusRef.current = sessionStatus
	}, [sessionStatus])

	const activeConv = conversations?.find((c) => c.id === selectedConversationId)
	const isArchived = Boolean(
		activeConv &&
		(activeConv.status === "archived" ||
			activeConv.status === "done" ||
			activeConv.status === "completed"),
	)
	const projectInfo = getProjectInfo(activeConv, sessionMetadata)
	const isAhp =
		bot?.bot_type === "ahp" ||
		activeConv?.metadata?.bot_type === "ahp" ||
		Boolean(activeConv?.external_session_id) ||
		Boolean(activeConv?.parent_session_id)
	const sessionSubagents = getSessionSubagents(
		activeConv,
		conversations,
		sessionMetadata,
		toolCalls,
	)
	const sessionProcesses = getSessionProcesses(
		activeConv,
		sessionMetadata,
		toolCalls,
		sessionStatus,
	)
	const runningSubagentsCount = sessionSubagents.filter((s) => s.isRunning).length
	const runningProcessesCount = sessionProcesses.filter((p) => p.isRunning).length

	function startBotThinking(timeoutMs = null) {
		startThinkingTimer(typingTimeoutRef, setBotIsTyping, timeoutMs)
	}

	function stopBotThinking() {
		stopThinkingTimer(typingTimeoutRef, setBotIsTyping)
	}

	const clearResponseTimeout = useCallback((messageId) => {
		const timeoutId = responseTimeoutsRef.current.get(messageId)
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId)
			responseTimeoutsRef.current.delete(messageId)
		}
	}, [])

	const handleResponseTimeout = useCallback(
		async (messageId) => {
			timeoutRequestsRef.current.delete(messageId)

			setMessages((prev) => {
				const next = prev.map((message) =>
					message.id === messageId && message.role === "user"
						? { ...message, timeoutReported: true }
						: message,
				)
				const state = deriveConversationState(next)
				setBotIsTyping(state.botIsTyping)
				return state.messages
			})

			try {
				const response = await createConversationTimeoutMessage(
					token,
					selectedConversationId,
					messageId,
				)
				if (response?.id) renderedIdsRef.current.add(response.id)
			} catch (err) {
				if (!/already responded|already reported/i.test(String(err?.message ?? ""))) {
					console.error("Timeout system message failed:", err)
				}
			}
		},
		[selectedConversationId, token],
	)

	// Set document title to bot name
	useEffect(() => {
		if (bot?.name) {
			document.title = bot.name
		} else {
			document.title = "Botamus Prime"
		}
		return () => {
			document.title = "Botamus Prime"
		}
	}, [bot?.name])

	// Track whether the user has scrolled up or is at the bottom
	const handleMessagesScroll = useCallback(() => {
		const container = messagesContainerRef.current
		if (!container) return
		const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
		// Tight threshold: if within 16px of bottom, consider user pinned to bottom.
		// If scrolled higher than 32px, user deliberately scrolled up to read history.
		if (distanceToBottom <= 16) {
			isAtBottomRef.current = true
		} else if (distanceToBottom > 32) {
			isAtBottomRef.current = false
		}
	}, [])

	// If the user was already at the bottom, keep them pinned to the bottom smoothly without jarring post-paint jumps
	useLayoutEffect(() => {
		const container = messagesContainerRef.current
		if (isAtBottomRef.current && container) {
			container.scrollTop = container.scrollHeight
		}
	}, [messages, botIsTyping, thinkingText, toolCalls, pendingQuestion])

	// Always scroll to bottom when switching sessions
	useLayoutEffect(() => {
		isAtBottomRef.current = true
		const container = messagesContainerRef.current
		if (container) {
			container.scrollTop = container.scrollHeight
		}
	}, [selectedConversationId])

	// Keep bottom pinned synchronously when elements inside the chat container dynamically resize (markdown, thinking chunks, tool steps)
	useEffect(() => {
		const container = messagesContainerRef.current
		if (!container || typeof ResizeObserver === "undefined") return

		const observer = new ResizeObserver(() => {
			if (isAtBottomRef.current && container) {
				container.scrollTop = container.scrollHeight
			}
		})

		observer.observe(container)
		Array.from(container.children).forEach((child) => observer.observe(child))

		return () => observer.disconnect()
	}, [selectedConversationId, messages.length])

	useEffect(() => {
		messagesRef.current = messages
		if (selectedConversationId && messages.length > 0) {
			messagesCacheRef.current.set(selectedConversationId, messages)
		}
	}, [messages, selectedConversationId])

	const extractLastMessageId = useCallback((items) => {
		if (!Array.isArray(items)) return null
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const message = items[index]
			if (!message || message.pending) continue
			if (typeof message.id === "number") return message.id
			if (typeof message.id === "string" && /^\d+$/.test(message.id)) {
				return parseInt(message.id, 10)
			}
		}
		return null
	}, [])

	const refetchMissedMessages = useCallback(async () => {
		if (!selectedConversationId || !token) return
		const afterId = extractLastMessageId(messagesRef.current)
		const params = afterId ? { afterId, limit: 50 } : { limit: 50 }

		try {
			const res = await getConversation(token, selectedConversationId, params)
			const fetched = (res.messages || []).map((message) => normalizeMessage(message))
			if (fetched.length === 0) return

			fetched.forEach((message) => renderedIdsRef.current.add(message.id))
			setMessages((prev) => {
				const byId = new Map()
				const next = [...prev]

				next.forEach((message, index) => {
					if (!message.pending && message.id != null) {
						byId.set(String(message.id), index)
					}
				})

				let hasChanges = false

				fetched.forEach((incoming) => {
					const key = String(incoming.id)
					const existingIndex = byId.get(key)

					if (existingIndex === undefined) {
						byId.set(key, next.length)
						next.push(incoming)
						hasChanges = true
						return
					}

					const existing = next[existingIndex]
					const normalized = normalizeMessage(incoming, {
						...existing,
						pending: false,
						failed: false,
					})

					if (
						existing.body !== normalized.body ||
						existing.role !== normalized.role ||
						existing.pending !== normalized.pending ||
						existing.failed !== normalized.failed ||
						existing.status !== normalized.status ||
						existing.metadata?.thinking !== normalized.metadata?.thinking
					) {
						next[existingIndex] = normalized
						hasChanges = true
					}
				})

				if (!hasChanges) return prev

				const state = deriveConversationState(next)
				setBotIsTyping(state.botIsTyping)
				return state.messages
			})
		} catch (err) {
			console.error("Missed message refetch failed:", err)
		}
	}, [extractLastMessageId, selectedConversationId, token])

	const [isSyncing, setIsSyncing] = useState(false)

	const syncSession = useCallback(
		async (opts = { forceFull: false, notifyBot: true }) => {
			if (!selectedConversationId || !token) return
			setIsSyncing(true)

			if (opts.notifyBot && channelRef.current) {
				try {
					channelRef.current.push("sync_session", {})
				} catch {
					// socket or channel may still be connecting
				}
			}

			try {
				if (opts.forceFull) {
					const res = await getConversation(token, selectedConversationId)
					const msgs = (res?.messages || []).map((message) => normalizeMessage(message))
					msgs.forEach((m) => renderedIdsRef.current.add(m.id))
					const nextState = deriveConversationState(msgs)
					setMessages(nextState.messages)

					if (res?.conversation && res.conversation.id === selectedConversationId) {
						const convStatus = res.conversation.status || "idle"
						setSessionStatus((prev) => {
							if (
								(prev === "running" || prev === "thinking") &&
								(convStatus === "idle" || !convStatus)
							) {
								return prev
							}
							return convStatus
						})
						const convMeta = res.conversation.metadata || {}
						setSessionMetadata((prev) => ({
							...convMeta,
							...prev,
						}))
						if (convMeta.prompt_queue) {
							setPromptQueue(convMeta.prompt_queue)
						}
						if (convMeta.thinking) {
							setThinkingText((prev) => prev || convMeta.thinking)
						}
						if (Array.isArray(convMeta.tool_calls) && convMeta.tool_calls.length > 0) {
							setToolCalls((prev) => (prev.length > 0 ? prev : convMeta.tool_calls))
						}
						const resolvedQ = resolvePendingQuestion(convStatus, convMeta, convMeta.question)
						if (resolvedQ) {
							setPendingQuestion(resolvedQ)
							setTimeout(() => inputRef.current?.focus(), 50)
						} else if (
							convStatus === "idle" ||
							convStatus === "running" ||
							convStatus === "completed" ||
							convStatus === "done"
						) {
							setPendingQuestion(null)
						}
					}
				} else {
					await refetchMissedMessages()
				}
			} catch (err) {
				console.error("Session sync failed:", err)
			} finally {
				setTimeout(() => {
					setIsSyncing(false)
				}, 600)
			}
		},
		[refetchMissedMessages, selectedConversationId, token],
	)

	const handleManualSync = useCallback(() => {
		syncSession({ forceFull: true, notifyBot: true })
	}, [syncSession])

	useEffect(() => {
		const handleSyncActive = (e) => {
			if (!e.detail?.conversationId || e.detail.conversationId === selectedConversationId) {
				handleManualSync()
			}
		}
		window.addEventListener("sync-active-conversation", handleSyncActive)
		return () => window.removeEventListener("sync-active-conversation", handleSyncActive)
	}, [handleManualSync, selectedConversationId])

	// Automatically refetch missed messages when PWA regains visibility or focus
	useEffect(() => {
		if (!selectedConversationId || !token) return

		function handleVisibilityOrFocus() {
			if (document.visibilityState === "visible") {
				refetchMissedMessages()
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityOrFocus)
		window.addEventListener("focus", handleVisibilityOrFocus)

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
			window.removeEventListener("focus", handleVisibilityOrFocus)
		}
	}, [refetchMissedMessages, selectedConversationId, token])

	useEffect(() => {
		if (!selectedConversationId || !token) return

		const activeTimeoutIds = new Set()

		messages.forEach((message) => {
			if (message.role !== "user" || !message.awaitingResponse || message.timeoutReported) return
			if (typeof message.id !== "number") return

			activeTimeoutIds.add(message.id)
			if (responseTimeoutsRef.current.has(message.id) || timeoutRequestsRef.current.has(message.id))
				return

			const startedAt = getTimeoutStartMs(message)
			const remainingMs =
				startedAt == null
					? BOT_RESPONSE_TIMEOUT_MS
					: Math.max(0, BOT_RESPONSE_TIMEOUT_MS - (Date.now() - startedAt))

			const timeoutId = window.setTimeout(() => {
				clearResponseTimeout(message.id)
				timeoutRequestsRef.current.add(message.id)
				handleResponseTimeout(message.id)
			}, remainingMs)

			responseTimeoutsRef.current.set(message.id, timeoutId)
		})

		Array.from(responseTimeoutsRef.current.keys()).forEach((messageId) => {
			if (!activeTimeoutIds.has(messageId)) {
				clearResponseTimeout(messageId)
				timeoutRequestsRef.current.delete(messageId)
			}
		})
	}, [clearResponseTimeout, handleResponseTimeout, messages, selectedConversationId, token])

	// WebSocket connection
	useEffect(() => {
		if (!token) return
		const sock = new Socket("/socket", { params: { token } })
		sock.connect()
		socketRef.current = sock
		return () => {
			sock.disconnect()
			socketRef.current = null
		}
	}, [token])

	// Join conversation channel
	useEffect(() => {
		if (!socketRef.current || !selectedConversationId || !token) return

		let cancelled = false
		let sessionsCh = null

		async function joinChannel() {
			try {
				const info = await getConversationChannel(token, selectedConversationId)
				if (cancelled) return

				if (channelRef.current) {
					channelRef.current.leave()
					channelRef.current = null
				}

				const ch = socketRef.current.channel(info.topic, {})

				ch.on("new_message", (payload) => {
					if (!payload?.message) return
					const incoming = normalizeMessage(payload.message)

					// When a bot message arrives, immediately stop the thinking indicator
					if (incoming.role === "bot") {
						stopBotThinking()
						notifyBotResponse({
							botName: bot?.name,
							conversationTitle: activeConv?.title,
							conversationId: selectedConversationId,
							activeConversationId: selectedConversationId,
							message: incoming,
						})
					}

					if (onConversationTouch) {
						onConversationTouch(selectedConversationId)
					}

					setMessages((prev) => {
						if (renderedIdsRef.current.has(incoming.id)) return prev
						renderedIdsRef.current.add(incoming.id)

						// Reconcile optimistic user messages when the server echo arrives first.
						const optimisticIndex = prev.findIndex(
							(m) => m.pending && m.role === incoming.role && m.body === incoming.body,
						)

						if (optimisticIndex !== -1) {
							const next = [...prev]
							next[optimisticIndex] = normalizeMessage(incoming, {
								...next[optimisticIndex],
								pending: false,
								failed: false,
							})
							const state = deriveConversationState(next)
							setBotIsTyping(state.botIsTyping)
							return state.messages
						}

						const state = deriveConversationState([...prev, incoming])
						setBotIsTyping(state.botIsTyping)
						return state.messages
					})

					showNotificationIfBackgrounded(payload.message, {
						botName: bot?.name,
						conversationTitle: activeConv?.title,
						conversationId: selectedConversationId,
						activeConversationId: selectedConversationId,
					})
				})

				ch.on("message_acknowledged", (payload) => {
					if (!payload?.message_id) return

					setMessages((prev) => {
						const next = prev.map((m) =>
							m.id === payload.message_id
								? { ...m, acknowledged: true, acknowledged_at: new Date().toISOString() }
								: m,
						)
						const state = deriveConversationState(next)
						setBotIsTyping(state.botIsTyping)
						if (state.botIsTyping) startBotThinking()
						return state.messages
					})
				})

				ch.on("bot_status_changed", (payload) => {
					if (payload?.is_working !== undefined) {
						if (payload.is_working) {
							startBotThinking()
						} else {
							stopBotThinking()
						}
					}
					if (payload?.is_connected !== undefined && onBotStatusChange) {
						onBotStatusChange(payload.bot_token_id, { is_connected: payload.is_connected })
					}
				})

				ch.on("session_status_changed", (payload) => {
					if (!payload) return
					const newStatus = payload.status || "idle"
					const prevStatus = prevSessionStatusRef.current
					setSessionStatus(newStatus)
					const meta = payload.metadata || {}
					setSessionMetadata(meta)
					if (meta.prompt_queue) setPromptQueue(meta.prompt_queue)
					const resolvedQ = resolvePendingQuestion(newStatus, meta, payload.question)
					if (resolvedQ) {
						setPendingQuestion(resolvedQ)
						setTimeout(() => inputRef.current?.focus(), 50)
					} else if (
						newStatus === "idle" ||
						newStatus === "running" ||
						newStatus === "completed" ||
						newStatus === "done"
					) {
						setPendingQuestion(null)
					}
					if (newStatus === "idle") {
						setThinkingText("")
						stopBotThinking()
					}

					if (
						newStatus === "idle" ||
						newStatus === "completed" ||
						newStatus === "done" ||
						newStatus === "waiting_for_input" ||
						newStatus === "needs_input"
					) {
						refetchMissedMessages()
						setTimeout(() => refetchMissedMessages(), 400)
					}

					// Active session completes (waiting on next user input)
					if (
						(prevStatus === "running" || prevStatus === "thinking") &&
						(newStatus === "idle" || newStatus === "completed" || newStatus === "done")
					) {
						notifySessionCompleted({
							botName: bot?.name,
							conversationTitle: activeConv?.title,
							conversationId: selectedConversationId,
							activeConversationId: selectedConversationId,
							metadata: meta,
						})
					}

					// Active session wants info / approval
					if (newStatus === "waiting_for_input" || newStatus === "needs_input") {
						notifyWaitingForInput({
							botName: bot?.name,
							conversationTitle: activeConv?.title,
							conversationId: selectedConversationId,
							activeConversationId: selectedConversationId,
							question: resolvedQ,
							metadata: meta,
						})
					}

					if (onConversationStatusChange) {
						onConversationStatusChange(
							payload.conversation_id || selectedConversationId,
							newStatus,
							meta,
						)
					}
				})

				ch.on("ahp_event", (payload) => {
					if (!payload) return
					const { event_type, data } = payload
					if (
						event_type === "thinking" ||
						event_type === "terminal" ||
						event_type === "output" ||
						event_type === "log"
					) {
						const chunk = data?.chunk ?? data?.text ?? data?.thought ?? data?.output ?? ""
						if (chunk) {
							setThinkingText((prev) => prev + chunk)
						}
						if (event_type === "thinking") {
							setSessionStatus("thinking")
							if (onConversationStatusChange) {
								onConversationStatusChange(selectedConversationId, "thinking")
							}
						}
					} else if (event_type === "step" || event_type === "tool_call") {
						setToolCalls((prev) => [...prev, data])
						if (data?.step || data?.tool || data?.name || data?.command) {
							const stepMeta = {
								step: data.step || (data.command ? `Running ${data.command}` : ""),
								tool: data.tool || data.name || (data.command ? "terminal" : ""),
							}
							setSessionMetadata((prev) => ({
								...prev,
								...stepMeta,
							}))
							if (onConversationStatusChange) {
								onConversationStatusChange(selectedConversationId, "running", stepMeta)
							}
						}
					} else if (event_type === "plan") {
						if (data) {
							setSessionMetadata((prev) => ({
								...prev,
								plan: data.plan || data.steps || data,
							}))
						}
					} else if (event_type === "changeset") {
						if (data) {
							setSessionMetadata((prev) => ({
								...prev,
								changeset: data.changeset || data.files || data,
							}))
						}
					} else if (event_type === "subagent" || event_type === "subagents") {
						if (data) {
							setSessionMetadata((prev) => {
								const incomingList = Array.isArray(data)
									? data
									: Array.isArray(data.subagents)
										? data.subagents
										: null
								if (incomingList) {
									return { ...prev, subagents: incomingList }
								}
								const existing = Array.isArray(prev.subagents) ? [...prev.subagents] : []
								const key = data.session_id || data.id || data.conversation_id
								const idx = key
									? existing.findIndex(
											(s) =>
												s && (s.session_id === key || s.id === key || s.conversation_id === key),
										)
									: -1
								if (idx >= 0) {
									existing[idx] = { ...existing[idx], ...data }
								} else {
									existing.push(data)
								}
								return { ...prev, subagents: existing }
							})
						}
					} else if (event_type === "process" || event_type === "processes") {
						if (data) {
							setSessionMetadata((prev) => {
								const incomingList = Array.isArray(data)
									? data
									: Array.isArray(data.processes)
										? data.processes
										: null
								if (incomingList) {
									return { ...prev, processes: incomingList }
								}
								const existing = Array.isArray(prev.processes) ? [...prev.processes] : []
								const key = data.id || data.pid
								const idx = key
									? existing.findIndex((p) => p && (p.id === key || p.pid === key))
									: -1
								if (idx >= 0) {
									existing[idx] = { ...existing[idx], ...data }
								} else {
									existing.push(data)
								}
								return { ...prev, processes: existing }
							})
						}
					} else if (event_type === "question") {
						const resolvedQ = resolvePendingQuestion("waiting_for_input", {}, data)
						setPendingQuestion(resolvedQ)
						setSessionStatus("waiting_for_input")
						setTimeout(() => inputRef.current?.focus(), 50)
						notifyWaitingForInput({
							botName: bot?.name,
							conversationTitle: activeConv?.title,
							conversationId: selectedConversationId,
							activeConversationId: selectedConversationId,
							question: resolvedQ,
							metadata: data,
						})
						if (onConversationStatusChange) {
							onConversationStatusChange(selectedConversationId, "waiting_for_input", {
								question: resolvedQ,
							})
						}
					} else if (event_type === "status") {
						const st = data?.status || "running"
						const prevStatus = prevSessionStatusRef.current
						setSessionStatus(st)
						const resolvedQ = resolvePendingQuestion(st, data, data?.question)
						if (resolvedQ) {
							setPendingQuestion(resolvedQ)
							setTimeout(() => inputRef.current?.focus(), 50)
						} else if (st === "idle" || st === "running" || st === "completed" || st === "done") {
							setPendingQuestion(null)
						}

						if (
							st === "idle" ||
							st === "completed" ||
							st === "done" ||
							st === "waiting_for_input" ||
							st === "needs_input"
						) {
							refetchMissedMessages()
							setTimeout(() => refetchMissedMessages(), 400)
						}

						if (
							(prevStatus === "running" || prevStatus === "thinking") &&
							(st === "idle" || st === "completed" || st === "done")
						) {
							notifySessionCompleted({
								botName: bot?.name,
								conversationTitle: activeConv?.title,
								conversationId: selectedConversationId,
								activeConversationId: selectedConversationId,
								metadata: data,
							})
						}

						if (st === "waiting_for_input" || st === "needs_input") {
							notifyWaitingForInput({
								botName: bot?.name,
								conversationTitle: activeConv?.title,
								conversationId: selectedConversationId,
								activeConversationId: selectedConversationId,
								question: resolvedQ,
								metadata: data,
							})
						}

						if (onConversationStatusChange) {
							onConversationStatusChange(selectedConversationId, st, data)
						}
					} else if (
						event_type === "message" ||
						event_type === "response" ||
						event_type === "completion" ||
						event_type === "result" ||
						event_type === "turn_completed" ||
						event_type === "final_message" ||
						event_type === "text"
					) {
						refetchMissedMessages()
						setTimeout(() => refetchMissedMessages(), 400)
					}
				})

				ch.on("prompt_queue_updated", (payload) => {
					if (payload?.prompt_queue) {
						setPromptQueue(payload.prompt_queue)
					}
				})

				sessionsCh = null
				if (bot?.bot_type === "ahp" && bot?.id) {
					sessionsCh = socketRef.current.channel(`bot_sessions:${bot.id}`, {})
					sessionsCh.on("session_status_changed", (payload) => {
						if (!payload) return
						if (
							payload.conversation_id === selectedConversationId ||
							String(payload.conversation_id) === String(selectedConversationId)
						) {
							const newStatus = payload.status || "idle"
							const prevStatus = prevSessionStatusRef.current
							setSessionStatus(newStatus)
							const meta = payload.metadata || {}
							if (payload.metadata) {
								setSessionMetadata((prev) => ({ ...prev, ...payload.metadata }))
								if (payload.metadata.thinking !== undefined) {
									setThinkingText(payload.metadata.thinking || "")
								}
								if (payload.metadata.tool_calls !== undefined) {
									setToolCalls(
										Array.isArray(payload.metadata.tool_calls) ? payload.metadata.tool_calls : [],
									)
								}
							}
							const resolvedQ = resolvePendingQuestion(newStatus, meta, payload.question)
							if (resolvedQ) {
								setPendingQuestion(resolvedQ)
								setTimeout(() => inputRef.current?.focus(), 50)
							} else if (
								newStatus === "idle" ||
								newStatus === "running" ||
								newStatus === "completed" ||
								newStatus === "done"
							) {
								setPendingQuestion(null)
							}

							if (
								newStatus === "idle" ||
								newStatus === "completed" ||
								newStatus === "done" ||
								newStatus === "waiting_for_input" ||
								newStatus === "needs_input"
							) {
								refetchMissedMessages()
								setTimeout(() => refetchMissedMessages(), 400)
							}

							if (
								(prevStatus === "running" || prevStatus === "thinking") &&
								(newStatus === "idle" || newStatus === "completed" || newStatus === "done")
							) {
								notifySessionCompleted({
									botName: bot?.name,
									conversationTitle: activeConv?.title,
									conversationId: selectedConversationId,
									activeConversationId: selectedConversationId,
									metadata: payload.metadata,
								})
							}

							if (newStatus === "waiting_for_input" || newStatus === "needs_input") {
								notifyWaitingForInput({
									botName: bot?.name,
									conversationTitle: activeConv?.title,
									conversationId: selectedConversationId,
									activeConversationId: selectedConversationId,
									question: resolvedQ,
									metadata: payload.metadata,
								})
							}
						} else if (payload.conversation_id) {
							const otherConv = conversations?.find((c) => c.id === payload.conversation_id)
							const otherStatus = payload.status
							const prevOtherStatus = otherConv?.status

							if (
								(prevOtherStatus === "running" || prevOtherStatus === "thinking") &&
								(otherStatus === "idle" || otherStatus === "completed" || otherStatus === "done")
							) {
								notifySessionCompleted({
									botName: bot?.name,
									conversationTitle: otherConv?.title,
									conversationId: payload.conversation_id,
									activeConversationId: selectedConversationId,
									metadata: payload.metadata,
								})
							}

							if (otherStatus === "waiting_for_input" || otherStatus === "needs_input") {
								notifyWaitingForInput({
									botName: bot?.name,
									conversationTitle: otherConv?.title,
									conversationId: payload.conversation_id,
									activeConversationId: selectedConversationId,
									question: payload.metadata?.question,
									metadata: payload.metadata,
								})
							}
						}
						if (onConversationStatusChange && payload.conversation_id) {
							onConversationStatusChange(payload.conversation_id, payload.status, payload.metadata)
						}
					})
					sessionsCh.on("bot_sessions_updated", (payload) => {
						if (payload?.sessions && onSessionsUpdated) {
							onSessionsUpdated(payload.sessions)
						}
					})
					sessionsCh.join()
				}

				ch.join()
					.receive("ok", (resp) => {
						if (cancelled) return
						channelRef.current = ch

						// Catch up on any missed messages immediately on channel join
						refetchMissedMessages()
						setTimeout(() => refetchMissedMessages(), 350)

						const liveConv =
							conversations?.find((c) => c.id === selectedConversationId) || activeConv
						const isLiveActive =
							sessionStatus === "running" ||
							sessionStatus === "thinking" ||
							liveConv?.status === "running" ||
							liveConv?.status === "thinking" ||
							liveConv?.status === "waiting_for_input" ||
							liveConv?.status === "needs_input"

						if (resp?.status) {
							if (!isLiveActive || (resp.status !== "idle" && resp.status !== "completed")) {
								setSessionStatus(resp.status)
								if (onConversationStatusChange) {
									onConversationStatusChange(selectedConversationId, resp.status, resp.metadata)
								}
							}
						}
						const respMeta = resp?.metadata || {}
						if (resp?.metadata) {
							setSessionMetadata((prev) => ({
								...resp.metadata,
								...prev,
								...(activeConv?.metadata || {}),
							}))
							if (resp.metadata.prompt_queue) setPromptQueue(resp.metadata.prompt_queue)
							if (resp.metadata.thinking) {
								setThinkingText(resp.metadata.thinking)
							}
							if (Array.isArray(resp.metadata.tool_calls) && resp.metadata.tool_calls.length > 0) {
								setToolCalls(resp.metadata.tool_calls)
							}
						}
						const targetStatus = resp?.status || sessionStatus
						const resolvedQ = resolvePendingQuestion(targetStatus, respMeta, respMeta.question)
						if (resolvedQ) {
							setPendingQuestion(resolvedQ)
							setTimeout(() => inputRef.current?.focus(), 50)
						} else if (
							targetStatus === "idle" ||
							targetStatus === "running" ||
							targetStatus === "completed" ||
							targetStatus === "done"
						) {
							setPendingQuestion(null)
						}

						if (hasJoinedConversationRef.current) {
							refetchMissedMessages()
						}

						hasJoinedConversationRef.current = true
					})
					.receive("error", () => {
						channelRef.current = null
					})
			} catch (err) {
				console.error("Channel join failed:", err)
			}
		}

		joinChannel()
		return () => {
			cancelled = true
			if (channelRef.current) {
				channelRef.current.leave()
				channelRef.current = null
			}
			if (sessionsCh) {
				sessionsCh.leave()
			}
		}
	}, [selectedConversationId, token])

	// Load messages when conversation changes
	useEffect(() => {
		if (!selectedConversationId || !token) return
		hasJoinedConversationRef.current = false
		renderedIdsRef.current.clear()

		const cached = messagesCacheRef.current.get(selectedConversationId)
		if (cached && cached.length > 0) {
			setMessages(cached)
			messagesRef.current = cached
			cached.forEach((m) => renderedIdsRef.current.add(m.id))
			setIsLoadingMessages(false)
		} else {
			setMessages([])
			messagesRef.current = []
			setIsLoadingMessages(true)
		}

		setSessionMetadata(activeConv?.metadata || {})
		setThinkingText(activeConv?.metadata?.thinking || "")
		setToolCalls(
			Array.isArray(activeConv?.metadata?.tool_calls) ? activeConv.metadata.tool_calls : [],
		)
		setPromptQueue(activeConv?.metadata?.prompt_queue || [])
		setPendingQuestion(
			resolvePendingQuestion(
				activeConv?.status || "idle",
				activeConv?.metadata || {},
				activeConv?.metadata?.question,
			),
		)
		if (activeConv?.status !== "thinking" && activeConv?.status !== "running") {
			stopBotThinking()
		}
		Array.from(responseTimeoutsRef.current.keys()).forEach((messageId) =>
			clearResponseTimeout(messageId),
		)
		timeoutRequestsRef.current.clear()
		setUsedSuggestions({})

		async function loadMessages() {
			try {
				const res = await getConversation(token, selectedConversationId)
				const msgs = (res?.messages || []).map((message) => normalizeMessage(message))
				msgs.forEach((m) => renderedIdsRef.current.add(m.id))
				const nextState = deriveConversationState(msgs)
				setMessages(nextState.messages)
				messagesCacheRef.current.set(selectedConversationId, nextState.messages)
				if (activeConv?.status !== "thinking" && activeConv?.status !== "running") {
					setBotIsTyping(nextState.botIsTyping)
				}
				requestAnimationFrame(() => {
					if (messagesContainerRef.current) {
						messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
					}
				})
				if (res?.conversation && res.conversation.id === selectedConversationId) {
					const liveConv = conversations?.find((c) => c.id === selectedConversationId) || activeConv
					const convStatus = res.conversation.status || "idle"
					const isLiveActive =
						sessionStatus === "running" ||
						sessionStatus === "thinking" ||
						liveConv?.status === "running" ||
						liveConv?.status === "thinking" ||
						liveConv?.status === "waiting_for_input" ||
						liveConv?.status === "needs_input"

					// Only update sessionStatus from DB if the session is NOT actively running live
					if (!isLiveActive && res.conversation.status) {
						setSessionStatus(res.conversation.status)
					}

					const convMeta = res.conversation.metadata || {}
					// Merge DB metadata with live metadata so active steps/tools are not wiped
					setSessionMetadata((prev) => ({
						...convMeta,
						...prev,
						...(activeConv?.metadata || {}),
					}))

					if (convMeta.prompt_queue) {
						setPromptQueue(convMeta.prompt_queue)
					}
					if (convMeta.thinking) {
						setThinkingText((prev) => prev || convMeta.thinking)
					}
					if (Array.isArray(convMeta.tool_calls) && convMeta.tool_calls.length > 0) {
						setToolCalls((prev) => (prev.length > 0 ? prev : convMeta.tool_calls))
					}

					const effectiveStatus = isLiveActive ? activeConv.status : convStatus
					const effectiveMeta = {
						...convMeta,
						...(activeConv?.metadata || {}),
					}
					const resolvedQ = resolvePendingQuestion(
						effectiveStatus,
						effectiveMeta,
						effectiveMeta.question,
					)
					if (resolvedQ) {
						setPendingQuestion(resolvedQ)
						setTimeout(() => inputRef.current?.focus(), 50)
					} else if (
						effectiveStatus === "idle" ||
						effectiveStatus === "running" ||
						effectiveStatus === "completed" ||
						effectiveStatus === "done"
					) {
						setPendingQuestion(null)
					}
				}
			} catch (err) {
				console.error("Load messages failed:", err)
			} finally {
				setIsLoadingMessages(false)
			}
		}
		loadMessages()
	}, [selectedConversationId, token])

	useEffect(() => {
		if (models.length === 0) {
			setSelectedModel("")
			setSelectedContextSize("")
			return
		}

		const exists = models.some((m) => m.name === selectedModel)
		if (!exists) {
			setSelectedModel(models[0].name)
		}
	}, [models, selectedModel])

	useEffect(() => {
		const currentModelObj = models.find((m) => m.name === selectedModel)
		const sizes = currentModelObj?.context_sizes || []
		if (sizes.length === 0) {
			setSelectedContextSize("")
		} else if (
			selectedContextSize &&
			!sizes.some((s) => String(s) === String(selectedContextSize))
		) {
			setSelectedContextSize("")
		}
	}, [models, selectedModel, selectedContextSize])

	useEffect(() => {
		return () => {
			clearTimeout(typingTimeoutRef.current)
			Array.from(responseTimeoutsRef.current.keys()).forEach((messageId) =>
				clearResponseTimeout(messageId),
			)
			timeoutRequestsRef.current.clear()
		}
	}, [])

	async function handleSuggestion(messageId, value) {
		if (!value || !selectedConversationId) return
		setUsedSuggestions((prev) => ({ ...prev, [messageId]: value }))
		await sendMessage(value, { fromSuggestion: true })
	}

	async function uploadFile(file) {
		if (!file || !selectedConversationId) return null

		try {
			return await uploadConversationAsset(token, selectedConversationId, file)
		} catch (err) {
			console.error("File upload failed:", err)
			return null
		}
	}

	async function sendMessage(body, opts = {}) {
		if (!body || !selectedConversationId) return

		const model = selectedModel || models[0]?.name || null
		const contextSize = selectedContextSize ? Number(selectedContextSize) : null
		const optimisticId = `optimistic-${Date.now()}`
		const optimistic = {
			id: optimisticId,
			body,
			model,
			context_size: contextSize,
			role: "user",
			content_type: "text",
			pending: true,
			metadata: {
				...(opts.metadata || {}),
				...(opts.is_steer ? { is_steer: true } : {}),
			},
			is_steer: !!opts.is_steer,
			fromSuggestion: opts.fromSuggestion || false,
			inserted_at: new Date().toISOString(),
		}

		setMessages((prev) => [...prev, optimistic])
		setSending(true)

		try {
			const payload = { body }
			if (model) payload.model = model
			if (contextSize) payload.context_size = contextSize
			if (opts.fromSuggestion) payload.is_suggestion = true
			if (opts.is_steer || opts.metadata) {
				payload.metadata = {
					...(payload.metadata || {}),
					...(opts.metadata || {}),
					...(opts.is_steer ? { is_steer: true } : {}),
				}
			}

			const res = await createConversationMessage(token, selectedConversationId, payload)
			if (onConversationTouch) {
				onConversationTouch(selectedConversationId)
			}

			setMessages((prev) => {
				const deliveredAlreadyPresent = res?.id && prev.some((m) => m.id === res.id && !m.pending)
				if (deliveredAlreadyPresent) {
					return prev.filter((m) => m.id !== optimisticId)
				}
				return prev.map((m) =>
					m.id === optimisticId
						? normalizeMessage(res || {}, {
								pending: false,
								failed: false,
								acknowledged: m.acknowledged,
								fromSuggestion: m.fromSuggestion,
							})
						: m,
				)
			})
			if (res?.id) {
				renderedIdsRef.current.add(res.id)
			}
		} catch {
			setMessages((prev) =>
				prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m)),
			)
		} finally {
			setSending(false)
		}
	}

	async function sendAsset(file) {
		if (!file || !selectedConversationId) return

		const model = selectedModel || models[0]?.name || null
		const contextSize = selectedContextSize ? Number(selectedContextSize) : null
		const optimisticId = `optimistic-${Date.now()}`
		const assetType = file.type.startsWith("image/") ? "image" : "file"
		const optimistic = {
			id: optimisticId,
			body: null,
			metadata: { url: URL.createObjectURL(file), filename: file.name },
			model,
			context_size: contextSize,
			role: "user",
			content_type: assetType,
			pending: true,
			inserted_at: new Date().toISOString(),
		}

		setMessages((prev) => [...prev, optimistic])
		setUploading(true)

		try {
			const uploadResult = await uploadFile(file)
			if (!uploadResult) {
				throw new Error("Upload failed")
			}

			const payload = {
				asset_url: uploadResult.url,
				asset_type: assetType,
				asset_filename: file.name,
			}
			if (model) payload.model = model
			if (contextSize) payload.context_size = contextSize

			const res = await createConversationMessage(token, selectedConversationId, payload)

			setMessages((prev) =>
				prev.map((m) =>
					m.id === optimisticId
						? normalizeMessage(res, {
								pending: false,
								failed: false,
								acknowledged: m.acknowledged,
							})
						: m,
				),
			)
			renderedIdsRef.current.add(res.id)
			setSelectedFile(null)
		} catch {
			setMessages((prev) =>
				prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m)),
			)
		} finally {
			setUploading(false)
		}
	}

	async function handleSend(e) {
		e.preventDefault()
		const body = inputValue.trim()
		if (!body || !selectedConversationId) return

		setInputValue("")
		isAtBottomRef.current = true
		if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
		}

		// If an interactive question is awaiting input, route the message to answer the question
		if (pendingQuestion) {
			const formattedAnswer = formatQuestionAnswer(body, pendingQuestion)
			handleAnswerQuestion(formattedAnswer)
			if (pendingQuestion.isGenericWaiting) {
				await sendMessage(body)
			}
			return
		}

		const isAgentRunning = sessionStatus === "running" || sessionStatus === "thinking"
		if (isAgentRunning) {
			channelRef.current?.push("steer", { action: "steer", instruction: body })
			await sendMessage(body, { is_steer: true })
			return
		}

		await sendMessage(body)
	}

	async function handleSteerSend(e) {
		if (e) e.preventDefault()
		const body = inputValue.trim()
		if (!body || !selectedConversationId) return

		setInputValue("")
		isAtBottomRef.current = true
		if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
		}

		channelRef.current?.push("steer", { action: "steer", instruction: body })
		await sendMessage(body, { is_steer: true })
	}

	async function handleFileSelect(e) {
		const file = e.target.files?.[0]
		if (file) {
			setSelectedFile(file)
		}
	}

	async function handleSendAsset() {
		if (selectedFile) {
			await sendAsset(selectedFile)
		}
	}

	useEffect(() => {
		if (activeConv) {
			const st = activeConv.status || "idle"
			const meta = activeConv.metadata || {}
			setSessionStatus((prev) => {
				if ((prev === "running" || prev === "thinking") && (st === "idle" || !st)) {
					return prev
				}
				return st
			})
			setSessionMetadata((prev) => ({
				...prev,
				...meta,
			}))
			if (meta.prompt_queue) {
				setPromptQueue(meta.prompt_queue)
			}
			const resolvedQ = resolvePendingQuestion(st, meta, meta.question)
			setPendingQuestion(resolvedQ)
			if (meta.thinking !== undefined && meta.thinking !== "") {
				setThinkingText((prev) => prev || meta.thinking)
			}
			if (Array.isArray(meta.tool_calls) && meta.tool_calls.length > 0) {
				setToolCalls((prev) => (prev.length > 0 ? prev : meta.tool_calls))
			}
			if (st === "waiting_for_input" || st === "needs_input") {
				setTimeout(() => inputRef.current?.focus(), 50)
			}
		} else {
			setSessionStatus("idle")
			setSessionMetadata({})
			setPromptQueue([])
			setPendingQuestion(null)
			setThinkingText("")
			setToolCalls([])
		}
	}, [
		activeConv?.id,
		activeConv?.status,
		activeConv?.metadata?.step,
		activeConv?.metadata?.action,
		activeConv?.metadata?.tool,
		activeConv?.metadata?.thinking,
		activeConv?.metadata?.tool_calls,
		selectedConversationId,
	])

	function handleStop() {
		channelRef.current?.push("steer", { action: "stop" })
	}

	function handleSteer(instruction) {
		if (!instruction) return
		channelRef.current?.push("steer", { action: "steer", instruction })
		sendMessage(instruction, { is_steer: true }).catch(() => {})
	}

	function handleAnswerQuestion(answerData) {
		channelRef.current?.push("answer_question", answerData)

		const textAnswer =
			typeof answerData === "string"
				? answerData
				: answerData?.comment ||
					answerData?.raw_answer ||
					(typeof answerData?.answer === "string" ? answerData.answer : null)
		if (textAnswer && pendingQuestion?.isGenericWaiting) {
			sendMessage(textAnswer).catch(() => {})
		}

		setPendingQuestion(null)
		setSessionStatus("running")
		if (onConversationStatusChange) {
			onConversationStatusChange(selectedConversationId, "running")
		}
	}

	function handleRemovePrompt(promptId) {
		channelRef.current?.push("remove_queued_prompt", { prompt_id: promptId })
	}

	if (!bot) {
		return (
			<main className="chat-main">
				<div className="chat-topbar">
					<button
						type="button"
						className="mobile-menu-btn"
						onClick={onToggleSidebar}
						aria-label="Toggle sidebar"
					>
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
							<path
								d="M3 5h14M3 10h14M3 15h14"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
							/>
						</svg>
					</button>
					<h2 className="chat-title">Messaging</h2>
					<div className="chat-topbar-right" />
				</div>
				<div className="chat-empty">
					<svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
						<rect
							x="6"
							y="10"
							width="36"
							height="24"
							rx="4"
							stroke="currentColor"
							strokeWidth="2"
						/>
						<path
							d="M18 30l-4 6v-6h-4a4 4 0 01-4-4V14a4 4 0 014-4h28a4 4 0 014 4v12a4 4 0 01-4 4H18z"
							stroke="currentColor"
							strokeWidth="2"
							fill="none"
						/>
						<circle cx="18" cy="20" r="2" fill="currentColor" />
						<circle cx="24" cy="20" r="2" fill="currentColor" />
						<circle cx="30" cy="20" r="2" fill="currentColor" />
					</svg>
					<p>Select or create a bot to start chatting.</p>
				</div>
			</main>
		)
	}

	const handleToggleAlarm = async () => {
		unlockAudio()
		let perm = notificationPermission
		if (isNotificationSupported()) {
			perm = await requestNotificationPermission()
			setNotificationPermission(perm)
		}
		if (selectedConversationId) {
			const next = toggleSessionAlarm(selectedConversationId)
			setAlarmArmed(next)
			if (next) {
				playConfirmationPing()
				triggerConfirmationVibration()
			}
		}
	}

	return (
		<main className="chat-main">
			{alarmBanner && (
				<div
					className="session-alarm-toast"
					onClick={() => {
						if (
							alarmBanner.conversationId &&
							alarmBanner.conversationId !== selectedConversationId &&
							onSelectConversation
						) {
							onSelectConversation(alarmBanner.conversationId)
						}
						setAlarmBanner(null)
					}}
				>
					<span className="session-alarm-toast__icon inline-flex items-center">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#f59e0b"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
							<path d="M13.73 21a2 2 0 0 1-3.46 0" />
						</svg>
					</span>
					<div className="session-alarm-toast__content">
						<strong>{alarmBanner.title}</strong>
						<span>{alarmBanner.message}</span>
					</div>
					<button
						type="button"
						className="session-alarm-toast__close"
						onClick={(e) => {
							e.stopPropagation()
							setAlarmBanner(null)
						}}
						aria-label="Dismiss alarm toast"
					>
						✕
					</button>
				</div>
			)}
			{/* Top bar */}
			<div className="chat-topbar">
				<div className="chat-topbar-primary">
					<div className="chat-topbar-left">
						<button
							type="button"
							className="mobile-menu-btn"
							onClick={onToggleSidebar}
							aria-label="Toggle sidebar"
						>
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M3 5h14M3 10h14M3 15h14"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
								/>
							</svg>
						</button>
						<div className="chat-title-group">
							<h2 className="chat-title" title={bot?.name || "Botamus Prime"}>
								{bot?.name || "Botamus Prime"}
							</h2>
							{bot?.bot_type === "ahp" && sessionStatus && sessionStatus !== "idle" && (
								<span
									className={`session-status-badge session-status-badge--${sessionStatus}`}
									title={sessionStatus === "waiting_for_input" ? "Needs Input" : sessionStatus}
									aria-label={sessionStatus === "waiting_for_input" ? "Needs Input" : sessionStatus}
								>
									<VSCodeWorkingStateIcon
										status={sessionStatus}
										size={13}
										className="inline-flex"
									/>
								</span>
							)}
						</div>
					</div>

					<div className="chat-topbar-right">
						{activeConv &&
							(isArchived ? (
								<div className="chat-archived-actions">
									<span className="chat-archived-pill" title="This session is archived">
										✓ Archived
									</span>
									<button
										type="button"
										className="chat-close-session-btn"
										onClick={() => onSelectConversation && onSelectConversation(null)}
										title="Close session"
										aria-label="Close session"
									>
										✕ Close
									</button>
								</div>
							) : (
								onArchiveConversation && (
									<button
										type="button"
										className="chat-archive-btn"
										onClick={() => onArchiveConversation(activeConv.id)}
										title="Archive / mark chat as done"
										aria-label="Archive / mark chat as done"
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
										<span className="chat-archive-btn-text">Archive</span>
									</button>
								)
							))}
						<span className={`connection-dot ${bot?.is_connected ? "connection-dot--on" : ""}`} />
						<span className="connection-label">{bot?.is_connected ? "Online" : "Offline"}</span>
						<button
							type="button"
							className={`bot-config-btn sync-btn ${isSyncing ? "sync-btn--spinning" : ""}`}
							onClick={handleManualSync}
							disabled={isSyncing}
							title={
								isSyncing ? "Syncing session messages..." : "Sync session & fetch missing messages"
							}
							aria-label="Sync session & fetch missing messages"
						>
							<svg
								width="17"
								height="17"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
							</svg>
						</button>
						{isNotificationSupported() && (
							<button
								type="button"
								className={`bot-config-btn notification-toggle-btn ${alarmArmed ? "notification-toggle-btn--armed" : "notification-toggle-btn--disarmed"} ${notificationPermission === "granted" ? "notification-toggle-btn--granted" : ""}`}
								onClick={handleToggleAlarm}
								title={
									alarmArmed
										? "Alarm active for this session (will ring and notify when bot responds, completes, or needs input). Click to disarm."
										: "Set alarm for this session (notify and ring when bot responds, completes, or needs input)"
								}
								aria-label={
									alarmArmed
										? "Disable session alarm and notifications"
										: "Enable session alarm and notifications"
								}
							>
								<svg
									width="17"
									height="17"
									viewBox="0 0 24 24"
									fill={alarmArmed ? "currentColor" : "none"}
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
									<path d="M13.73 21a2 2 0 0 1-3.46 0" />
									{alarmArmed && <circle cx="18" cy="6" r="3" fill="#f59e0b" stroke="none" />}
									{!alarmArmed &&
										notificationPermission !== "granted" &&
										notificationPermission !== "denied" && (
											<circle cx="18" cy="6" r="2.5" fill="#f59e0b" stroke="none" />
										)}
								</svg>
							</button>
						)}
						<button
							type="button"
							className="bot-config-btn"
							onClick={() => {
								if (bot) {
									setShowConfigModal(true)
								} else {
									setSettingsInitialTab("states")
									setShowSettingsModal(true)
								}
							}}
							title={bot ? "Bot Configuration & Connection Details" : "Settings & Working States"}
							aria-label={
								bot ? "Bot Configuration & Connection Details" : "Settings & Working States"
							}
						>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
								<path
									d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								<circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
							</svg>
						</button>
					</div>
				</div>

				{(bot?.bot_type || activeConv) && (
					<div className="chat-topbar-secondary">
						<span
							className={`bot-protocol-badge bot-protocol-badge--${bot?.bot_type === "ahp" ? "ahp" : "chat"}`}
							title={
								bot?.bot_type === "ahp"
									? "Integrated via Agent Host Protocol (AHP)"
									: "Integrated via Chat Protocol"
							}
						>
							{bot?.bot_type === "ahp" ? "AHP Protocol" : "Chat Protocol"}
						</span>
						{isSessionNested(activeConv, conversations) && (
							<span
								className="chat-nested-badge"
								title={(() => {
									const parent = findParentSession(activeConv, conversations)
									const parentId = getParentSessionId(activeConv)
									const parentTitle = parent
										? formatSessionTitle(parent.title || parent.external_session_id)
										: parentId
									return parentTitle
										? `Nested sub-session under: ${parentTitle}`
										: "Nested sub-session"
								})()}
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
									aria-hidden="true"
								>
									<polyline points="4 2 4 10 12 10" />
									<polyline points="9 7 12 10 9 13" />
								</svg>
								Nested Session
							</span>
						)}
						{/* Subagents & Running Processes Trigger Pill */}
						{(sessionSubagents.length > 0 || sessionProcesses.length > 0) && (
							<button
								type="button"
								className={`chat-subagents-trigger-btn ${runningSubagentsCount > 0 ? "chat-subagents-trigger-btn--running" : ""}`}
								onClick={() => setShowSubagentsDrawer((prev) => !prev)}
								title={
									runningSubagentsCount > 0
										? `${runningSubagentsCount} running subagent(s). Click to inspect.`
										: `${sessionSubagents.length} subagent(s). Click to inspect.`
								}
								aria-label="Inspect running subagents and processes"
								data-testid="open-subagents-drawer-btn"
							>
								<span className="chat-subagents-trigger-btn__icon">⚡</span>
								<span>
									{runningSubagentsCount > 0
										? `${runningSubagentsCount} Running`
										: sessionSubagents.length > 0
											? `Subagents (${sessionSubagents.length})`
											: "Processes"}
								</span>
								{runningProcessesCount > 0 && (
									<span className="chat-subagents-trigger-btn__proc-chip">
										⚙️ {runningProcessesCount}
									</span>
								)}
							</button>
						)}
						{/* Project & Workspace Badge */}
						{projectInfo.hasProject ? (
							<button
								type="button"
								className="chat-project-badge"
								onClick={() => setShowProjectModal(true)}
								title={
									projectInfo.path ||
									projectInfo.uri ||
									projectInfo.name ||
									"Click to view project details"
								}
								aria-label={`Project: ${projectInfo.name}. Click to view details.`}
							>
								<svg
									className="chat-project-icon"
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
								<span className="chat-project-name">{projectInfo.name}</span>
								{projectInfo.branch && (
									<span
										className="chat-project-branch-chip"
										title={`Git branch: ${projectInfo.branch}`}
									>
										<svg
											width="10"
											height="10"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="6" y1="3" x2="6" y2="15" />
											<circle cx="18" cy="6" r="3" />
											<circle cx="6" cy="18" r="3" />
											<path d="M18 9a9 9 0 0 1-9 9" />
										</svg>
										<span>{projectInfo.branch}</span>
									</span>
								)}
								<svg
									className="chat-project-chevron"
									width="11"
									height="11"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</button>
						) : activeConv ? (
							<button
								type="button"
								className="chat-project-badge chat-project-badge--empty"
								onClick={() => setShowProjectModal(true)}
								title="No project linked. Click to view session details."
								aria-label="No project linked. Click to view session details."
							>
								<svg
									className="chat-project-icon"
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
								<span className="chat-project-name">No Project</span>
								<svg
									className="chat-project-chevron"
									width="11"
									height="11"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</button>
						) : null}
						{activeConv && (
							<span className="chat-subtitle" title={activeConv.title || "Session"}>
								{formatSessionTitle(activeConv.title)}
								{isArchived && <span className="chat-subtitle-archived-tag">(Archived)</span>}
							</span>
						)}
					</div>
				)}
			</div>

			{/* VS Code Indeterminate Running Bar */}
			<VSCodeProgressBar
				active={sessionStatus === "running" || sessionStatus === "thinking"}
				variant={sessionStatus === "thinking" ? "thinking" : "running"}
			/>

			{/* AHP Subagents & Running Processes Monitor Panel */}
			<SubagentsPanel
				token={token}
				bot={bot}
				activeConv={activeConv}
				conversations={conversations}
				sessionStatus={sessionStatus}
				sessionMetadata={sessionMetadata}
				thinkingText={thinkingText}
				toolCalls={toolCalls}
				onSelectConversation={onSelectConversation}
				isOpen={showSubagentsDrawer}
				onClose={() => setShowSubagentsDrawer(false)}
				onOpen={() => setShowSubagentsDrawer(true)}
			/>

			{/* Messages */}
			<div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
				{isArchived && (
					<div className="chat-archived-banner">
						<span className="chat-archived-banner-icon">📁</span>
						<span className="chat-archived-banner-text">
							This session is archived. You can review history or{" "}
							<button
								type="button"
								className="chat-archived-close-link"
								onClick={() => onSelectConversation && onSelectConversation(null)}
							>
								close this session
							</button>
							.
						</span>
					</div>
				)}
				{!isLoadingMessages && messages.length === 0 && (
					<div className="chat-welcome">
						<p className="chat-welcome-text">
							Start a conversation with <strong>{bot?.name || "your bot"}</strong>
						</p>
						<span
							className={`bot-protocol-badge bot-protocol-badge--${bot?.bot_type === "ahp" ? "ahp" : "chat"}`}
						>
							{bot?.bot_type === "ahp" ? "AHP Protocol" : "Chat Protocol"}
						</span>
					</div>
				)}
				{messages.map((msg) => (
					<MessageBubbleView
						key={msg.id}
						message={msg}
						onSuggestion={(value) => handleSuggestion(msg.id, value)}
						usedSuggestion={usedSuggestions[msg.id]}
					/>
				))}

				{/* AHP Interactive Question / Approval Card */}
				{(pendingQuestion ||
					sessionStatus === "waiting_for_input" ||
					sessionStatus === "needs_input") && (
					<QuestionApprovalCard
						question={pendingQuestion || resolvePendingQuestion(sessionStatus, sessionMetadata)}
						onAnswer={handleAnswerQuestion}
					/>
				)}

				{/* AHP Live Thinking, Tool Steps, & Steering */}
				<LiveThinking
					status={sessionStatus}
					metadata={sessionMetadata}
					thinkingText={thinkingText}
					toolCalls={toolCalls}
					onStop={handleStop}
					onSteer={handleSteer}
				/>

				{botIsTyping && sessionStatus !== "thinking" && sessionStatus !== "running" && (
					<TypingIndicatorView />
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input area */}
			<div className="chat-input-area">
				{/* Prompt Queue Chips */}
				<PromptQueue queue={promptQueue} onRemovePrompt={handleRemovePrompt} />

				{/* File preview when selected */}
				{selectedFile && (
					<div className="file-preview">
						<div className="file-preview-item">
							<span className="file-preview-name">{selectedFile.name}</span>
							<button
								type="button"
								className="file-preview-remove"
								onClick={() => setSelectedFile(null)}
								aria-label="Remove file"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
									<path
										d="M18 6L6 18M6 6l12 12"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
						</div>
					</div>
				)}
				{/* Agent Steering & Live Progress Bar when Agent is Busy */}
				{(sessionStatus === "running" || sessionStatus === "thinking") && (
					<div className="chat-steering-bar" data-testid="chat-steering-bar">
						<div className="chat-steering-info">
							<span className="chat-steering-pulse" />
							<span className="chat-steering-label">
								Agent is {sessionStatus === "thinking" ? "thinking" : "running"}
							</span>
							{(sessionMetadata?.step || sessionMetadata?.tool || sessionMetadata?.action) && (
								<span
									className="chat-steering-step"
									title={sessionMetadata.step || sessionMetadata.action || sessionMetadata.tool}
								>
									{sessionMetadata.step ||
										sessionMetadata.action ||
										`Running ${sessionMetadata.tool}...`}
								</span>
							)}
						</div>
						<div className="chat-steering-actions">
							<button
								type="button"
								className="chat-steering-quick-btn chat-steering-quick-btn--jump"
								onClick={() => {
									isAtBottomRef.current = true
									if (messagesContainerRef.current) {
										messagesContainerRef.current.scrollTop =
											messagesContainerRef.current.scrollHeight
									}
								}}
								title="Jump to live progress"
							>
								↓ View Progress
							</button>
							<button
								type="button"
								className="chat-steering-quick-btn chat-steering-quick-btn--stop"
								onClick={handleStop}
								title="Stop agent"
							>
								⏹ Stop
							</button>
						</div>
					</div>
				)}

				<form
					id="message-form"
					onSubmit={handleSend}
					className={`chat-input-form ${
						sessionStatus === "waiting_for_input" || sessionStatus === "needs_input"
							? "chat-input-form--waiting"
							: sessionStatus === "running" || sessionStatus === "thinking"
								? "chat-input-form--running"
								: ""
					}`}
				>
					<textarea
						id="message-input"
						ref={inputRef}
						className="chat-textarea"
						placeholder={
							sessionStatus === "waiting_for_input" || sessionStatus === "needs_input"
								? "Agent is waiting for your input to continue..."
								: sessionStatus === "running" || sessionStatus === "thinking"
									? "Steer running agent with an instruction (or ask a question)..."
									: "What do you want to know?"
						}
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						rows={1}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault()
								handleSend(e)
							}
						}}
						onInput={(e) => {
							e.target.style.height = "auto"
							e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"
						}}
					/>
					<div className="chat-input-actions">
						<div className="chat-input-left">
							<input
								type="file"
								id="file-input"
								className="file-input"
								onChange={handleFileSelect}
								accept="image/*,.pdf"
								aria-label="Upload file"
							/>
							<label htmlFor="file-input" className="file-input-btn" title="Attach file">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</label>
							<select
								id="model-select"
								className="model-picker"
								value={selectedModel}
								onChange={(e) => setSelectedModel(e.target.value)}
								aria-label="Model"
							>
								{models.map((m) => (
									<option key={m.name} value={m.name}>
										{m.name}
									</option>
								))}
							</select>
							{models.find((m) => m.name === selectedModel)?.context_sizes?.length > 0 && (
								<select
									id="context-size-select"
									className="model-picker"
									value={selectedContextSize}
									onChange={(e) => setSelectedContextSize(e.target.value)}
									aria-label="Context Size"
								>
									<option value="">Default context</option>
									{models
										.find((m) => m.name === selectedModel)
										.context_sizes.map((size) => (
											<option key={size} value={size}>
												{size >= 1000
													? `${Math.round(size / 1000)}k (${size.toLocaleString()} tokens)`
													: `${size} tokens`}
											</option>
										))}
								</select>
							)}
						</div>

						{selectedFile ? (
							<button
								type="button"
								className={`send-btn send-btn--active`}
								onClick={handleSendAsset}
								disabled={uploading}
								aria-label="Send file"
							>
								{uploading ? (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
										<circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.3" />
										<circle cx="12" cy="12" r="1" fill="currentColor" />
									</svg>
								) : (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
										<path
											d="M12 19V5M5 12l7-7 7 7"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								)}
							</button>
						) : (
							<div className="chat-send-actions">
								{(sessionStatus === "running" || sessionStatus === "thinking") && (
									<button
										type="button"
										className={`steer-action-btn ${inputValue.trim() ? "steer-action-btn--active" : ""}`}
										onClick={handleSteerSend}
										disabled={sending || !inputValue.trim()}
										title="Steer agent with this message"
									>
										🧭 Steer Agent
									</button>
								)}
								<button
									type="submit"
									className={`send-btn ${inputValue.trim() ? "send-btn--active" : ""} ${
										sessionStatus === "waiting_for_input" || sessionStatus === "needs_input"
											? "send-btn--waiting"
											: sessionStatus === "running" || sessionStatus === "thinking"
												? "send-btn--steer"
												: ""
									}`}
									disabled={sending || !inputValue.trim()}
									aria-label={
										sessionStatus === "running" || sessionStatus === "thinking"
											? "Steer agent"
											: "Send message"
									}
									title={
										sessionStatus === "running" || sessionStatus === "thinking"
											? "Steer agent with message (Enter)"
											: "Send message (Enter)"
									}
								>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
										<path
											d="M12 19V5M5 12l7-7 7 7"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
							</div>
						)}
					</div>
				</form>
			</div>

			{/* Settings Modal (Alerts, Working States Showcase) */}
			<SettingsModal
				isOpen={showSettingsModal}
				onClose={() => setShowSettingsModal(false)}
				initialTab={settingsInitialTab}
				token={token}
				bot={bot}
				showBotConfig={false}
				selectedConversationId={selectedConversationId}
				onBotUpdated={(updated) => {
					onBotStatusChange && onBotStatusChange(updated.id, updated)
				}}
			/>

			{/* Bot Configuration Modal */}
			{bot && showConfigModal && (
				<BotConfigModal
					isOpen={showConfigModal}
					onClose={() => setShowConfigModal(false)}
					token={token}
					bot={bot}
					onBotUpdated={(updated) => {
						onBotStatusChange && onBotStatusChange(updated.id, updated)
					}}
				/>
			)}

			{/* Project & Workspace Info Modal */}
			<ProjectInfoModal
				isOpen={showProjectModal}
				onClose={() => setShowProjectModal(false)}
				projectInfo={projectInfo}
				activeConv={activeConv}
				bot={bot}
				sessionStatus={sessionStatus}
			/>
		</main>
	)
}
