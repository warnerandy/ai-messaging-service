import React, { useState, useEffect, useRef, useCallback } from "react"
import { createRoot } from "react-dom/client"
import { Socket } from "phoenix"
import "../css/app.css"
import {
  Spinner,
} from "@heroui/react"

const STORAGE_KEY = "messaging.user.token"

/* ───────── API helper ───────── */
async function apiRequest(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || "Request failed")
  return json
}

/* ───────── Service worker + notifications ───────── */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    })
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission()
  }
}

function showNotificationIfBackgrounded(message) {
  if (!("serviceWorker" in navigator) || !document.hidden) return
  if (message.role !== "bot") return
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg) {
      reg.showNotification("New message from bot", {
        body: message.body || "You have a new message",
        tag: "bot-message",
        requireInteraction: false,
      })
    }
  })
}

/* ───────── Auth Panel ───────── */
function AuthPanel({ onAuth }) {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const endpoint = mode === "login" ? "/api/login" : "/api/register"
      const res = await apiRequest(endpoint, {
        method: "POST",
        body: { email, password },
      })
      onAuth(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-glow" />
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="12" fill="#2489ff" fillOpacity="0.15" />
            <path d="M12 16a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2h-3l-3 3-3-3h-3a2 2 0 01-2-2v-6z" stroke="#2489ff" strokeWidth="1.5" fill="none"/>
            <circle cx="17" cy="19" r="1.25" fill="#2489ff"/>
            <circle cx="23" cy="19" r="1.25" fill="#2489ff"/>
          </svg>
        </div>
        <h1 className="auth-title">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="auth-subtitle">
          {mode === "login"
            ? "Sign in to manage your bots and conversations"
            : "Get started with your messaging workspace"}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-fields">
            <div className="field-group">
              <label className="field-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                className="field-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                className="field-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
          </div>

          {error && (
            <div className="form-error">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 4.5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading && <Spinner size="sm" />}
            {mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <button
          type="button"
          className="mode-toggle"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login")
            setError("")
          }}
        >
          {mode === "login"
            ? "Create a new account"
            : "Sign in to existing account"}
        </button>
      </div>
    </div>
  )
}

/* ───────── Bot Token Reveal ───────── */
function BotTokenReveal({ token, onDismiss }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="token-reveal">
      <p className="token-title">Bot Token Created</p>
      <p className="token-warning">Copy this token now — it won't be shown again.</p>
      <div className="token-row">
        <code className="token-value">{token}</code>
        <button type="button" className="token-copy-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <button type="button" className="token-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

/* ───────── Sidebar ───────── */
function Sidebar({ token, bots, selectedBotId, onSelectBot, onBotsChange, onDeleteBot, conversations, selectedConversationId, onSelectConversation, onCreateConversation, userEmail, onLogout, isOpen }) {
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
      const created = await apiRequest("/api/bot-tokens", {
        method: "POST",
        body: { name },
        token,
      })
      if (created?.token) setCreatedToken(created.token)
      setNewBotName("")
      setShowBotForm(false)
      onBotsChange()
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
        <span className="user-email">{userEmail || "User"}</span>
      </div>

      {/* New chat button */}
      <button type="button" className="sidebar-action-btn" onClick={onCreateConversation}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        New Chat
      </button>

      {/* Bot selector */}
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span className="sidebar-section-label">Bots</span>
          <button type="button" className="sidebar-icon-btn" onClick={() => setShowBotForm(!showBotForm)} title="Add bot">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
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

      {/* Conversations */}
      <div className="sidebar-section sidebar-section--grow">
        <span className="sidebar-section-label">Recent</span>
        <nav className="conv-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`conv-item ${c.id === selectedConversationId ? "conv-item--active" : ""}`}
              onClick={() => onSelectConversation(c.id)}
            >
              <svg className="conv-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4.5a1.5 1.5 0 011.5-1.5h7a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-1.5 1.5H8l-2.5 2V11H4.5A1.5 1.5 0 013 9.5v-5z" stroke="currentColor" strokeWidth="1.2"/></svg>
              <span className="conv-title">{c.title || `Conversation ${c.id}`}</span>
            </button>
          ))}
          {conversations.length === 0 && <p className="sidebar-hint">No conversations</p>}
        </nav>
      </div>

      {/* Logout */}
      <button type="button" className="sidebar-logout" onClick={onLogout}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6M10.5 11.5L14 8l-3.5-3.5M14 8H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Sign Out
      </button>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
            <h3 className="modal-title">Delete Bot</h3>
            <p className="modal-text">
              Are you sure you want to delete <strong>{confirmDelete.name}</strong>? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="modal-btn modal-btn--danger" onClick={confirmDeleteBot}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ───────── Typing Indicator ───────── */
