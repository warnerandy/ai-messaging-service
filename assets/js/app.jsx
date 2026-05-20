import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createRoot } from "react-dom/client"
import { Socket } from "phoenix"
import DOMPurify from "dompurify"
import { marked } from "marked"
import hljs from "highlight.js/lib/core"
import elixir from "highlight.js/lib/languages/elixir"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import bash from "highlight.js/lib/languages/bash"
import xml from "highlight.js/lib/languages/xml"
import markdown from "highlight.js/lib/languages/markdown"
import { startThinkingTimer, stopThinkingTimer } from "./thinkingTimer.mjs"
import "highlight.js/styles/github-dark.css"
import "../css/app.css"
import {
  Spinner,
} from "@heroui/react"

const STORAGE_KEY = "messaging.user.token"

const THINKING_BLURBS = {
  witty: [
    "Consulting the tiny genius in the ceiling.",
    "Translating sparks into sentences.",
    "Pretending this was obvious all along.",
    "Brewing a fresh pot of context.",
    "Assembling words with suspicious confidence.",
    "Checking whether that idea wears a tie.",
    "Tuning the answer until it hums.",
    "Negotiating with the punctuation department.",
    "Dusting off the good verbs.",
    "Searching for the least embarrassing brilliance.",
    "Running a quick vibe check on reality.",
    "Untangling the smart part from the loud part.",
    "Feeding the hamster that powers the logic wheel.",
    "Comparing clever options with a dramatic squint.",
    "Double-knotting the reasoning.",
    "Sharpening a response on the nearest fact.",
    "Trying not to overthink the thinking.",
    "Organizing electrons into a respectable opinion.",
    "Letting the idea simmer for flavor.",
    "Checking the answer for loose metaphors.",
    "Borrowing a flashlight from common sense.",
    "Polishing a likely correct sentence.",
    "Asking the inner committee for one final vote.",
    "Looking for the elegant route through the mess.",
    "Rehearsing the useful part.",
    "Measuring twice, phrasing once.",
    "Converting intuition into indoor plumbing.",
    "Folding nuance into a carry-on size.",
    "Attempting to make this both smart and readable.",
    "Checking whether the answer can survive daylight.",
    "Aligning facts, style, and a mild sense of drama.",
    "Sneaking up on the point.",
    "Putting the right amount of clever on it.",
    "Rescuing a thought from unnecessary complexity.",
    "Letting the better answer elbow past the first one.",
    "Calibrating for usefulness over theater.",
    "Turning a pile of maybes into a decent yes.",
    "Testing the sentence for structural integrity.",
    "Sweeping for bugs in the logic attic.",
    "Teaching the answer to arrive in order.",
    "Replacing hand-wavy with actually helpful.",
    "Doing the mental equivalent of rolling up sleeves.",
    "Trying a bold idea, then adding guardrails.",
    "Looking for a clean landing.",
    "Crossing the t's and side-eyeing the i's.",
    "Compressing ten thoughts into one useful one.",
    "Giving the response a quick tune-up.",
    "Making the answer less weird than the draft.",
    "Checking for elegance, then settling for solid.",
    "Preparing a response with at least one good angle.",
  ],
  dry: [
    "Applying unnecessary restraint to several good ideas.",
    "Reducing chaos to bullet points.",
    "Verifying that confidence and accuracy remain acquainted.",
    "Selecting the least regrettable phrasing.",
    "Running the answer through a basic dignity filter.",
    "Converting noise into something billable.",
    "Checking whether the obvious answer is also correct.",
    "Removing three clever parts and keeping the useful one.",
    "Organizing facts into a format acceptable to adults.",
    "Performing light maintenance on the conclusion.",
    "Rearranging certainty into a safer shape.",
    "Testing whether brevity can survive contact with nuance.",
  ],
  dramatic: [
    "Summoning an answer from the storm above the stack.",
    "Holding counsel with the thunder of possibility.",
    "Forging a sentence in the furnace of context.",
    "Waiting for the right idea to step from the fog.",
    "Gathering the loose sparks before they become insight.",
    "Charting a course through the ruins of bad drafts.",
    "Listening for the one sentence that enters like a hero.",
    "Bracing the reply against the winds of ambiguity.",
    "Giving the truth a more cinematic entrance.",
    "Pulling a clean answer from the mouth of the machine.",
    "Sharpening the point until it glints.",
    "Escorting the better idea onto the stage.",
  ],
}

const THINKING_TONE_OPTIONS = [
  { value: "witty", label: "Witty" },
  { value: "dry", label: "Dry" },
  { value: "dramatic", label: "Dramatic" },
]

