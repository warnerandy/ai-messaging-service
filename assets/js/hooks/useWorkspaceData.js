import { useCallback, useEffect, useRef, useState } from "react"
import { Socket } from "phoenix"
import {
	archiveConversation,
	createConversation,
	deleteBot,
	listBotModels,
	listBots,
	listConversations,
	pingApp,
	refreshBotModels,
} from "../lib/data.js"
import {
	registerServiceWorker,
	requestNotificationPermission,
	initNotificationListeners,
	notifySessionCompleted,
	notifyWaitingForInput,
} from "../lib/notifications.js"

const STORAGE_KEY = "messaging.user.token"
const USER_EMAIL_STORAGE_KEY = "messaging.user.email"
const SELECTED_BOT_STORAGE_KEY = "messaging.selected.bot_id"
const SELECTED_CONV_STORAGE_KEY = "messaging.selected.conversation_id"

function mergeSessionsIntoList(prevList, incomingSessions) {
	if (!Array.isArray(incomingSessions)) return prevList
	const byKey = new Map()

	const findExisting = (item) => {
		if (!item) return null
		if (item.id != null && byKey.has(`id:${item.id}`)) return byKey.get(`id:${item.id}`)
		if (
			item.external_session_id != null &&
			item.external_session_id !== "" &&
			byKey.has(`ext:${item.external_session_id}`)
		) {
			return byKey.get(`ext:${item.external_session_id}`)
		}
		if (
			item.metadata?.session_id != null &&
			item.metadata.session_id !== "" &&
			byKey.has(`ext:${item.metadata.session_id}`)
		) {
			return byKey.get(`ext:${item.metadata.session_id}`)
		}
		return null
	}

	const deleteKeys = (item) => {
		if (!item) return
		if (item.id != null) byKey.delete(`id:${item.id}`)
		if (item.external_session_id != null && item.external_session_id !== "") {
			byKey.delete(`ext:${item.external_session_id}`)
		}
		if (item.metadata?.session_id != null && item.metadata.session_id !== "") {
			byKey.delete(`ext:${item.metadata.session_id}`)
		}
	}

	const registerItem = (item) => {
		if (!item) return
		if (item.id != null) byKey.set(`id:${item.id}`, item)
		if (item.external_session_id != null && item.external_session_id !== "") {
			byKey.set(`ext:${item.external_session_id}`, item)
		}
		if (item.metadata?.session_id != null && item.metadata.session_id !== "") {
			byKey.set(`ext:${item.metadata.session_id}`, item)
		}
	}

	// Register existing
	for (const c of prevList) {
		if (!c) continue
		registerItem(c)
	}

	for (const s of incomingSessions) {
		if (!s) continue
		if (s.status === "archived") {
			const existing = findExisting(s)
			if (existing) deleteKeys(existing)
			deleteKeys(s)
			continue
		}
		const existing = findExisting(s)
		if (existing?.status === "archived") {
			continue
		}
		const merged = {
			...(existing || {}),
			...s,
			last_user_input_time: s.last_user_input_time || existing?.last_user_input_time,
			last_modified_time: s.last_modified_time || existing?.last_modified_time,
			last_message_at: existing?.last_message_at || s.last_message_at,
			metadata: { ...(existing?.metadata || {}), ...(s.metadata || {}) },
		}
		if (existing) deleteKeys(existing)
		registerItem(merged)
	}

	return Array.from(new Set(byKey.values()))
}