function TypingIndicator() {
  return (
    <div className="msg msg--bot">
      <div className="msg-avatar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="11" r="1.25" fill="currentColor"/><circle cx="15" cy="11" r="1.25" fill="currentColor"/></svg>
      </div>
      <div className="msg-content">
        <div className="typing-dots"><span/><span/><span/></div>
      </div>
    </div>
  )
}

/* ───────── Message Bubble ───────── */
function MessageBubble({ message }) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className={`msg msg--user ${message.pending ? "msg--pending" : ""} ${message.failed ? "msg--failed" : ""}`}>
        <div className="msg-bubble">
          <p className="msg-text">{message.body}</p>
          {message.pending && <span className="msg-status">Sending…</span>}
          {message.failed && <span className="msg-status msg-status--error">Failed</span>}
          {!message.pending && !message.failed && message.acknowledged && (
            <span className="msg-status msg-status--delivered">Delivered</span>
          )}
          {!message.pending && !message.failed && !message.acknowledged && (
            <span className="msg-status msg-status--sent">Sent</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="msg msg--bot">
      <div className="msg-avatar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="11" r="1.25" fill="currentColor"/><circle cx="15" cy="11" r="1.25" fill="currentColor"/></svg>
      </div>
      <div className="msg-content">
        <p className="msg-text">{message.body}</p>
        {message.model && <span className="msg-model">{message.model}</span>}
      </div>
    </div>
  )
}