hljs.registerLanguage("elixir", elixir)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("markdown", markdown)

marked.setOptions({
  gfm: true,
  breaks: true,
})

function renderMarkdown(rawText) {
  if (!rawText) return ""

  const html = marked.parse(rawText)
  const sanitizedHtml = DOMPurify.sanitize(html)

  if (typeof document === "undefined") return sanitizedHtml

  const template = document.createElement("template")
  template.innerHTML = sanitizedHtml

  template.content.querySelectorAll("pre code").forEach((codeBlock) => {
    const className = codeBlock.className || ""
    const langMatch = className.match(/language-([\w-]+)/)
    const lang = langMatch?.[1]?.toLowerCase()
    const code = codeBlock.textContent || ""

    const highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang })
      : hljs.highlightAuto(code)

    codeBlock.innerHTML = highlighted.value
    codeBlock.classList.add("hljs")
    if (lang) {
      codeBlock.classList.add(`language-${lang}`)
    }
  })

  return template.innerHTML
}

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
function TypingIndicator({ tone = "witty" }) {
  const activeBlurbs = THINKING_BLURBS[tone] || THINKING_BLURBS.witty
  const [blurbIndex, setBlurbIndex] = useState(
    () => Math.floor(Math.random() * activeBlurbs.length)
  )

  useEffect(() => {
    const startingIndex = Math.floor(Math.random() * activeBlurbs.length)
    setBlurbIndex(startingIndex)

    const intervalId = window.setInterval(() => {
      setBlurbIndex((prev) => (prev + 1) % activeBlurbs.length)
    }, 10_000)

    return () => window.clearInterval(intervalId)
  }, [activeBlurbs])

  return (
    <div className="msg msg--bot">
      <div className="msg-avatar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="11" r="1.25" fill="currentColor"/><circle cx="15" cy="11" r="1.25" fill="currentColor"/></svg>
      </div>
      <div className="msg-content">
        <div className="msg-typing-row">
          <div className="msg-bubble msg-bubble--bot msg-bubble--typing">
            <div className="typing-dots"><span/><span/><span/></div>
          </div>
          <p key={`${tone}-${blurbIndex}`} className="msg-thinking-blurb" aria-live="polite">{activeBlurbs[blurbIndex]}</p>
        </div>
      </div>
    </div>
  )
}

