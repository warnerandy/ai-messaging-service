import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { Socket } from "phoenix"
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	ThreadPrimitive,
} from "@assistant-ui/react"
import MessageBubbleView from "./MessageBubble.jsx"
import TypingIndicatorView from "./TypingIndicator.jsx"
import LiveThinking from "./LiveThinking.jsx"
import SubagentsPanel from "./SubagentsPanel.jsx"
import QuestionApprovalCard from "./QuestionApprovalCard.jsx"
import PromptQueue from "./PromptQueue.jsx"
import AssistantChatComposer from "./AssistantChatComposer.jsx"
import BotConfigModal from "./BotConfigModal.jsx"
import SettingsModal from "./SettingsModal.jsx"
import ProjectInfoModal from "./ProjectInfoModal.jsx"
import NewSessionCanvas from "./NewSessionCanvas.jsx"
import { ZapIcon, SettingsIcon, FolderIcon } from "./Icons.jsx"
import { convertToAssistantMessage } from "./AssistantAgentProcess.jsx"
import {
	normalizePastedFile,
	readFileAsDataUrl,
	createAhpAttachmentAdapter,
} from "../runtime/ahpRuntime.js"
import {
	getProjectInfo,
	formatSessionTitle,
	isSessionNested,
	findParentSession,
	getParentSessionId,
	getSessionSubagents,
	getSessionProcesses,
	getAgentPromptConfig,
	normalizeAgentMode,
	normalizeAgentModes,
	normalizeWorktree,
	isWorktreeSupported,
	normalizeBranches,
	normalizeAgentTypes,
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
	updateConversation,
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
	if (!message || typeof message !== "object") return fallback || {}
	const fromSuggestion =
		message.fromSuggestion ??
		message.is_suggestion ??
		fallback?.fromSuggestion ??
		fallback?.is_suggestion ??
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
	const [selectedSkill, setSelectedSkill] = useState("none")
	const [attachments, setAttachments] = useState([])
	const [uploading, setUploading] = useState(false)

	const handleAddAttachments = useCallback((newFiles) => {
		const normalizedList = Array.from(newFiles || [])
			.map((rawFile, idx) => normalizePastedFile(rawFile, idx))
			.filter(Boolean)
		if (normalizedList.length === 0) return

		const mapped = normalizedList.map((file) => {
			let previewUrl = null
			if (file.type?.startsWith("image/") && typeof URL !== "undefined" && URL.createObjectURL) {
				try {
					previewUrl = URL.createObjectURL(file)
				} catch {
					previewUrl = null
				}
			}
			return {
				id: `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
				file,
				name: file.name,
				size: file.size,
				type: file.type,
				previewUrl,
				dataUrl: null,
			}
		})
		setAttachments((prev) => [...prev, ...mapped])
		if (normalizedList[0]) {
			setSelectedFile(normalizedList[0])
		}

		// Populate inline base64 dataUrl for image attachments so AHP proxy can embed them directly
		mapped.forEach((item) => {
			if (item.type?.startsWith("image/")) {
				readFileAsDataUrl(item.file)
					.then((dataUrl) => {
						if (!dataUrl) return
						setAttachments((prev) =>
							prev.map((att) =>
								att.id === item.id
									? { ...att, dataUrl, previewUrl: att.previewUrl || dataUrl }
									: att,
							),
						)
					})
					.catch(() => {})
			}
		})
	}, [])

	const handleRemoveAttachment = useCallback((id) => {
		setAttachments((prev) => {
			const match = prev.find((att) => att.id === id)
			if (match?.previewUrl) {
				try {
					URL.revokeObjectURL(match.previewUrl)
				} catch (_) {}
			}
			const next = prev.filter((att) => att.id !== id)
			if (next.length === 0) {
				setSelectedFile(null)
			}
			return next
		})
	}, [])
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
	const [inspectorOpen, setInspectorOpen] = useState(true)

	useEffect(() => {
		const handleKeyDown = (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
				e.preventDefault()
				setInspectorOpen((prev) => !prev)
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

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

	const conversationsRef = useRef(conversations)
	useEffect(() => {
		conversationsRef.current = conversations
	}, [conversations])

	const activeConv = conversations?.find((c) => c.id === selectedConversationId)
	const isArchived = Boolean(
		activeConv &&
		(activeConv.status === "archived" ||
			activeConv.status === "done" ||
			activeConv.status === "completed"),
	)

	const isLiveRunning =
		sessionStatus === "running" || sessionStatus === "thinking"
			? true
			: sessionStatus === "idle" || sessionStatus === "completed" || sessionStatus === "done"
				? false
				: activeConv?.status === "running" || activeConv?.status === "thinking"

	const isLiveWaiting =
		sessionStatus === "waiting_for_input" || sessionStatus === "needs_input"
			? true
			: sessionStatus === "idle" || sessionStatus === "completed" || sessionStatus === "done"
				? false
				: activeConv?.status === "waiting_for_input" || activeConv?.status === "needs_input"

	const effectiveMetadata = {
		...(activeConv?.metadata || {}),
		...(sessionMetadata || {}),
	}

	const hasActiveWork = Boolean(
		isLiveRunning &&
		(effectiveMetadata?.step ||
			effectiveMetadata?.action ||
			effectiveMetadata?.tool ||
			effectiveMetadata?.command ||
			(Array.isArray(toolCalls) && toolCalls.some((t) => t?.status === "running"))),
	)

	const isAgentBusy = isLiveRunning || hasActiveWork

	const effectiveStatus = isLiveRunning
		? sessionStatus === "thinking" || activeConv?.status === "thinking"
			? "thinking"
			: "running"
		: isLiveWaiting
			? sessionStatus === "waiting_for_input" || activeConv?.status === "waiting_for_input"
				? "waiting_for_input"
				: "needs_input"
			: sessionStatus && sessionStatus !== "idle"
				? sessionStatus
				: activeConv?.status || "idle"

	const projectInfo = getProjectInfo(activeConv, effectiveMetadata)
	const initialPromptConfig = getAgentPromptConfig(effectiveMetadata, activeConv, projectInfo, bot)
	const [agentModes, setAgentModes] = useState(initialPromptConfig.modes)
	const [agentMode, setAgentMode] = useState(initialPromptConfig.agentMode)
	const [worktreeSupported, setWorktreeSupported] = useState(initialPromptConfig.worktreeSupported)
	const [useWorktree, setUseWorktree] = useState(initialPromptConfig.useWorktree)
	const [baseBranch, setBaseBranch] = useState(initialPromptConfig.baseBranch)
	const [availableBranches, setAvailableBranches] = useState(initialPromptConfig.availableBranches)
	const [agentTypes, setAgentTypes] = useState(initialPromptConfig.agentTypes)
	const [selectedAgentType, setSelectedAgentType] = useState(initialPromptConfig.agentType)
	const [workingDirectory, setWorkingDirectory] = useState(
		effectiveMetadata?.working_directory || effectiveMetadata?.workingDirectory || "",
	)
	const [availableDirectories, setAvailableDirectories] = useState(
		Array.isArray(bot?.metadata?.working_directories) ? bot.metadata.working_directories : [],
	)

	const applyIncomingSessionConfig = useCallback(
		(cfg) => {
			if (!cfg || typeof cfg !== "object") return
			setSessionMetadata((prev) => ({ ...prev, ...cfg }))
			if (cfg.agent_mode || cfg.agentMode || cfg.mode) {
				setAgentMode(normalizeAgentMode(cfg.agent_mode || cfg.agentMode || cfg.mode))
			}
			const incomingModes =
				cfg.agent_modes ||
				cfg.modes ||
				cfg.supported_modes ||
				cfg.capabilities?.modes ||
				cfg.capabilities?.agent_modes
			if (incomingModes) {
				setAgentModes(normalizeAgentModes(incomingModes))
			}
			if (
				cfg.worktree_supported !== undefined ||
				cfg.supports_worktree !== undefined ||
				cfg.allow_worktree !== undefined ||
				cfg.capabilities?.worktree_supported !== undefined
			) {
				setWorktreeSupported(isWorktreeSupported(cfg, bot))
			}
			if (
				cfg.use_worktree !== undefined ||
				cfg.useWorktree !== undefined ||
				cfg.worktree !== undefined
			) {
				setUseWorktree(
					normalizeWorktree(
						cfg.use_worktree !== undefined
							? cfg.use_worktree
							: cfg.useWorktree !== undefined
								? cfg.useWorktree
								: cfg.worktree,
					),
				)
			}
			if (cfg.base_branch || cfg.baseBranch || cfg.branch || cfg.git_branch) {
				setBaseBranch(cfg.base_branch || cfg.baseBranch || cfg.branch || cfg.git_branch)
			}
			const incomingBranches =
				cfg.branches || cfg.available_branches || cfg.base_branches || cfg.capabilities?.branches
			if (incomingBranches) {
				setAvailableBranches(normalizeBranches(incomingBranches))
			}
			if (cfg.agent_type || cfg.agentType) {
				setSelectedAgentType(cfg.agent_type || cfg.agentType)
			}
			const incomingRoles =
				cfg.agent_roles ||
				cfg.agentRoles ||
				cfg.agent_types ||
				cfg.agentTypes ||
				cfg.roles ||
				cfg.capabilities?.agent_roles ||
				cfg.capabilities?.agentRoles ||
				cfg.capabilities?.roles ||
				cfg.capabilities?.agent_types ||
				cfg.capabilities?.agentTypes
			if (incomingRoles) {
				setAgentTypes(normalizeAgentTypes(incomingRoles))
			}
			if (cfg.working_directory || cfg.workingDirectory) {
				setWorkingDirectory(cfg.working_directory || cfg.workingDirectory)
			}
			const incomingDirs =
				cfg.working_directories || cfg.workingDirectories || cfg.capabilities?.working_directories
			if (Array.isArray(incomingDirs)) {
				setAvailableDirectories(incomingDirs.filter((d) => typeof d === "string" && d.trim()))
			}
		},
		[bot],
	)

	// Keep prompt options (roles, modes, branches, worktree) in sync when bot changes or updates
	useEffect(() => {
		if (!bot) return
		const cfg = getAgentPromptConfig(sessionMetadata, activeConv, projectInfo, bot)
		if (cfg.modes && cfg.modes.length > 0) {
			setAgentModes(cfg.modes)
		}
		if (cfg.agentTypes && cfg.agentTypes.length > 0) {
			setAgentTypes(cfg.agentTypes)
		}
		setWorktreeSupported(cfg.worktreeSupported)
		if (cfg.availableBranches && cfg.availableBranches.length > 0) {
			setAvailableBranches(cfg.availableBranches)
		}
	}, [bot])

	const hasUserPromptsRef = useRef(false)
	hasUserPromptsRef.current =
		(Array.isArray(messages) && messages.some((m) => m && !m.pending && m.role === "user")) ||
		Boolean(activeConv?.last_message_at) ||
		Boolean(activeConv?.external_session_id)

	const handleModeChange = useCallback(
		(newMode) => {
			setAgentMode(newMode)
			setSessionMetadata((prev) => ({ ...prev, agent_mode: newMode }))
			onConversationStatusChange?.(selectedConversationId, null, { agent_mode: newMode })
			// On a new session without user prompts, do not send anything over the wire until a prompt is submitted
			if (hasUserPromptsRef.current) {
				channelRef.current?.push("update_session_config", { agent_mode: newMode })
				if (selectedConversationId && token) {
					updateConversation(token, selectedConversationId, {
						metadata: { agent_mode: newMode },
					}).catch(() => {})
				}
			}
		},
		[selectedConversationId, token, onConversationStatusChange],
	)

	const handleWorktreeChange = useCallback(
		(newWorktree) => {
			if (hasUserPromptsRef.current) {
				return
			}
			setUseWorktree(newWorktree)
			setSessionMetadata((prev) => ({ ...prev, use_worktree: newWorktree }))
			onConversationStatusChange?.(selectedConversationId, null, { use_worktree: newWorktree })
			// On a new session without user prompts, do not send anything over the wire until a prompt is submitted
			if (hasUserPromptsRef.current) {
				channelRef.current?.push("update_session_config", { use_worktree: newWorktree })
				if (selectedConversationId && token) {
					updateConversation(token, selectedConversationId, {
						metadata: { use_worktree: newWorktree },
					}).catch(() => {})
				}
			}
		},
		[selectedConversationId, token, onConversationStatusChange],
	)

	const handleBaseBranchChange = useCallback(
		(newBranch) => {
			setBaseBranch(newBranch)
			setSessionMetadata((prev) => ({ ...prev, base_branch: newBranch }))
			onConversationStatusChange?.(selectedConversationId, null, { base_branch: newBranch })
			// On a new session without user prompts, do not send anything over the wire until a prompt is submitted
			if (hasUserPromptsRef.current) {
				channelRef.current?.push("update_session_config", { base_branch: newBranch })
				if (selectedConversationId && token) {
					updateConversation(token, selectedConversationId, {
						metadata: { base_branch: newBranch },
					}).catch(() => {})
				}
			}
		},
		[selectedConversationId, token, onConversationStatusChange],
	)

	const handleAgentTypeChange = useCallback(
		(newType) => {
			setSelectedAgentType(newType)
			setSessionMetadata((prev) => ({ ...prev, agent_type: newType }))
			onConversationStatusChange?.(selectedConversationId, null, { agent_type: newType })
			// On a new session without user prompts, do not send anything over the wire until a prompt is submitted
			if (hasUserPromptsRef.current) {
				channelRef.current?.push("update_session_config", { agent_type: newType })
				if (selectedConversationId && token) {
					updateConversation(token, selectedConversationId, {
						metadata: { agent_type: newType },
					}).catch(() => {})
				}
			}
		},
		[selectedConversationId, token, onConversationStatusChange],
	)

	const handleWorkingDirectoryChange = useCallback(
		(newDir) => {
			setWorkingDirectory(newDir)
			setSessionMetadata((prev) => ({ ...prev, working_directory: newDir }))
			onConversationStatusChange?.(selectedConversationId, null, { working_directory: newDir })
			if (hasUserPromptsRef.current) {
				channelRef.current?.push("update_session_config", { working_directory: newDir })
				if (selectedConversationId && token) {
					updateConversation(token, selectedConversationId, {
						metadata: { working_directory: newDir },
					}).catch(() => {})
				}
			}
		},
		[selectedConversationId, token, onConversationStatusChange],
	)

	const isAhp =
		bot?.bot_type === "ahp" ||
		activeConv?.metadata?.bot_type === "ahp" ||
		Boolean(activeConv?.external_session_id) ||
		Boolean(activeConv?.parent_session_id)
	const sessionSubagents = getSessionSubagents(
		activeConv,
		conversations,
		effectiveMetadata,
		toolCalls,
	)
	const sessionProcesses = getSessionProcesses(
		activeConv,
		effectiveMetadata,
		toolCalls,
		effectiveStatus,
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
		// Generous threshold: if within 100px of bottom, consider user pinned to bottom.
		// If scrolled higher than 160px, user deliberately scrolled up to read history.
		if (distanceToBottom <= 100) {
			isAtBottomRef.current = true
		} else if (distanceToBottom > 160) {
			isAtBottomRef.current = false
		}
	}, [])

	// If the user was already at the bottom, keep them pinned to the bottom smoothly without jarring post-paint jumps
	useLayoutEffect(() => {
		const container = messagesContainerRef.current
		if (isAtBottomRef.current && container) {
			container.scrollTop = container.scrollHeight
		}
	}, [messages, botIsTyping, toolCalls, pendingQuestion])

	// Always scroll to bottom when switching sessions
	useLayoutEffect(() => {
		isAtBottomRef.current = true
		const container = messagesContainerRef.current
		if (container) {
			container.scrollTop = container.scrollHeight
		}
	}, [selectedConversationId])

	// Keep bottom pinned synchronously when elements inside the chat container dynamically resize (markdown, tool steps)
	useEffect(() => {
		const container = messagesContainerRef.current
		if (!container || typeof ResizeObserver === "undefined") return

		const observer = new ResizeObserver(() => {
			if (isAtBottomRef.current && container) {
				container.scrollTop = container.scrollHeight
			}
		})

		observer.observe(container)

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
						setSessionStatus(convStatus)
						const convMeta = res.conversation.metadata || {}
						if (convStatus === "idle" || convStatus === "completed" || convStatus === "done") {
							stopBotThinking()
							setThinkingText("")
							setToolCalls([])
							setSessionMetadata({
								...convMeta,
							})
						} else {
							setSessionMetadata((prev) => ({
								...convMeta,
								...prev,
							}))
							if (convMeta.thinking) {
								setThinkingText((prev) => prev || convMeta.thinking)
							}
							if (Array.isArray(convMeta.tool_calls) && convMeta.tool_calls.length > 0) {
								setToolCalls((prev) => (prev.length > 0 ? prev : convMeta.tool_calls))
							}
						}
						if (convMeta.prompt_queue) {
							setPromptQueue(convMeta.prompt_queue)
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
					if (payload.metadata) {
						applyIncomingSessionConfig(payload.metadata)
					}
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
					if (newStatus === "idle" || newStatus === "completed" || newStatus === "done") {
						stopBotThinking()
						setThinkingText("")
						setToolCalls([])
						setSessionMetadata((prev) => {
							const next = { ...prev }
							delete next.step
							delete next.tool
							delete next.action
							delete next.command
							delete next.thinking
							return next
						})
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

				ch.on("session_config_changed", (payload) => {
					if (!payload) return
					const meta = payload.metadata || payload.config || payload
					if (meta && typeof meta === "object") {
						applyIncomingSessionConfig(meta)
					}
				})

				ch.on("ahp_event", (payload) => {
					if (!payload) return
					const { event_type, data } = payload
					if (
						event_type === "thinking" ||
						event_type === "thought" ||
						event_type === "reasoning" ||
						event_type === "terminal" ||
						event_type === "output" ||
						event_type === "log"
					) {
						const chunk =
							typeof data === "string"
								? data
								: (data?.chunk ??
									data?.text ??
									data?.thought ??
									data?.reasoning ??
									data?.thinking ??
									data?.delta?.content ??
									data?.delta?.thought ??
									(typeof data?.delta === "string" ? data.delta : null) ??
									data?.output ??
									data?.content ??
									"")
						if (chunk) {
							setThinkingText((prev) => prev + chunk)
						}
						if (
							event_type === "thinking" ||
							event_type === "thought" ||
							event_type === "reasoning"
						) {
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
					} else if (
						event_type === "session_config" ||
						event_type === "mode_change" ||
						event_type === "config" ||
						event_type === "capabilities" ||
						event_type === "capabilities_sync" ||
						event_type === "agent_roles" ||
						event_type === "roles"
					) {
						if (data && typeof data === "object") {
							applyIncomingSessionConfig(data)
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

						if (st === "idle" || st === "completed" || st === "done") {
							stopBotThinking()
							setThinkingText("")
							setToolCalls([])
							setSessionMetadata((prev) => {
								const next = { ...prev }
								delete next.step
								delete next.tool
								delete next.action
								delete next.command
								delete next.thinking
								return next
							})
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
								applyIncomingSessionConfig(payload.metadata)
								if (payload.metadata.thinking) {
									setThinkingText((prev) => prev || payload.metadata.thinking)
								}
								if (
									Array.isArray(payload.metadata.tool_calls) &&
									payload.metadata.tool_calls.length > 0
								) {
									setToolCalls((prev) => (prev.length > 0 ? prev : payload.metadata.tool_calls))
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

							if (newStatus === "idle" || newStatus === "completed" || newStatus === "done") {
								stopBotThinking()
								setThinkingText("")
								setToolCalls([])
								setSessionMetadata((prev) => {
									const next = { ...prev }
									delete next.step
									delete next.tool
									delete next.action
									delete next.command
									delete next.thinking
									return next
								})
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

						const currentConv =
							conversationsRef.current?.find((c) => c.id === selectedConversationId) || activeConv
						if (resp?.status) {
							setSessionStatus(resp.status)
							if (resp.status === "idle" || resp.status === "completed" || resp.status === "done") {
								stopBotThinking()
								setThinkingText("")
								setToolCalls([])
							}
							if (onConversationStatusChange) {
								onConversationStatusChange(selectedConversationId, resp.status, resp.metadata)
							}
						}
						const respMeta = resp?.metadata || {}
						if (resp?.metadata) {
							if (resp.status === "idle" || resp.status === "completed" || resp.status === "done") {
								setSessionMetadata(resp.metadata)
							} else {
								setSessionMetadata((prev) => ({
									...resp.metadata,
									...prev,
									...(activeConv?.metadata || {}),
								}))
								if (resp.metadata.thinking) {
									setThinkingText(resp.metadata.thinking)
								}
								if (
									Array.isArray(resp.metadata.tool_calls) &&
									resp.metadata.tool_calls.length > 0
								) {
									setToolCalls(resp.metadata.tool_calls)
								}
							}
							if (resp.metadata.prompt_queue) setPromptQueue(resp.metadata.prompt_queue)
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
		const initialCfg = getAgentPromptConfig(activeConv?.metadata, activeConv, projectInfo, bot)
		setAgentModes(initialCfg.modes)
		setAgentMode(initialCfg.agentMode)
		setWorktreeSupported(initialCfg.worktreeSupported)
		setUseWorktree(initialCfg.useWorktree)
		setBaseBranch(initialCfg.baseBranch)
		setAvailableBranches(initialCfg.availableBranches)
		if (initialCfg.agentType) {
			setSelectedAgentType(initialCfg.agentType)
		}
		setAgentTypes(initialCfg.agentTypes)
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
					const currentConv =
						conversationsRef.current?.find((c) => c.id === selectedConversationId) ||
						activeConv ||
						res.conversation
					const convStatus = res.conversation.status || "idle"
					if (res.conversation.status) {
						setSessionStatus(res.conversation.status)
						if (convStatus === "idle" || convStatus === "completed" || convStatus === "done") {
							stopBotThinking()
							setThinkingText("")
							setToolCalls([])
						}
					}

					const convMeta = res.conversation.metadata || {}
					if (convStatus === "idle" || convStatus === "completed" || convStatus === "done") {
						setSessionMetadata(convMeta)
					} else {
						setSessionMetadata((prev) => ({
							...convMeta,
							...prev,
							...(currentConv?.metadata || {}),
						}))
					}

					const loadedCfg = getAgentPromptConfig(convMeta, res.conversation, projectInfo, bot)
					setAgentModes(loadedCfg.modes)
					setAgentMode(loadedCfg.agentMode)
					setWorktreeSupported(loadedCfg.worktreeSupported)
					setUseWorktree(loadedCfg.useWorktree)
					setBaseBranch(loadedCfg.baseBranch)
					setAvailableBranches(loadedCfg.availableBranches)
					setAgentTypes(loadedCfg.agentTypes)
					if (loadedCfg.agentType) {
						setSelectedAgentType(loadedCfg.agentType)
					}

					if (convMeta.prompt_queue) {
						setPromptQueue(convMeta.prompt_queue)
					}
					if (convMeta.thinking) {
						setThinkingText((prev) => prev || convMeta.thinking)
					}
					if (Array.isArray(convMeta.tool_calls) && convMeta.tool_calls.length > 0) {
						setToolCalls((prev) => (prev.length > 0 ? prev : convMeta.tool_calls))
					}

					const effectiveStatus = currentConv?.status || convStatus
					const effectiveMeta = {
						...convMeta,
						...(currentConv?.metadata || {}),
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
		const isSteer = Boolean(opts.is_steer)
		const hasUserPrompts =
			hasUserPromptsRef.current ||
			(Array.isArray(messages) && messages.some((m) => m && !m.pending && m.role === "user")) ||
			Boolean(activeConv?.last_message_at)
		const isExistingSession = hasUserPrompts || isSteer
		const isNewSession = !isExistingSession

		const metadata = {
			agent_type: selectedAgentType,
			agent_mode: agentMode,
			...(isNewSession && useWorktree !== undefined ? { use_worktree: useWorktree } : {}),
			base_branch: baseBranch,
			skill: selectedSkill,
			...(workingDirectory ? { working_directory: workingDirectory } : {}),
			...(opts.metadata || {}),
			...(isSteer ? { is_steer: true } : {}),
		}
		if (isSteer || !isNewSession) {
			delete metadata.use_worktree
			delete metadata.useWorktree
			delete metadata.worktree
		}
		const optimistic = {
			id: optimisticId,
			body,
			model,
			context_size: contextSize,
			role: "user",
			content_type: "text",
			pending: true,
			metadata,
			is_steer: isSteer,
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
			payload.metadata = metadata

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
								id: res?.id || m.id,
								body: m.body,
								role: m.role,
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

	async function sendAttachmentsAndBody(body, currentAttachments, opts = {}) {
		if (!selectedConversationId) return
		const model = selectedModel || models[0]?.name || null
		const contextSize = selectedContextSize ? Number(selectedContextSize) : null
		const optimisticId = `optimistic-${Date.now()}`
		const is_steer = Boolean(opts.is_steer)
		const hasUserPrompts =
			hasUserPromptsRef.current ||
			(Array.isArray(messages) && messages.some((m) => m && !m.pending && m.role === "user")) ||
			Boolean(activeConv?.last_message_at)
		const isExistingSession = hasUserPrompts || is_steer
		const isNewSession = !isExistingSession

		const primary = currentAttachments[0]
		const assetType = primary.type?.startsWith("image/") ? "image" : "file"

		const optimisticMetadata = {
			url: primary.previewUrl,
			filename: primary.name,
			agent_type: selectedAgentType,
			agent_mode: agentMode,
			...(isNewSession && useWorktree !== undefined ? { use_worktree: useWorktree } : {}),
			base_branch: baseBranch,
			skill: selectedSkill,
			attachments: currentAttachments.map((a) => ({
				name: a.name,
				type: a.type,
				size: a.size,
				previewUrl: a.previewUrl,
			})),
			...(opts.metadata || {}),
			...(is_steer ? { is_steer: true } : {}),
		}
		if (is_steer || !isNewSession) {
			delete optimisticMetadata.use_worktree
			delete optimisticMetadata.useWorktree
			delete optimisticMetadata.worktree
		}

		const optimistic = {
			id: optimisticId,
			body: body || null,
			model,
			context_size: contextSize,
			role: "user",
			content_type: assetType,
			pending: true,
			metadata: optimisticMetadata,
			is_steer,
			fromSuggestion: opts.fromSuggestion || false,
			inserted_at: new Date().toISOString(),
		}

		setMessages((prev) => [...prev, optimistic])
		setUploading(true)

		try {
			const uploadedList = []
			for (const att of currentAttachments) {
				let inlineDataUrl = att.dataUrl || null
				if (!inlineDataUrl && att.type?.startsWith("image/") && att.file) {
					try {
						inlineDataUrl = await readFileAsDataUrl(att.file)
					} catch {
						inlineDataUrl = null
					}
				}
				const uploadResult = await uploadFile(att.file)
				if (uploadResult?.url) {
					uploadedList.push({
						url: uploadResult.url,
						filename: att.name,
						name: att.name,
						type: att.type,
						size: att.size,
						...(inlineDataUrl ? { data_url: inlineDataUrl } : {}),
					})
				} else if (inlineDataUrl) {
					uploadedList.push({
						url: inlineDataUrl,
						filename: att.name,
						name: att.name,
						type: att.type,
						size: att.size,
						data_url: inlineDataUrl,
					})
				}
			}

			if (uploadedList.length === 0) {
				throw new Error("Attachment upload failed")
			}

			const payloadMetadata = {
				url: uploadedList[0].url,
				filename: uploadedList[0].filename,
				attachments: uploadedList,
				agent_type: selectedAgentType,
				agent_mode: agentMode,
				...(isNewSession && useWorktree !== undefined ? { use_worktree: useWorktree } : {}),
				base_branch: baseBranch,
				skill: selectedSkill,
				...(workingDirectory ? { working_directory: workingDirectory } : {}),
				...(opts.metadata || {}),
				...(is_steer ? { is_steer: true } : {}),
			}
			if (is_steer || !isNewSession) {
				delete payloadMetadata.use_worktree
				delete payloadMetadata.useWorktree
				delete payloadMetadata.worktree
			}

			const payload = {
				body: body || null,
				asset_url: uploadedList[0].url,
				asset_type: assetType,
				asset_filename: uploadedList[0].filename,
				metadata: payloadMetadata,
			}
			if (model) payload.model = model
			if (contextSize) payload.context_size = contextSize

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
								id: res?.id || m.id,
								body: m.body,
								role: m.role,
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
			setAttachments([])
			setSelectedFile(null)
		} catch {
			setMessages((prev) =>
				prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m)),
			)
		} finally {
			setUploading(false)
		}
	}

	async function sendAsset(file) {
		if (!file) return
		await sendAttachmentsAndBody("", [{ file, name: file.name, type: file.type, size: file.size }])
	}

	async function handleSend(e) {
		if (e && e.preventDefault) e.preventDefault()
		const body = inputValue.trim()
		const currentAttachments = [...attachments]
		if ((!body && currentAttachments.length === 0) || !selectedConversationId) return

		setInputValue("")
		isAtBottomRef.current = true
		if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
		}

		// If an interactive question is awaiting input, route the message to answer the question
		if (pendingQuestion && body) {
			const formattedAnswer = formatQuestionAnswer(body, pendingQuestion)
			handleAnswerQuestion(formattedAnswer)
			if (pendingQuestion.isGenericWaiting) {
				await sendMessage(body)
			}
			return
		}

		const isAgentRunning =
			effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
		if (isAgentRunning) {
			if (body) {
				channelRef.current?.push("steer", { action: "steer", instruction: body })
			}
			if (currentAttachments.length > 0) {
				await sendAttachmentsAndBody(body, currentAttachments, { is_steer: true })
			} else {
				await sendMessage(body, { is_steer: true })
			}
			return
		}

		if (currentAttachments.length > 0) {
			await sendAttachmentsAndBody(body, currentAttachments)
		} else {
			await sendMessage(body)
		}
	}

	async function handleSteerSend(e) {
		if (e && e.preventDefault) e.preventDefault()
		const body = inputValue.trim()
		const currentAttachments = [...attachments]
		if ((!body && currentAttachments.length === 0) || !selectedConversationId) return

		setInputValue("")
		isAtBottomRef.current = true
		if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
		}

		if (body) {
			channelRef.current?.push("steer", { action: "steer", instruction: body })
		}
		if (currentAttachments.length > 0) {
			await sendAttachmentsAndBody(body, currentAttachments, { is_steer: true })
		} else {
			await sendMessage(body, { is_steer: true })
		}
	}

	async function handleFileSelect(e) {
		const files = Array.from(e.target.files || [])
		if (files.length > 0) {
			handleAddAttachments(files)
		}
	}

	async function handleSendAsset() {
		if (attachments.length > 0) {
			await sendAttachmentsAndBody(inputValue.trim(), attachments)
		} else if (selectedFile) {
			await sendAsset(selectedFile)
		}
	}

	useEffect(() => {
		if (activeConv) {
			const st = activeConv.status || "idle"
			const meta = activeConv.metadata || {}
			setSessionStatus((prev) => {
				if (st === "idle" || st === "completed" || st === "done") {
					return st
				}
				if (
					st === "running" ||
					st === "thinking" ||
					st === "waiting_for_input" ||
					st === "needs_input"
				) {
					return st
				}
				return prev || st
			})
			if (st === "idle" || st === "completed" || st === "done") {
				stopBotThinking()
			}
			setSessionMetadata((prev) => {
				const merged = {
					...meta,
					...prev,
				}
				if (st === "idle" || st === "completed" || st === "done") {
					delete merged.step
					delete merged.tool
					delete merged.action
					delete merged.command
					delete merged.thinking
				}
				return merged
			})
			if (meta.prompt_queue) {
				setPromptQueue(meta.prompt_queue)
			}
			const resolvedQ = resolvePendingQuestion(st, meta, meta.question)
			if (resolvedQ) {
				setPendingQuestion(resolvedQ)
			}
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
		selectedConversationId,
		activeConv?.status,
		activeConv?.metadata?.step,
		activeConv?.metadata?.tool,
	])

	function handleStop() {
		channelRef.current?.push("steer", { action: "stop" })
	}

	function handleSteer(instruction) {
		if (!instruction) return
		channelRef.current?.push("steer", { action: "steer", instruction })
		sendMessage(instruction, { is_steer: true }).catch(() => {})
	}

	const handleViewProgress = useCallback(() => {
		isAtBottomRef.current = true
		window.dispatchEvent(new CustomEvent("expand-live-thinking"))
		const card = document.getElementById("live-thinking-card") || messagesEndRef.current
		if (card) {
			card.scrollIntoView({ behavior: "smooth", block: "nearest" })
		} else if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior: "smooth",
			})
		}
	}, [])

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

	const threadAttachmentAdapter = useMemo(
		() =>
			createAhpAttachmentAdapter({
				uploadAsset: (file) => uploadFile(file),
			}),
		[selectedConversationId, token],
	)

	const threadRuntime = useExternalStoreRuntime({
		isRunning: effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy,
		messages,
		adapters: {
			attachments: threadAttachmentAdapter,
		},
		convertMessage: useCallback((m) => convertToAssistantMessage(m), []),
		onNew: useCallback(async () => {
			if (handleSend) {
				handleSend()
			}
		}, [handleSend]),
	})

	return (
		<AssistantRuntimeProvider runtime={threadRuntime}>
			<main className="chat-main aui-chat-main">
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
								{bot?.bot_type === "ahp" && effectiveStatus && effectiveStatus !== "idle" && (
									<span
										className={`session-status-badge session-status-badge--${effectiveStatus}`}
										title={
											effectiveStatus === "waiting_for_input" ? "Needs Input" : effectiveStatus
										}
										aria-label={
											effectiveStatus === "waiting_for_input" ? "Needs Input" : effectiveStatus
										}
									>
										<VSCodeWorkingStateIcon
											status={effectiveStatus}
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
									isSyncing
										? "Syncing session messages..."
										: "Sync session & fetch missing messages"
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
							{isAhp && (
								<button
									type="button"
									className={`bot-config-btn inspector-toggle-btn ${inspectorOpen ? "inspector-toggle-btn--active" : ""}`}
									onClick={() => setInspectorOpen((prev) => !prev)}
									title={
										inspectorOpen ? "Hide Inspector Pane (Ctrl+B)" : "Show Inspector Pane (Ctrl+B)"
									}
									aria-label={inspectorOpen ? "Hide Inspector Pane" : "Show Inspector Pane"}
									data-testid="toggle-inspector-btn"
								>
									<svg
										width="17"
										height="17"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<rect x="3" y="3" width="18" height="18" rx="2" />
										<line x1="15" y1="3" x2="15" y2="21" />
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
									<span className="chat-subagents-trigger-btn__icon">
										<ZapIcon size={14} />
									</span>
									<span>
										{runningSubagentsCount > 0
											? `${runningSubagentsCount} Running`
											: sessionSubagents.length > 0
												? `Subagents (${sessionSubagents.length})`
												: "Processes"}
									</span>
									{runningProcessesCount > 0 && (
										<span className="chat-subagents-trigger-btn__proc-chip">
											<SettingsIcon size={12} className="inline mr-1" />
											{runningProcessesCount}
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
					active={effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy}
					variant={effectiveStatus === "thinking" ? "thinking" : "running"}
				/>

				{/* AHP Subagents & Running Processes Monitor Panel */}
				<SubagentsPanel
					token={token}
					bot={bot}
					activeConv={activeConv}
					conversations={conversations}
					sessionStatus={effectiveStatus}
					sessionMetadata={effectiveMetadata}
					thinkingText={thinkingText}
					toolCalls={toolCalls}
					onSelectConversation={onSelectConversation}
					isOpen={showSubagentsDrawer}
					onClose={() => setShowSubagentsDrawer(false)}
					onOpen={() => setShowSubagentsDrawer(true)}
				/>

				{/* Workspace Split Layout: Execution Thread + Collapsible Right Inspector Pane */}
				<div
					className={`chat-workspace-split ${inspectorOpen && isAhp ? "chat-workspace-split--with-inspector" : ""}`}
				>
					<div
						className={`chat-thread-container ${messages.length === 0 && !isLoadingMessages ? "chat-thread-container--empty" : ""}`}
					>
						{/* Messages & Assistant UI Unified Thread */}
						<ThreadPrimitive.Root className="aui-thread-root">
							<ThreadPrimitive.Viewport
								className="chat-messages aui-thread-viewport"
								ref={messagesContainerRef}
								onScroll={handleMessagesScroll}
							>
								{isArchived && (
									<div key="chat-archived-banner" className="chat-archived-banner">
										<span className="chat-archived-banner-icon">
											<FolderIcon size={16} />
										</span>
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
									<NewSessionCanvas
										key="new-session-canvas"
										bot={bot}
										isAhp={isAhp}
										projectInfo={projectInfo}
										workingDirectory={workingDirectory}
										availableDirectories={availableDirectories}
										onWorkingDirectoryChange={handleWorkingDirectoryChange}
										modes={agentModes}
										mode={agentMode}
										onModeChange={handleModeChange}
										worktreeSupported={worktreeSupported}
										useWorktree={useWorktree}
										onWorktreeChange={handleWorktreeChange}
										baseBranch={baseBranch}
										availableBranches={availableBranches}
										onBaseBranchChange={handleBaseBranchChange}
										agentTypes={agentTypes}
										agentType={selectedAgentType}
										onAgentTypeChange={handleAgentTypeChange}
										onSelectStarter={(prompt) => {
											setInputValue(prompt)
											inputRef.current?.focus?.()
										}}
										disabled={sending || uploading}
									/>
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
									effectiveStatus === "waiting_for_input" ||
									effectiveStatus === "needs_input") && (
									<QuestionApprovalCard
										key="question-approval-card"
										question={
											pendingQuestion || resolvePendingQuestion(effectiveStatus, effectiveMetadata)
										}
										onAnswer={handleAnswerQuestion}
									/>
								)}

								{/* AHP Live Thinking, Tool Steps, & Steering */}
								<LiveThinking
									key="live-thinking-view"
									status={effectiveStatus}
									metadata={effectiveMetadata}
									thinkingText={thinkingText || effectiveMetadata?.thinking || ""}
									toolCalls={
										toolCalls.length > 0
											? toolCalls
											: Array.isArray(effectiveMetadata?.tool_calls)
												? effectiveMetadata.tool_calls
												: []
									}
									onStop={handleStop}
									onSteer={handleSteer}
								/>

								{botIsTyping &&
									effectiveStatus !== "thinking" &&
									effectiveStatus !== "running" &&
									!isAgentBusy && <TypingIndicatorView key="typing-indicator-view" />}
								<div ref={messagesEndRef} key="messages-end-anchor" />
							</ThreadPrimitive.Viewport>

							<ThreadPrimitive.ScrollToBottom
								className="chat-scroll-bottom aui-thread-scroll-bottom"
								title="Scroll to bottom"
								aria-label="Scroll to bottom"
							>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M12 4v16m0 0l-6-6m6 6l6-6"
										stroke="currentColor"
										strokeWidth="2.2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</ThreadPrimitive.ScrollToBottom>

							{/* Assistant UI Chat Composer (Input, Model Picker, Agent Type, Skill, Attachments, Steering) */}
							<AssistantChatComposer
								value={inputValue}
								onChange={setInputValue}
								onSubmit={handleSend}
								onSteerSubmit={handleSteerSend}
								disabled={sending || uploading}
								uploading={uploading}
								effectiveStatus={effectiveStatus}
								isAgentBusy={isAgentBusy}
								effectiveMetadata={effectiveMetadata}
								models={models}
								selectedModel={selectedModel}
								onSelectModel={setSelectedModel}
								selectedContextSize={selectedContextSize}
								onSelectContextSize={setSelectedContextSize}
								selectedAgentType={selectedAgentType}
								onSelectAgentType={handleAgentTypeChange}
								selectedSkill={selectedSkill}
								onSelectSkill={setSelectedSkill}
								attachments={attachments}
								onAddAttachments={handleAddAttachments}
								onRemoveAttachment={handleRemoveAttachment}
								promptQueue={promptQueue}
								onRemovePrompt={handleRemovePrompt}
								onViewProgress={handleViewProgress}
								onStop={handleStop}
								inputRef={inputRef}
								modes={agentModes}
								agentMode={agentMode}
								onModeChange={handleModeChange}
								worktreeSupported={worktreeSupported}
								useWorktree={useWorktree}
								onWorktreeChange={handleWorktreeChange}
								baseBranch={baseBranch}
								availableBranches={availableBranches}
								onBaseBranchChange={handleBaseBranchChange}
								agentTypes={agentTypes}
								isAHP={isAhp}
								isNewSession={
									!selectedConversationId || (!activeConv?.external_session_id && messages.length === 0)
								}
								bot={bot}
								projectInfo={projectInfo}
								workingDirectory={workingDirectory}
								availableDirectories={availableDirectories}
								onWorkingDirectoryChange={handleWorkingDirectoryChange}
							/>
						</ThreadPrimitive.Root>
					</div>

					{/* Collapsible Right Inspector Pane (VS Code Agents Window / Cursor secondary pane) */}
					{inspectorOpen && isAhp && (
						<aside className="chat-inspector-dock" data-testid="agent-inspector-pane">
							<SubagentsPanel
								token={token}
								bot={bot}
								activeConv={activeConv}
								conversations={conversations}
								sessionStatus={effectiveStatus}
								sessionMetadata={effectiveMetadata}
								thinkingText={thinkingText}
								toolCalls={toolCalls}
								onSelectConversation={onSelectConversation}
								isOpen={true}
								isDocked={true}
								onClose={() => setInspectorOpen(false)}
								onOpen={() => setInspectorOpen(true)}
							/>
						</aside>
					)}
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
					sessionStatus={effectiveStatus}
					useWorktree={useWorktree}
					baseBranch={baseBranch}
					worktreeSupported={worktreeSupported}
				/>
			</main>
		</AssistantRuntimeProvider>
	)
}