/* ───────── Chat View ───────── */
function ChatView({ token, bot, conversations, selectedConversationId, onSelectConversation, onCreateConversation, models, onRefreshModels, onBotStatusChange, onToggleSidebar }) {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [botIsTyping, setBotIsTyping] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef(null)
  const socketRef = useRef(null)
  const channelRef = useRef(null)
  const renderedIdsRef = useRef(new Set())
  const typingTimeoutRef = useRef(null)
  const inputRef = useRef(null)

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, botIsTyping])

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

    async function joinChannel() {
      try {
        const info = await apiRequest(
          `/api/conversations/${selectedConversationId}/channel`,
          { token }
        )
        if (cancelled) return

        if (channelRef.current) {
          channelRef.current.leave()
          channelRef.current = null
        }

        const ch = socketRef.current.channel(info.topic, {})

        ch.on("new_message", (payload) => {
          if (!payload?.message) return
          setMessages((prev) => {
            if (renderedIdsRef.current.has(payload.message.id)) return prev
            renderedIdsRef.current.add(payload.message.id)
            return [...prev, payload.message]
          })
          showNotificationIfBackgrounded(payload.message)
        })

        ch.on("message_acknowledged", (payload) => {
          if (!payload?.message_id) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.message_id ? { ...m, acknowledged: true } : m
            )
          )
        })

        ch.on("bot_status_changed", (payload) => {
          if (payload?.is_working !== undefined) {
            if (payload.is_working) {
              setBotIsTyping(true)
              clearTimeout(typingTimeoutRef.current)
              typingTimeoutRef.current = setTimeout(() => setBotIsTyping(false), 3000)
            } else {
              setBotIsTyping(false)
            }
          }
          if (payload?.is_connected !== undefined && onBotStatusChange) {
            onBotStatusChange(payload.bot_token_id, { is_connected: payload.is_connected })
          }
        })

        ch.join()
          .receive("ok", () => {
            if (!cancelled) channelRef.current = ch
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
    renderedIdsRef.current.clear()

    async function loadMessages() {
      try {
        const res = await apiRequest(`/api/conversations/${selectedConversationId}`, { token })
        const msgs = res.messages || []
        msgs.forEach((m) => renderedIdsRef.current.add(m.id))
        setMessages(msgs)
      } catch (err) {
        console.error("Load messages failed:", err)
      }
    }
    loadMessages()
  }, [selectedConversationId, token])

  async function handleSend(e) {
    e.preventDefault()
    const body = inputValue.trim()
    if (!body || !selectedConversationId) return

    const model = selectedModel || null
    const optimisticId = `optimistic-${Date.now()}`
    const optimistic = {
      id: optimisticId,
      body,
      model,
      role: "user",
      content_type: "text",
      pending: true,
      inserted_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimistic])
    setInputValue("")
    setSending(true)

    try {
      const payload = { body }
      if (model) payload.model = model

      const res = await apiRequest(
        `/api/conversations/${selectedConversationId}/messages`,
        { method: "POST", body: payload, token }
      )

      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...m, id: res.id, pending: false }
            : m
        )
      )
      renderedIdsRef.current.add(res.id)
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, pending: false, failed: true } : m
        )
      )
    } finally {
      setSending(false)
    }
  }

  if (!bot) {
    return (
      <main className="chat-main">
        <div className="chat-topbar">
          <button type="button" className="mobile-menu-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
          <h2 className="chat-title">Messaging</h2>
          <div className="chat-topbar-right" />
        </div>
        <div className="chat-empty">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
            <rect x="6" y="10" width="36" height="24" rx="4" stroke="currentColor" strokeWidth="2"/>
            <path d="M18 30l-4 6v-6h-4a4 4 0 01-4-4V14a4 4 0 014-4h28a4 4 0 014 4v12a4 4 0 01-4 4H18z" stroke="currentColor" strokeWidth="2" fill="none"/>
            <circle cx="18" cy="20" r="2" fill="currentColor"/>
            <circle cx="24" cy="20" r="2" fill="currentColor"/>
            <circle cx="30" cy="20" r="2" fill="currentColor"/>
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
        <button type="button" className="mobile-menu-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
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
            <p className="chat-welcome-text">Start a conversation with <strong>{bot.name}</strong></p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {botIsTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <form onSubmit={handleSend} className="chat-input-form">
          <textarea
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
              <select
                className="model-picker"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                aria-label="Model"
              >
                <option value="">Auto</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className={`send-btn ${inputValue.trim() ? "send-btn--active" : ""}`}
              disabled={sending || !inputValue.trim()}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

/* ───────── Main App ───────── */
function App() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("messaging.user.email") || "")
  const [bots, setBots] = useState([])
  const [selectedBotId, setSelectedBotId] = useState(null)
  const [conversations, setConversations] = useState([])
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  function handleAuth(data) {
    setToken(data.token)
    localStorage.setItem(STORAGE_KEY, data.token)
    if (data.user?.email) {
      setUserEmail(data.user.email)
      localStorage.setItem("messaging.user.email", data.user.email)
    }
  }

  function handleLogout() {
    setToken(null)
    setUserEmail("")
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem("messaging.user.email")
    setBots([])
    setSelectedBotId(null)
    setConversations([])
    setSelectedConversationId(null)
    setModels([])
  }

  const loadBots = useCallback(async () => {
    if (!token) return
    try {
      const res = await apiRequest("/api/bot-tokens", { token })
      const list = res.bot_tokens || []
      setBots(list)
      return list
    } catch (err) {
      if (err.message.includes("401") || err.message.includes("Unauthorized")) {
        handleLogout()
      }
      return []
    }
  }, [token])

  const loadModels = useCallback(
    async (botId) => {
      if (!token || !botId) return
      try {
        const res = await apiRequest(`/api/bot-tokens/${botId}/models`, { token })
        setModels(res.models || [])
      } catch {
        setModels([])
      }
    },
    [token]
  )

  const loadConversations = useCallback(
    async (botId) => {
      if (!token || !botId) return
      try {
        const res = await apiRequest("/api/conversations", { token })
        const all = res.conversations || []
        const filtered = all.filter((c) => c.bot_token_id === botId)
        setConversations(filtered)
        return filtered
      } catch {
        setConversations([])
        return []
      }
    },
    [token]
  )

  const selectBot = useCallback(
    async (botId) => {
      setSelectedBotId(botId)
      const [, convs] = await Promise.all([
        loadModels(botId),
        loadConversations(botId),
      ])
      if (convs && convs.length > 0) {
        setSelectedConversationId(convs[0].id)
      } else if (convs && convs.length === 0) {
        // Auto-create conversation
        try {
          const created = await apiRequest("/api/conversations", {
            method: "POST",
            body: { bot_token_id: botId },
            token,
          })
          setConversations([created])
          setSelectedConversationId(created.id)
        } catch {
          // ignore
        }
      }
    },
    [loadModels, loadConversations, token]
  )

  async function handleCreateConversation() {
    if (!selectedBotId || !token) return
    try {
      const created = await apiRequest("/api/conversations", {
        method: "POST",
        body: { bot_token_id: selectedBotId },
        token,
      })
      setConversations((prev) => [created, ...prev])
      setSelectedConversationId(created.id)
    } catch (err) {
      console.error("Create conversation failed:", err)
    }
  }

  async function handleRefreshModels() {
    if (!selectedBotId || !token) return
    try {
      await apiRequest(`/api/bot-tokens/${selectedBotId}/refresh-models`, {
        method: "POST",
        token,
      })
      await loadModels(selectedBotId)
    } catch {
      // ignore
    }
  }

  function handleBotStatusChange(botTokenId, status) {
    setBots((prev) =>
      prev.map((b) =>
        b.id === botTokenId ? { ...b, ...status } : b
      )
    )
  }

  async function handleDeleteBot(botId) {
    if (!token || !botId) return
    await apiRequest(`/api/bot-tokens/${botId}`, { method: "DELETE", token })
    const updatedBots = bots.filter((b) => b.id !== botId)
    setBots(updatedBots)
    if (selectedBotId === botId) {
      if (updatedBots.length > 0) {
        selectBot(updatedBots[0].id)
      } else {
        setSelectedBotId(null)
        setConversations([])
        setSelectedConversationId(null)
        setModels([])
      }
    }
  }

  // Initial load
  useEffect(() => {
    if (!token) return
    setLoading(true)
    registerServiceWorker()
    requestNotificationPermission()

    loadBots().then((list) => {
      setLoading(false)
      if (list && list.length > 0) {
        selectBot(list[0].id)
      }
    })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return <AuthPanel onAuth={handleAuth} />
  }

  const selectedBot = bots.find((b) => b.id === selectedBotId) || null

  return (
    <div className="app-layout">
      {loading ? (
        <div className="loading-container">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {mobileSidebarOpen && <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />}
          <Sidebar
            token={token}
            bots={bots}
            selectedBotId={selectedBotId}
            onSelectBot={(id) => { selectBot(id); setMobileSidebarOpen(false); }}
            onBotsChange={loadBots}
            onDeleteBot={handleDeleteBot}
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelectConversation={(id) => { setSelectedConversationId(id); setMobileSidebarOpen(false); }}
            onCreateConversation={() => { handleCreateConversation(); setMobileSidebarOpen(false); }}
            userEmail={userEmail}
            onLogout={handleLogout}
            isOpen={mobileSidebarOpen}
          />
          <ChatView
            token={token}
            bot={selectedBot}
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
            onCreateConversation={handleCreateConversation}
            models={models}
            onRefreshModels={handleRefreshModels}
            onBotStatusChange={handleBotStatusChange}
            onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          />
        </>
      )}
    </div>
  )
}

/* ───────── Mount ───────── */
const root = createRoot(document.getElementById("app"))
root.render(<App />)