/* ───────── Message Bubble ───────── */
function MessageBubble({ message, onSuggestion, usedSuggestion }) {
  const isUser = message.role === "user"
  const botBodyHtml = useMemo(
    () => (!isUser && message.body ? renderMarkdown(message.body) : ""),
    [isUser, message.body]
  )

  if (isUser) {
    return (
      <div className={`msg msg--user ${message.pending ? "msg--pending" : ""} ${message.failed ? "msg--failed" : ""}`}>
        <div className="msg-bubble">
          {message.fromSuggestion && (
            <span className="msg-suggestion-origin">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Suggestion
            </span>
          )}
          <p className="msg-text">{message.body}</p>
          {message.pending && <span className="msg-status">Sending…</span>}
          {message.failed && <span className="msg-status msg-status--error">Failed</span>}
          {!message.pending && !message.failed && message.acknowledged && !message.awaitingResponse && (
            <span className="msg-status msg-status--delivered">Delivered</span>
          )}
          {!message.pending && !message.failed && !message.acknowledged && (
            <span className="msg-status msg-status--sent">Sent</span>
          )}
        </div>
      </div>
    )
  }

  const actions = message.content_type === "actions" && Array.isArray(message.metadata?.actions)
    ? message.metadata.actions
    : []

  const botAvatarSvg = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="11" r="1.25" fill="currentColor"/><circle cx="15" cy="11" r="1.25" fill="currentColor"/></svg>
  )

  return (
    <div className="msg msg--bot">
      <div className="msg-avatar">{botAvatarSvg}</div>
      <div className="msg-content">
        {message.body && (
          <div className="msg-bubble msg-bubble--bot">
            <div className="msg-text msg-text--markdown" dangerouslySetInnerHTML={{ __html: botBodyHtml }} />
            {message.model && <span className="msg-model">{message.model}</span>}
          </div>
        )}
        {message.content_type === "image" && message.metadata?.url && (
          <div className="msg-bubble msg-bubble--bot">
            <img src={message.metadata.url} alt="Bot shared image" className="msg-image" />
          </div>
        )}
        {message.content_type === "file" && message.metadata?.url && (
          <div className="msg-bubble msg-bubble--bot">
            <div className="msg-file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 2v7h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <a href={message.metadata.url} download={message.metadata.filename} className="msg-file-link">
                {message.metadata.filename || "File"}
              </a>
            </div>
          </div>
        )}
        {actions.length > 0 && (
          <div className="msg-suggestions">
            {actions.map((action, i) => {
              const label = typeof action === "string" ? action : action.label
              const value = typeof action === "string" ? action : (action.value ?? action.label)
              const isUsed = usedSuggestion === value
              const isDisabled = usedSuggestion !== undefined

              return (
                <button
                  key={i}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && onSuggestion && onSuggestion(value)}
                  className={[
                    "suggestion-chip",
                    isUsed ? "suggestion-chip--used" : "",
                    isDisabled && !isUsed ? "suggestion-chip--dismissed" : "",
                  ].filter(Boolean).join(" ")}
                  aria-pressed={isUsed}
                >
                  {isUsed && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                  {label}
                  {isUsed && <span className="suggestion-chip__sent">Sent</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


/* ───────── Chat View ───────── */
function ChatView({ token, bot, conversations, selectedConversationId, onSelectConversation, onCreateConversation, models, onRefreshModels, onBotStatusChange, onToggleSidebar }) {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [thinkingTone, setThinkingTone] = useState("witty")
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
          const incoming = payload.message

          setMessages((prev) => {
            if (renderedIdsRef.current.has(incoming.id)) return prev
            renderedIdsRef.current.add(incoming.id)

            // Reconcile optimistic user messages when the server echo arrives first.
            const optimisticIndex = prev.findIndex(
              (m) => m.pending && m.role === incoming.role && m.body === incoming.body
            )

            if (optimisticIndex !== -1) {
              const next = [...prev]
              next[optimisticIndex] = {
                ...incoming,
                pending: false,
                failed: false,
                acknowledged: next[optimisticIndex].acknowledged || incoming.acknowledged || false,
              }
              return next
            }

            return [...prev, incoming]
          })

          if (incoming.role !== "user") {
            stopBotThinking()
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "user" && m.awaitingResponse ? { ...m, awaitingResponse: false } : m
              )
            )
          }

          showNotificationIfBackgrounded(payload.message)
        })

        ch.on("message_acknowledged", (payload) => {
          if (!payload?.message_id) return

          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.message_id ? { ...m, acknowledged: true, awaitingResponse: true } : m
            )
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
    stopBotThinking()
    setUsedSuggestions({})

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

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch(
        `/api/conversations/${selectedConversationId}/assets`,
        {
          method: "POST",
          body: formData,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      const data = await response.json()
      return data
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

      const res = await apiRequest(
        `/api/conversations/${selectedConversationId}/messages`,
        { method: "POST", body: payload, token }
      )

      setMessages((prev) => {
        const deliveredAlreadyPresent = prev.some((m) => m.id === res.id && !m.pending)
        if (deliveredAlreadyPresent) {
          return prev.filter((m) => m.id !== optimisticId)
        }
        return prev.map((m) =>
          m.id === optimisticId
            ? { ...res, pending: false, failed: false, acknowledged: m.acknowledged || false, fromSuggestion: m.fromSuggestion }
            : m
        )
      })
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

      const res = await apiRequest(
        `/api/conversations/${selectedConversationId}/messages`,
        { method: "POST", body: payload, token }
      )

      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...res, pending: false, failed: false, acknowledged: m.acknowledged || false }
            : m
        )
      )
      renderedIdsRef.current.add(res.id)
      setSelectedFile(null)
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, pending: false, failed: true } : m
        )
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
          <select
            className="model-picker thinking-tone-picker"
            value={thinkingTone}
            onChange={(e) => setThinkingTone(e.target.value)}
            aria-label="Thinking style"
          >
            {THINKING_TONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
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
          <MessageBubble
            key={msg.id}
            message={msg}
            onSuggestion={(value) => handleSuggestion(msg.id, value)}
            usedSuggestion={usedSuggestions[msg.id]}
          />
        ))}
        {botIsTyping && <TypingIndicator tone={thinkingTone} />}
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>
        )}
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
              <input
                type="file"
                id="file-input"
                className="file-input"
                onChange={handleFileSelect}
                accept="image/*,.pdf"
                aria-label="Upload file"
              />
              <label htmlFor="file-input" className="file-input-btn" title="Attach file">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </label>
              <select
                className="model-picker"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                aria-label="Model"
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.3"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                  <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
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