export function useWorkspaceData() {
	const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))
	const [userEmail, setUserEmail] = useState(
		() => localStorage.getItem(USER_EMAIL_STORAGE_KEY) || "",
	)
	const [bots, setBots] = useState([])
	const [selectedBotId, setSelectedBotId] = useState(() => {
		const val = localStorage.getItem(SELECTED_BOT_STORAGE_KEY)
		return val ? Number(val) : null
	})
	const [conversations, setConversations] = useState([])
	const [selectedConversationId, setSelectedConversationId] = useState(() => {
		const val = localStorage.getItem(SELECTED_CONV_STORAGE_KEY)
		return val ? Number(val) : null
	})
	const [models, setModels] = useState([])
	const [loading, setLoading] = useState(false)
	const [isCreatingConversation, setIsCreatingConversation] = useState(false)
	const isCreatingConvRef = useRef(false)
	const [appConnection, setAppConnection] = useState("checking")
	const botsRef = useRef(bots)
	const conversationsRef = useRef(conversations)
	const selectedConvIdRef = useRef(selectedConversationId)

	useEffect(() => {
		botsRef.current = bots
	}, [bots])

	useEffect(() => {
		conversationsRef.current = conversations
	}, [conversations])

	useEffect(() => {
		selectedConvIdRef.current = selectedConversationId
	}, [selectedConversationId])

	const handleLogout = useCallback(() => {
		setToken(null)
		setUserEmail("")
		localStorage.removeItem(STORAGE_KEY)
		localStorage.removeItem(USER_EMAIL_STORAGE_KEY)
		localStorage.removeItem(SELECTED_BOT_STORAGE_KEY)
		localStorage.removeItem(SELECTED_CONV_STORAGE_KEY)
		setBots([])
		setSelectedBotId(null)
		setConversations([])
		setSelectedConversationId(null)
		setModels([])
	}, [])

	const loadBots = useCallback(
		async (explicitToken = null) => {
			const activeToken = explicitToken || token
			if (!activeToken) return []

			try {
				const res = await listBots(activeToken)
				const list = res.bot_tokens || []
				setBots(list)
				return list
			} catch (err) {
				if (err.message.includes("401") || err.message.includes("Unauthorized")) {
					handleLogout()
				}
				return []
			}
		},
		[handleLogout, token],
	)

	const handleAuth = useCallback((data) => {
		setToken(data.token)
		localStorage.setItem(STORAGE_KEY, data.token)

		if (data.user?.email) {
			setUserEmail(data.user.email)
			localStorage.setItem(USER_EMAIL_STORAGE_KEY, data.user.email)
		}
	}, [])

	const loadModels = useCallback(
		async (botId) => {
			if (!token || !botId) return

			try {
				const res = await listBotModels(token, botId)
				setModels(res.models || [])
			} catch {
				setModels([])
			}
		},
		[token],
	)

	const loadConversations = useCallback(
		async (botId) => {
			if (!token || !botId) return []

			try {
				const res = await listConversations(token)
				const all = res.conversations || []
				const filtered = all.filter(
					(conversation) =>
						conversation.bot_token_id === botId && conversation.status !== "archived",
				)
				setConversations(filtered)
				return filtered
			} catch {
				setConversations([])
				return []
			}
		},
		[token],
	)

	const selectConversation = useCallback((convId) => {
		setSelectedConversationId(convId)
		if (convId) {
			localStorage.setItem(SELECTED_CONV_STORAGE_KEY, String(convId))
		} else {
			localStorage.removeItem(SELECTED_CONV_STORAGE_KEY)
		}
	}, [])

	const selectBot = useCallback(
		async (botId, botName = null, preferredConvId = null) => {
			setSelectedBotId(botId)
			if (botId) {
				localStorage.setItem(SELECTED_BOT_STORAGE_KEY, String(botId))
			} else {
				localStorage.removeItem(SELECTED_BOT_STORAGE_KEY)
			}

			const targetConvId =
				preferredConvId ||
				(localStorage.getItem(SELECTED_CONV_STORAGE_KEY)
					? Number(localStorage.getItem(SELECTED_CONV_STORAGE_KEY))
					: null)

			const [, convs] = await Promise.all([loadModels(botId), loadConversations(botId)])

			if (convs.length > 0) {
				const matched = targetConvId ? convs.find((c) => c.id === targetConvId) : null
				const chosen = matched || convs[0]
				selectConversation(chosen.id)
				return
			}

			try {
				const bot = botName || botsRef.current.find((entry) => entry.id === botId)?.name
				const created = await createConversation(token, botId, bot)
				setConversations([created])
				selectConversation(created.id)
			} catch {
				// ignore
			}
		},
		[loadConversations, loadModels, selectConversation, token],
	)

	const handleCreateConversation = useCallback(
		async (customOpts = {}) => {
			if (!selectedBotId || !token) return
			if (isCreatingConvRef.current) return
			isCreatingConvRef.current = true
			setIsCreatingConversation(true)

			const opts =
				customOpts &&
				!customOpts.nativeEvent &&
				!customOpts.preventDefault &&
				typeof customOpts === "object"
					? customOpts
					: {}

			try {
				const bot = botsRef.current.find((entry) => entry.id === selectedBotId)
				const title = opts.title || (opts.projectName ? `${opts.projectName} Session` : bot?.name)
				const metadata = opts.metadata || {}
				const externalSessionId =
					opts.external_session_id ||
					opts.externalSessionId ||
					(typeof window !== "undefined" && window.crypto?.randomUUID?.()
						? window.crypto.randomUUID()
						: undefined)

				const created = await createConversation(token, selectedBotId, {
					title,
					metadata,
					external_session_id: externalSessionId,
				})
				setConversations((prev) => {
					const isMatch = (c) =>
						(created.id != null && c.id != null && String(c.id) === String(created.id)) ||
						(created.external_session_id &&
							c.external_session_id &&
							String(c.external_session_id) === String(created.external_session_id))
					if (prev.some(isMatch)) {
						return prev.map((c) => (isMatch(c) ? { ...c, ...created } : c))
					}
					return [created, ...prev]
				})
				selectConversation(created.id)
				return created
			} catch (err) {
				console.error("Create conversation failed:", err)
			} finally {
				isCreatingConvRef.current = false
				setIsCreatingConversation(false)
			}
		},
		[selectedBotId, selectConversation, token],
	)

	const handleRefreshModels = useCallback(async () => {
		if (!selectedBotId || !token) return

		try {
			await refreshBotModels(token, selectedBotId)
			await loadModels(selectedBotId)
		} catch {
			// ignore
		}
	}, [loadModels, selectedBotId, token])

	const handleBotStatusChange = useCallback((botTokenId, status) => {
		setBots((prev) => prev.map((bot) => (bot.id === botTokenId ? { ...bot, ...status } : bot)))
	}, [])

	const handleConversationStatusChange = useCallback((convId, status, metadata) => {
		if (!convId) return
		setConversations((prev) =>
			prev.map((c) => {
				if (c.id === convId) {
					return {
						...c,
						status: status ?? c.status,
						metadata: metadata ? { ...(c.metadata || {}), ...metadata } : c.metadata,
					}
				}
				return c
			}),
		)
	}, [])

	const handleConversationTouch = useCallback((convId) => {
		if (!convId) return
		const nowIso = new Date().toISOString()
		setConversations((prev) =>
			prev.map((c) => {
				if (c.id === convId) {
					return {
						...c,
						last_user_input_time: nowIso,
						last_modified_time: nowIso,
						last_message_at: nowIso,
						updated_at: nowIso,
					}
				}
				return c
			}),
		)
	}, [])

	const handleSessionsUpdated = useCallback((syncedSessions) => {
		if (!Array.isArray(syncedSessions)) return
		setConversations((prev) => mergeSessionsIntoList(prev, syncedSessions))
	}, [])

	const handleDeleteBot = useCallback(
		async (botId) => {
			if (!token || !botId) return

			await deleteBot(token, botId)
			const updatedBots = bots.filter((bot) => bot.id !== botId)
			setBots(updatedBots)

			if (selectedBotId !== botId) return

			if (updatedBots.length > 0) {
				selectBot(updatedBots[0].id)
				return
			}

			setSelectedBotId(null)
			localStorage.removeItem(SELECTED_BOT_STORAGE_KEY)
			setConversations([])
			setSelectedConversationId(null)
			localStorage.removeItem(SELECTED_CONV_STORAGE_KEY)
			setModels([])
		},
		[bots, selectedBotId, selectBot, token],
	)

	const handleArchiveConversation = useCallback(
		async (convId) => {
			if (!token || !convId) return
			try {
				await archiveConversation(token, convId)
				setConversations((prev) =>
					prev.map((c) => (c.id === convId ? { ...c, status: "archived" } : c)),
				)
				// Do not automatically switch context to another session.
				// Keep current session in view so user sees it is archived and can close it if desired.
			} catch (err) {
				console.error("Failed to archive conversation:", err)
			}
		},
		[token],
	)

	// Listen for native notification clicks to auto-select conversation
	useEffect(() => {
		const unsubscribe = initNotificationListeners(({ conversationId, botId }) => {
			if (botId && botId !== selectedBotId) {
				selectBot(botId, null, conversationId)
			} else if (conversationId) {
				selectConversation(Number(conversationId))
			}
		})
		return unsubscribe
	}, [selectedBotId, selectBot, selectConversation])

	// Real-time synchronization of session states, updates, and creation for the selected bot
	useEffect(() => {
		if (!token || !selectedBotId) return

		let cancelled = false
		const socket = new Socket("/socket", { params: { token } })
		socket.connect()

		const channel = socket.channel(`bot_sessions:${selectedBotId}`, {})

		channel.on("session_status_changed", (payload) => {
			if (!payload?.conversation_id || cancelled) return
			const convId = payload.conversation_id
			const currentConvs = conversationsRef.current || []
			const existing = currentConvs.find((c) => c.id === convId)
			const prevStatus = existing?.status
			const newStatus = payload.status

			if (
				(prevStatus === "running" || prevStatus === "thinking") &&
				(newStatus === "idle" || newStatus === "completed" || newStatus === "done")
			) {
				const bot = botsRef.current?.find((b) => b.id === selectedBotId)
				notifySessionCompleted({
					botName: bot?.name,
					conversationTitle: existing?.title,
					conversationId: convId,
					activeConversationId: selectedConvIdRef.current,
					metadata: payload.metadata,
				})
			}

			if (newStatus === "waiting_for_input" || newStatus === "needs_input") {
				const bot = botsRef.current?.find((b) => b.id === selectedBotId)
				notifyWaitingForInput({
					botName: bot?.name,
					conversationTitle: existing?.title,
					conversationId: convId,
					activeConversationId: selectedConvIdRef.current,
					question: payload.metadata?.question,
					metadata: payload.metadata,
				})
			}

			setConversations((prev) =>
				prev.map((c) => {
					if (c.id === payload.conversation_id) {
						return {
							...c,
							status: payload.status ?? c.status,
							metadata: payload.metadata
								? { ...(c.metadata || {}), ...payload.metadata }
								: c.metadata,
						}
					}
					return c
				}),
			)
		})

		channel.on("bot_updated", (payload) => {
			if (!payload?.bot || cancelled) return
			setBots((prev) =>
				prev.map((b) => (b.id === payload.bot.id ? { ...b, ...payload.bot } : b)),
			)
		})

		channel.on("bot_sessions_updated", (payload) => {
			if (!payload?.sessions || cancelled) return
			setConversations((prev) => mergeSessionsIntoList(prev, payload.sessions))
		})

		channel.on("conversation_created", (payload) => {
			if (!payload?.conversation || cancelled) return
			const newConv = payload.conversation
			setConversations((prev) => {
				const isMatch = (c) =>
					(newConv.id != null && c.id != null && String(c.id) === String(newConv.id)) ||
					(newConv.external_session_id &&
						c.external_session_id &&
						String(c.external_session_id) === String(newConv.external_session_id))
				if (prev.some(isMatch)) {
					return prev.map((c) => (isMatch(c) ? { ...c, ...newConv } : c))
				}
				return [newConv, ...prev]
			})
		})

		channel.on("session_message_created", (payload) => {
			if (!payload?.conversation_id || cancelled) return
			const msgTime = payload.updated_at || new Date().toISOString()
			setConversations((prev) =>
				prev.map((c) => {
					if (c.id === payload.conversation_id) {
						return {
							...c,
							last_message_at: msgTime,
							updated_at: msgTime,
						}
					}
					return c
				}),
			)
		})

		channel
			.join()
			.receive("ok", (resp) => {
				if (cancelled) return
				if (resp?.bot) {
					setBots((prev) =>
						prev.map((b) => (b.id === resp.bot.id ? { ...b, ...resp.bot } : b)),
					)
				}
				if (Array.isArray(resp?.sessions)) {
					setConversations((prev) => mergeSessionsIntoList(prev, resp.sessions))
				}
			})
			.receive("error", (err) => {
				console.warn("Failed to join bot_sessions channel:", err)
			})

		return () => {
			cancelled = true
			channel.leave()
			socket.disconnect()
		}
	}, [token, selectedBotId])

	useEffect(() => {
		if (!token) return

		let cancelled = false
		setLoading(true)
		registerServiceWorker()
		requestNotificationPermission()

		loadBots(token)
			.then((list) => {
				if (cancelled) return
				setLoading(false)
				if (list.length > 0) {
					const savedBotId = Number(localStorage.getItem(SELECTED_BOT_STORAGE_KEY))
					const foundBot = savedBotId ? list.find((b) => b.id === savedBotId) : null
					const botToSelect = foundBot || list[0]
					const savedConvId = Number(localStorage.getItem(SELECTED_CONV_STORAGE_KEY))
					selectBot(botToSelect.id, botToSelect.name, savedConvId)
				}
			})
			.catch(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [token])

	// Re-fetch bot list and conversations when app regains visibility or focus (e.g. switching back to PWA)
	useEffect(() => {
		if (!token) return

		function handleVisibilityChange() {
			if (document.visibilityState === "visible") {
				loadBots()
				loadConversations()
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange)
		window.addEventListener("focus", handleVisibilityChange)
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange)
			window.removeEventListener("focus", handleVisibilityChange)
		}
	}, [loadBots, loadConversations, token])

	useEffect(() => {
		if (!token) return

		let cancelled = false

		async function checkConnection() {
			try {
				await pingApp(token)
				if (!cancelled) setAppConnection("online")
			} catch {
				if (!cancelled) setAppConnection("offline")
			}
		}

		function handleOffline() {
			setAppConnection("offline")
		}

		function handleOnline() {
			setAppConnection("checking")
			checkConnection()
		}

		setAppConnection("checking")
		checkConnection()
		const intervalId = window.setInterval(checkConnection, 10_000)
		window.addEventListener("offline", handleOffline)
		window.addEventListener("online", handleOnline)

		return () => {
			cancelled = true
			window.clearInterval(intervalId)
			window.removeEventListener("offline", handleOffline)
			window.removeEventListener("online", handleOnline)
		}
	}, [token])

	const selectedBot = bots.find((bot) => bot.id === selectedBotId) || null

	return {
		token,
		userEmail,
		bots,
		selectedBotId,
		conversations,
		selectedConversationId,
		models,
		loading,
		appConnection,
		selectedBot,
		handleAuth,
		handleLogout,
		loadBots,
		selectBot,
		selectConversation,
		isCreatingConversation,
		handleCreateConversation,
		handleRefreshModels,
		handleBotStatusChange,
		handleConversationStatusChange,
		handleConversationTouch,
		handleSessionsUpdated,
		handleDeleteBot,
		handleArchiveConversation,
	}
}
