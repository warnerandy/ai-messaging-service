import React, { useState, useEffect, useRef } from "react"
import { Socket } from "phoenix"
import MessageBubbleView from "./MessageBubble.jsx"
import TypingIndicatorView from "./TypingIndicator.jsx"
import {
	createConversationMessage,
	getConversation,
	getConversationChannel,
	uploadConversationAsset,
} from "../lib/data.js"
import { showNotificationIfBackgrounded } from "../lib/notifications.js"
import { startThinkingTimer, stopThinkingTimer } from "../thinkingTimer.mjs"

export function deriveConversationState(messages) {
	let hasPendingBotResponse = false

	const nextMessages = [...messages]

	for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
		const message = nextMessages[index]

		if (message.role === "bot") {
			hasPendingBotResponse = false
			continue
		}

		if (message.role === "user") {
			const awaitingResponse = Boolean(message.acknowledged) && !hasPendingBotResponse

			nextMessages[index] = {
				...message,
				awaitingResponse,
			}

			hasPendingBotResponse = awaitingResponse || hasPendingBotResponse
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
		fromSuggestion,
	}
}

export default function ChatView({
	token,
	bot,
	conversations,
	selectedConversationId,
	onSelectConversation,
	onCreateConversation,
	models,
	onRefreshModels,
	onBotStatusChange,
	onToggleSidebar,
}) {
	const [messages, setMessages] = useState([])
	const [inputValue, setInputValue] = useState("")
	const [selectedModel, setSelectedModel] = useState("")
	const [botIsTyping, setBotIsTyping] = useState(false)
	const [sending, setSending] = useState(false)
	const [selectedFile, setSelectedFile] = useState(null)
	const [uploading, setUploading] = useState(false)
	// Maps message id -> value of the suggestion the user clicked
	const [usedSuggestions, setUsedSuggestions] = useState({})
	const messagesEndRef = useRef(null)
	const socketRef = useRef(null)
	const channelRef = useRef(null)
	const renderedIdsRef = useRef(new Set())
	const hasJoinedConversationRef = useRef(false)
	const messagesRef = useRef([])
	const typingTimeoutRef = useRef(null)
	const inputRef = useRef(null)

	function startBotThinking(timeoutMs = null) {
		startThinkingTimer(typingTimeoutRef, setBotIsTyping, timeoutMs)
	}

	function stopBotThinking() {
		stopThinkingTimer(typingTimeoutRef, setBotIsTyping)
	}

	// Scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages, botIsTyping])

	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

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

		function extractLastMessageId(items) {
			for (let index = items.length - 1; index >= 0; index -= 1) {
				const message = items[index]
				if (!message || message.pending) continue
				if (typeof message.id === "number") return message.id
			}
			return null
		}

		async function refetchMissedMessages() {
			const afterId = extractLastMessageId(messagesRef.current)
			if (!afterId) return

			try {
				const res = await getConversation(token, selectedConversationId, {
					afterId,
					limit: 25,
				})
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

					fetched.forEach((incoming) => {
						const key = String(incoming.id)
						const existingIndex = byId.get(key)

						if (existingIndex === undefined) {
							byId.set(key, next.length)
							next.push(incoming)
							return
						}

						next[existingIndex] = normalizeMessage(incoming, {
							...next[existingIndex],
							pending: false,
							failed: false,
						})
					})

					const state = deriveConversationState(next)
					setBotIsTyping(state.botIsTyping)
					return state.messages
				})
			} catch (err) {
				console.error("Missed message refetch failed:", err)
			}
		}

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
							return next
						}

						return [...prev, incoming]
					})

					if (incoming.role !== "user") {
						stopBotThinking()
						setMessages((prev) =>
							prev.map((m) =>
								m.role === "user" && m.awaitingResponse ? { ...m, awaitingResponse: false } : m,
							),
						)
					}

					showNotificationIfBackgrounded(payload.message)
				})

				ch.on("message_acknowledged", (payload) => {
					if (!payload?.message_id) return

					setMessages((prev) =>
						prev.map((m) =>
							m.id === payload.message_id
								? { ...m, acknowledged: true, awaitingResponse: true }
								: m,
						),
					)

					startBotThinking()
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

				ch.join()
					.receive("ok", () => {
						if (cancelled) return
						channelRef.current = ch

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
		}
	}, [selectedConversationId, token])

	// Load messages when conversation changes
	useEffect(() => {
		if (!selectedConversationId || !token) return
		hasJoinedConversationRef.current = false
		renderedIdsRef.current.clear()
		stopBotThinking()
		setUsedSuggestions({})

		async function loadMessages() {
			try {
				const res = await getConversation(token, selectedConversationId)
				const msgs = (res.messages || []).map((message) => normalizeMessage(message))
				msgs.forEach((m) => renderedIdsRef.current.add(m.id))
				const nextState = deriveConversationState(msgs)
				setMessages(nextState.messages)
				setBotIsTyping(nextState.botIsTyping)
			} catch (err) {
				console.error("Load messages failed:", err)
			}
		}
		loadMessages()
	}, [selectedConversationId, token])

	useEffect(() => {
		if (models.length === 0) {
			setSelectedModel("")
			return
		}

		const exists = models.some((m) => m.name === selectedModel)
		if (!exists) {
			setSelectedModel(models[0].name)
		}
	}, [models, selectedModel])

	useEffect(() => {
		return () => {
			clearTimeout(typingTimeoutRef.current)
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
		const optimisticId = `optimistic-${Date.now()}`
		const optimistic = {
			id: optimisticId,
			body,
			model,
			role: "user",
			content_type: "text",
			pending: true,
			fromSuggestion: opts.fromSuggestion || false,
			inserted_at: new Date().toISOString(),
		}

		setMessages((prev) => [...prev, optimistic])
		setSending(true)

		try {
			const payload = { body }
			if (model) payload.model = model
			if (opts.fromSuggestion) payload.is_suggestion = true

			const res = await createConversationMessage(token, selectedConversationId, payload)

			setMessages((prev) => {
				const deliveredAlreadyPresent = prev.some((m) => m.id === res.id && !m.pending)
				if (deliveredAlreadyPresent) {
					return prev.filter((m) => m.id !== optimisticId)
				}
				return prev.map((m) =>
					m.id === optimisticId
						? normalizeMessage(res, {
								pending: false,
								failed: false,
								acknowledged: m.acknowledged,
								fromSuggestion: m.fromSuggestion,
							})
						: m,
				)
			})
			renderedIdsRef.current.add(res.id)
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
		const optimisticId = `optimistic-${Date.now()}`
		const assetType = file.type.startsWith("image/") ? "image" : "file"
		const optimistic = {
			id: optimisticId,
			body: null,
			metadata: { url: URL.createObjectURL(file), filename: file.name },
			model,
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
		await sendMessage(body)
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

	const selectedConv = conversations.find((c) => c.id === selectedConversationId)

	return (
		<main className="chat-main">
			{/* Top bar */}
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
				<h2 className="chat-title">{selectedConv?.title || bot.name}</h2>
				<div className="chat-topbar-right">
					<span className={`connection-dot ${bot.is_connected ? "connection-dot--on" : ""}`} />
					<span className="connection-label">{bot.is_connected ? "Online" : "Offline"}</span>
				</div>
			</div>

			{/* Messages */}
			<div className="chat-messages">
				{messages.length === 0 && (
					<div className="chat-welcome">
						<p className="chat-welcome-text">
							Start a conversation with <strong>{bot.name}</strong>
						</p>
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
				{botIsTyping && <TypingIndicatorView />}
				<div ref={messagesEndRef} />
			</div>

			{/* Input area */}
			<div className="chat-input-area">
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
				<form id="message-form" onSubmit={handleSend} className="chat-input-form">
					<textarea
						id="message-input"
						ref={inputRef}
						className="chat-textarea"
						placeholder="What do you want to know?"
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
							<button
								type="submit"
								className={`send-btn ${inputValue.trim() ? "send-btn--active" : ""}`}
								disabled={sending || !inputValue.trim()}
								aria-label="Send message"
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
						)}
					</div>
				</form>
			</div>
		</main>
	)
}
