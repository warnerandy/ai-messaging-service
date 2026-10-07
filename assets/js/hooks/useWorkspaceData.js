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
import { registerServiceWorker, requestNotificationPermission } from "../lib/notifications.js"

const STORAGE_KEY = "messaging.user.token"
const USER_EMAIL_STORAGE_KEY = "messaging.user.email"
const SELECTED_BOT_STORAGE_KEY = "messaging.selected.bot_id"
const SELECTED_CONV_STORAGE_KEY = "messaging.selected.conversation_id"

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
	const [appConnection, setAppConnection] = useState("checking")
	const botsRef = useRef(bots)

	useEffect(() => {
		botsRef.current = bots
	}, [bots])

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
				const filtered = all.filter((conversation) => conversation.bot_token_id === botId)
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

	const handleCreateConversation = useCallback(async () => {
		if (!selectedBotId || !token) return

		try {
			const bot = botsRef.current.find((entry) => entry.id === selectedBotId)
			const created = await createConversation(token, selectedBotId, bot?.name)
			setConversations((prev) => [created, ...prev])
			selectConversation(created.id)
		} catch (err) {
			console.error("Create conversation failed:", err)
		}
	}, [selectedBotId, selectConversation, token])

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
		setConversations((prev) => {
			const map = new Map(prev.map((c) => [c.id, c]))
			for (const s of syncedSessions) {
				const existing = map.get(s.id)
				map.set(s.id, {
					...(existing || {}),
					...s,
					last_user_input_time: s.last_user_input_time || existing?.last_user_input_time,
					last_modified_time: s.last_modified_time || existing?.last_modified_time,
					last_message_at: existing?.last_message_at || s.last_message_at,
					metadata: { ...(existing?.metadata || {}), ...(s.metadata || {}) },
				})
			}
			return Array.from(map.values())
		})
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
				if (selectedConversationId === convId) {
					const remaining = conversations.filter(
						(c) => c.id !== convId && c.status !== "archived" && c.status !== "done" && c.status !== "completed",
					)
					if (remaining.length > 0) {
						selectConversation(remaining[0].id)
					} else {
						selectConversation(null)
					}
				}
			} catch (err) {
				console.error("Failed to archive conversation:", err)
			}
		},
		[conversations, selectConversation, selectedConversationId, token],
	)

	// Real-time synchronization of session states, updates, and creation for the selected bot
	useEffect(() => {
		if (!token || !selectedBotId) return

		let cancelled = false
		const socket = new Socket("/socket", { params: { token } })
		socket.connect()

		const channel = socket.channel(`bot_sessions:${selectedBotId}`, {})

		channel.on("session_status_changed", (payload) => {
			if (!payload?.conversation_id || cancelled) return
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

		channel.on("bot_sessions_updated", (payload) => {
			if (!payload?.sessions || cancelled) return
			setConversations((prev) => {
				const map = new Map(prev.map((c) => [c.id, c]))
				for (const s of payload.sessions) {
					const existing = map.get(s.id)
					map.set(s.id, {
						...(existing || {}),
						...s,
						last_message_at: existing?.last_message_at || s.last_message_at,
						metadata: { ...(existing?.metadata || {}), ...(s.metadata || {}) },
					})
				}
				return Array.from(map.values())
			})
		})

		channel.on("conversation_created", (payload) => {
			if (!payload?.conversation || cancelled) return
			setConversations((prev) => {
				if (prev.some((c) => c.id === payload.conversation.id)) return prev
				return [payload.conversation, ...prev]
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
				if (Array.isArray(resp?.sessions)) {
					setConversations((prev) => {
						const map = new Map(prev.map((c) => [c.id, c]))
						for (const s of resp.sessions) {
							const existing = map.get(s.id)
							map.set(s.id, {
								...(existing || {}),
								...s,
								last_message_at: existing?.last_message_at || s.last_message_at,
								metadata: { ...(existing?.metadata || {}), ...(s.metadata || {}) },
							})
						}
						return Array.from(map.values())
					})
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

	// Re-fetch bot list when app regains visibility (e.g. switching back to PWA)
	useEffect(() => {
		if (!token) return

		function handleVisibilityChange() {
			if (document.visibilityState === "visible") {
				loadBots()
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange)
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
	}, [loadBots, token])

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
