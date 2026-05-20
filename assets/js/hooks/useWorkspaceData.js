import { useCallback, useEffect, useState } from "react"
import {
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

export function useWorkspaceData() {
	const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))
	const [userEmail, setUserEmail] = useState(
		() => localStorage.getItem(USER_EMAIL_STORAGE_KEY) || "",
	)
	const [bots, setBots] = useState([])
	const [selectedBotId, setSelectedBotId] = useState(null)
	const [conversations, setConversations] = useState([])
	const [selectedConversationId, setSelectedConversationId] = useState(null)
	const [models, setModels] = useState([])
	const [loading, setLoading] = useState(false)
	const [appConnection, setAppConnection] = useState("checking")

	const handleLogout = useCallback(() => {
		setToken(null)
		setUserEmail("")
		localStorage.removeItem(STORAGE_KEY)
		localStorage.removeItem(USER_EMAIL_STORAGE_KEY)
		setBots([])
		setSelectedBotId(null)
		setConversations([])
		setSelectedConversationId(null)
		setModels([])
	}, [])

	const handleAuth = useCallback((data) => {
		setToken(data.token)
		localStorage.setItem(STORAGE_KEY, data.token)

		if (data.user?.email) {
			setUserEmail(data.user.email)
			localStorage.setItem(USER_EMAIL_STORAGE_KEY, data.user.email)
		}
	}, [])

	const loadBots = useCallback(async () => {
		if (!token) return []

		try {
			const res = await listBots(token)
			const list = res.bot_tokens || []
			setBots(list)
			return list
		} catch (err) {
			if (err.message.includes("401") || err.message.includes("Unauthorized")) {
				handleLogout()
			}
			return []
		}
	}, [handleLogout, token])

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

	const selectBot = useCallback(
		async (botId) => {
			setSelectedBotId(botId)

			const [, convs] = await Promise.all([loadModels(botId), loadConversations(botId)])

			if (convs.length > 0) {
				setSelectedConversationId(convs[0].id)
				return
			}

			try {
				const created = await createConversation(token, botId)
				setConversations([created])
				setSelectedConversationId(created.id)
			} catch {
				// ignore
			}
		},
		[loadConversations, loadModels, token],
	)

	const handleCreateConversation = useCallback(async () => {
		if (!selectedBotId || !token) return

		try {
			const created = await createConversation(token, selectedBotId)
			setConversations((prev) => [created, ...prev])
			setSelectedConversationId(created.id)
		} catch (err) {
			console.error("Create conversation failed:", err)
		}
	}, [selectedBotId, token])

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
			setConversations([])
			setSelectedConversationId(null)
			setModels([])
		},
		[bots, selectedBotId, selectBot, token],
	)

	useEffect(() => {
		if (!token) return

		setLoading(true)
		registerServiceWorker()
		requestNotificationPermission()

		loadBots().then((list) => {
			setLoading(false)
			if (list.length > 0) {
				selectBot(list[0].id)
			}
		})
	}, [loadBots, selectBot, token])

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
		handleCreateConversation,
		handleRefreshModels,
		handleBotStatusChange,
		handleDeleteBot,
		setSelectedConversationId,
	}
}
