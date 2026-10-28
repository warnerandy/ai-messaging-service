// Native Web Notifications, PWA, Service Worker, and Session Alarm integration
const recentNotifications = new Map()
const DEDUPE_WINDOW_MS = 2000

export const SESSION_ALARMS_STORAGE_KEY = "messaging.session_alarms"

/* ───────── Session Alarm State Management ───────── */

export function getSessionAlarms() {
	if (typeof window === "undefined" || !window.localStorage) return {}
	try {
		const raw = localStorage.getItem(SESSION_ALARMS_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

export function isSessionAlarmEnabled(conversationId) {
	if (conversationId == null) return false
	const alarms = getSessionAlarms()
	return !!alarms[String(conversationId)]
}

export function setSessionAlarmEnabled(conversationId, enabled) {
	if (conversationId == null || typeof window === "undefined" || !window.localStorage) {
		return false
	}
	try {
		const alarms = getSessionAlarms()
		if (enabled) {
			alarms[String(conversationId)] = true
		} else {
			delete alarms[String(conversationId)]
		}
		localStorage.setItem(SESSION_ALARMS_STORAGE_KEY, JSON.stringify(alarms))
		window.dispatchEvent(
			new CustomEvent("session-alarm-changed", {
				detail: { conversationId: Number(conversationId) || conversationId, enabled: !!enabled },
			}),
		)
		return !!enabled
	} catch {
		return false
	}
}

export function toggleSessionAlarm(conversationId) {
	const current = isSessionAlarmEnabled(conversationId)
	return setSessionAlarmEnabled(conversationId, !current)
}

/* ───────── Web Audio & Sensory Alarm (iOS / Mobile / Desktop) ───────── */

let audioCtx = null
let cachedChimeDataUri = null
let chimeAudio = null

export function getChimeDataUri() {
	if (cachedChimeDataUri) return cachedChimeDataUri
	try {
		const sampleRate = 22050
		const duration = 0.65
		const numSamples = Math.floor(sampleRate * duration)
		const dataSize = numSamples * 2
		const buffer = new ArrayBuffer(44 + dataSize)
		const view = new DataView(buffer)

		function writeString(offset, string) {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i))
			}
		}

		writeString(0, "RIFF")
		view.setUint32(4, 36 + dataSize, true)
		writeString(8, "WAVE")
		writeString(12, "fmt ")
		view.setUint32(16, 16, true)
		view.setUint16(20, 1, true)
		view.setUint16(22, 1, true)
		view.setUint32(24, sampleRate, true)
		view.setUint32(28, sampleRate * 2, true)
		view.setUint16(32, 2, true)
		view.setUint16(34, 16, true)
		writeString(36, "data")
		view.setUint32(40, dataSize, true)

		let offset = 44
		for (let i = 0; i < numSamples; i++) {
			const t = i / sampleRate
			let sample = 0

			// Tone 1: D5 (587.33 Hz) decaying
			if (t < 0.35) {
				const env1 = Math.exp(-t * 9)
				const tone1 = Math.sin(2 * Math.PI * 587.33 * t) + 0.3 * Math.sin(2 * Math.PI * 1174.66 * t)
				sample += tone1 * env1 * 0.45
			}

			// Tone 2: A5 (880 Hz) decaying, overlapping
			if (t >= 0.12) {
				const t2 = t - 0.12
				const env2 = Math.exp(-t2 * 7)
				const tone2 = Math.sin(2 * Math.PI * 880 * t2) + 0.25 * Math.sin(2 * Math.PI * 1760 * t2)
				sample += tone2 * env2 * 0.55
			}

			sample = Math.max(-1, Math.min(1, sample))
			const int16 = sample < 0 ? sample * 32768 : sample * 32767
			view.setInt16(offset, int16, true)
			offset += 2
		}

		let binary = ""
		const bytes = new Uint8Array(buffer)
		const len = bytes.byteLength
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(bytes[i])
		}
		const base64 =
			typeof window !== "undefined" && typeof window.btoa === "function"
				? window.btoa(binary)
				: typeof Buffer !== "undefined"
					? Buffer.from(binary, "binary").toString("base64")
					: ""
		cachedChimeDataUri = `data:audio/wav;base64,${base64}`
		return cachedChimeDataUri
	} catch {
		return null
	}
}

export function getChimeAudio() {
	if (typeof window === "undefined") return null
	if (!chimeAudio) {
		try {
			const uri = getChimeDataUri()
			if (uri && typeof Audio !== "undefined") {
				chimeAudio = new Audio(uri)
				chimeAudio.volume = 0.85
				chimeAudio.preload = "auto"
			}
		} catch {
			chimeAudio = null
		}
	}
	return chimeAudio
}

export function unlockAudio() {
	if (typeof window === "undefined") return null
	try {
		const AudioContextClass = window.AudioContext || window.webkitAudioContext
		if (!AudioContextClass) return null
		if (!audioCtx || audioCtx.state === "closed") {
			audioCtx = new AudioContextClass()
		}
		if (audioCtx.state === "suspended") {
			audioCtx.resume().catch(() => {})
		}
		// Also preload/unlock the HTML5 audio element
		const audio = getChimeAudio()
		if (audio && audio.paused && typeof audio.load === "function") {
			try {
				audio.load()
			} catch {}
		}
		return audioCtx
	} catch {
		return null
	}
}

function playWebAudioChime(ctx) {
	if (!ctx) return
	try {
		if (ctx.state === "suspended") {
			ctx.resume().catch(() => {})
		}
		const start = Math.max((ctx.currentTime || 0) + 0.02, 0.02)

		// Tone 1: D5 (587.33 Hz)
		const osc1 = ctx.createOscillator()
		const gain1 = ctx.createGain()
		osc1.type = "triangle"
		osc1.frequency.setValueAtTime(587.33, start)
		gain1.gain.setValueAtTime(0.001, start)
		if (typeof gain1.gain.linearRampToValueAtTime === "function") {
			gain1.gain.linearRampToValueAtTime(0.28, start + 0.02)
		} else {
			gain1.gain.setValueAtTime(0.28, start + 0.02)
		}
		gain1.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
		osc1.connect(gain1)
		gain1.connect(ctx.destination)
		osc1.start(start)
		osc1.stop(start + 0.36)

		// Tone 2: A5 (880 Hz)
		const osc2 = ctx.createOscillator()
		const gain2 = ctx.createGain()
		osc2.type = "sine"
		osc2.frequency.setValueAtTime(880, start + 0.12)
		gain2.gain.setValueAtTime(0.001, start + 0.12)
		if (typeof gain2.gain.linearRampToValueAtTime === "function") {
			gain2.gain.linearRampToValueAtTime(0.32, start + 0.14)
		} else {
			gain2.gain.setValueAtTime(0.32, start + 0.14)
		}
		gain2.gain.exponentialRampToValueAtTime(0.001, start + 0.6)
		osc2.connect(gain2)
		gain2.connect(ctx.destination)
		osc2.start(start + 0.12)
		osc2.stop(start + 0.61)
	} catch {
		// Ignore audio errors
	}
}

export function playConfirmationPing() {
	if (typeof window === "undefined") return
	try {
		const ctx = unlockAudio()
		if (!ctx) return
		const now = Math.max((ctx.currentTime || 0) + 0.01, 0.01)
		const osc = ctx.createOscillator()
		const gain = ctx.createGain()
		osc.type = "sine"
		osc.frequency.setValueAtTime(880, now)
		gain.gain.setValueAtTime(0.12, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
		osc.connect(gain)
		gain.connect(ctx.destination)
		osc.start(now)
		osc.stop(now + 0.15)
	} catch {
		// Ignore audio errors
	}
}

export function playAlarmChime() {
	if (typeof window === "undefined") return

	// 1. First attempt: HTML5 Audio with pre-rendered WAV chime data URI
	// This works across iOS Safari, iOS PWA, Android, and all desktop browsers without Web Audio context restrictions.
	try {
		const audio = getChimeAudio()
		if (audio && typeof audio.play === "function") {
			audio.currentTime = 0
			const promise = audio.play()
			if (promise && typeof promise.catch === "function") {
				promise.catch(() => {
					// Fallback to Web Audio if audio.play() fails
					try {
						const ctx = unlockAudio()
						if (ctx) playWebAudioChime(ctx)
					} catch {}
				})
			}
		}
	} catch {}

	// 2. Also trigger Web Audio synthesizer if context is running or available
	try {
		const ctx = unlockAudio()
		if (ctx && ctx.state !== "closed") {
			playWebAudioChime(ctx)
		}
	} catch {
		// Ignore audio errors
	}
}

export function isVibrationSupported() {
	return typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
}

export function triggerAlarmVibration(pattern = [200, 100, 200, 100, 300]) {
	if (isVibrationSupported()) {
		try {
			const res = navigator.vibrate(pattern)
			return Boolean(res)
		} catch {
			return false
		}
	}
	return false
}

export function triggerConfirmationVibration() {
	if (isVibrationSupported()) {
		try {
			const res = navigator.vibrate([60])
			return Boolean(res)
		} catch {
			return false
		}
	}
	return false
}

export function dispatchSessionAlarmFired(detail) {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("session-alarm-fired", { detail }))
	}
}

/* ───────── Service Worker & Notification Setup ───────── */

export async function registerServiceWorker() {
	if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null
	try {
		const reg = await navigator.serviceWorker.register("/sw.js")
		if (reg && typeof reg.update === "function") {
			reg.update().catch(() => {})
		}
		return reg
	} catch (err) {
		console.warn("ServiceWorker registration failed:", err)
		return null
	}
}

export function initNotificationListeners(onSelectConversation) {
	if (typeof window === "undefined") return () => {}

	const handleCustomEvent = (event) => {
		const { conversationId, botId } = event.detail || {}
		if (onSelectConversation) {
			onSelectConversation({ conversationId, botId })
		}
	}

	window.addEventListener("notification-select-conversation", handleCustomEvent)

	let handleSwMessage = null
	if ("serviceWorker" in navigator) {
		handleSwMessage = (event) => {
			if (event.data?.type === "NOTIFICATION_CLICK" && event.data?.data) {
				const { conversationId, botId } = event.data.data
				if (onSelectConversation) {
					onSelectConversation({ conversationId, botId })
				}
			}
		}
		navigator.serviceWorker.addEventListener("message", handleSwMessage)
	}

	return () => {
		window.removeEventListener("notification-select-conversation", handleCustomEvent)
		if (handleSwMessage && "serviceWorker" in navigator) {
			navigator.serviceWorker.removeEventListener("message", handleSwMessage)
		}
	}
}

export function isNotificationSupported() {
	return typeof window !== "undefined" && "Notification" in window
}

export function getNotificationPermission() {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return "denied"
	}
	return Notification.permission
}

export async function requestNotificationPermission() {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return "denied"
	}
	if (Notification.permission === "default") {
		try {
			// Modern Promise-based API with callback fallback for older WebKit / Safari
			const permission = await new Promise((resolve) => {
				const result = Notification.requestPermission(resolve)
				if (result && typeof result.then === "function") {
					result.then(resolve)
				}
			})
			return permission || Notification.permission
		} catch {
			return Notification.permission
		}
	}
	return Notification.permission
}

export function shouldNotify({
	conversationId = null,
	activeConversationId = null,
	force = false,
} = {}) {
	if (force) return true
	if (typeof document === "undefined") return false

	const isBackgrounded =
		document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus())
	if (isBackgrounded) return true

	// If the user is viewing another conversation
	if (
		conversationId != null &&
		activeConversationId != null &&
		String(conversationId) !== String(activeConversationId)
	) {
		return true
	}

	return false
}

export function clearRecentNotifications() {
	recentNotifications.clear()
}

export async function showNativeNotification(title, options = {}) {
	if (typeof window === "undefined" || !("Notification" in window)) return null
	if (Notification.permission !== "granted") return null

	const dedupeKey = options.tag || `${title}:${options.body || ""}`
	const now = Date.now()
	const lastSent = recentNotifications.get(dedupeKey)
	if (!options.force && lastSent && now - lastSent < DEDUPE_WINDOW_MS) {
		return null
	}
	recentNotifications.set(dedupeKey, now)

	// Clean up entries older than 30s
	for (const [k, timestamp] of recentNotifications.entries()) {
		if (now - timestamp > 30000) {
			recentNotifications.delete(k)
		}
	}

	const notificationOptions = {
		icon: "/botamus-prime-192.png",
		badge: "/botamus-prime-192.png",
		requireInteraction: false,
		vibrate: [200, 100, 200],
		...options,
	}

	// 1. Try ServiceWorkerRegistration.showNotification if available (essential for mobile / iOS PWA)
	if ("serviceWorker" in navigator) {
		try {
			let reg = await navigator.serviceWorker.getRegistration()
			if (!reg && "ready" in navigator.serviceWorker) {
				reg = await navigator.serviceWorker.ready
			}
			if (reg && typeof reg.showNotification === "function") {
				await reg.showNotification(title, notificationOptions)
				return reg
			}
		} catch (err) {
			console.warn("ServiceWorker showNotification failed:", err)
		}
	}

	// 2. Fallback to native window.Notification constructor
	try {
		const notification = new Notification(title, notificationOptions)
		notification.onclick = (event) => {
			if (typeof window !== "undefined" && typeof window.focus === "function") {
				window.focus()
			}
			if (typeof options.onClick === "function") {
				options.onClick(event)
			}
			if (options.data && typeof window !== "undefined") {
				window.dispatchEvent(
					new CustomEvent("notification-select-conversation", { detail: options.data }),
				)
			}
			notification.close()
		}
		return notification
	} catch (err) {
		console.warn("Failed to create native notification:", err)
		return null
	}
}

/**
 * Dispatches an immediate test notification to verify native notifications
 */
export async function testNativeNotification() {
	if (!isNotificationSupported()) {
		return { ok: false, reason: "unsupported" }
	}

	let perm = getNotificationPermission()
	if (perm !== "granted") {
		perm = await requestNotificationPermission()
	}

	if (perm !== "granted") {
		return { ok: false, reason: "denied", permission: perm }
	}

	try {
		const notification = await showNativeNotification("Botamus Prime Notification Test", {
			body: "Native notifications are working properly on your device!",
			tag: `test-notification-${Date.now()}`,
			icon: "/botamus-prime-192.png",
			badge: "/botamus-prime-192.png",
			force: true,
			data: { test: true },
		})
		return { ok: true, permission: "granted", notification }
	} catch (err) {
		console.warn("Failed to dispatch test notification:", err)
		return { ok: false, reason: "error", error: err.message }
	}
}

/**
 * Native notification when a chat bot sends a response (waiting on user reply)
 */
export async function notifyBotResponse({
	botName = "Chat Bot",
	conversationTitle = null,
	conversationId = null,
	activeConversationId = null,
	message = {},
	force = false,
} = {}) {
	const isArmed = isSessionAlarmEnabled(conversationId)
	if (isArmed) {
		playAlarmChime()
		triggerAlarmVibration()
		dispatchSessionAlarmFired({
			conversationId,
			botName,
			title: conversationTitle,
			body: message?.body,
			type: "bot_response",
		})
	}

	if (!shouldNotify({ conversationId, activeConversationId, force: force || isArmed })) {
		return null
	}

	const rawBody = message?.body || "New response from bot"
	const body = rawBody.length > 140 ? `${rawBody.slice(0, 137)}...` : rawBody
	const title = conversationTitle ? `${botName} (${conversationTitle})` : `${botName}: New message`

	return showNativeNotification(title, {
		body,
		tag: conversationId ? `bot-resp-${conversationId}` : "bot-message",
		force: force || isArmed,
		data: {
			conversationId,
			type: "bot_response",
		},
	})
}

/**
 * Native notification when an active session completes its turn (waiting on next user prompt)
 */
export async function notifySessionCompleted({
	botName = "Agent",
	conversationTitle = null,
	conversationId = null,
	activeConversationId = null,
	metadata = {},
	force = false,
} = {}) {
	const isArmed = isSessionAlarmEnabled(conversationId)
	if (isArmed) {
		playAlarmChime()
		triggerAlarmVibration()
		dispatchSessionAlarmFired({
			conversationId,
			botName,
			title: conversationTitle,
			type: "session_completed",
			metadata,
		})
	}

	if (!shouldNotify({ conversationId, activeConversationId, force: force || isArmed })) {
		return null
	}

	const stepText =
		metadata?.step ||
		metadata?.current_step ||
		metadata?.last_step ||
		"Active session completed and is waiting for your next instructions."
	const body = stepText.length > 140 ? `${stepText.slice(0, 137)}...` : stepText
	const title = conversationTitle
		? `${conversationTitle}: Session completed`
		: `${botName}: Session completed`

	return showNativeNotification(title, {
		body,
		tag: conversationId ? `session-comp-${conversationId}` : "session-completed",
		force: force || isArmed,
		data: {
			conversationId,
			type: "session_completed",
		},
	})
}

/**
 * Native notification when an active session wants info or approval in AHP mode
 */
export async function notifyWaitingForInput({
	botName = "AHP Agent",
	conversationTitle = null,
	conversationId = null,
	activeConversationId = null,
	question = null,
	metadata = {},
	force = false,
} = {}) {
	const isArmed = isSessionAlarmEnabled(conversationId)
	if (isArmed) {
		playAlarmChime()
		triggerAlarmVibration()
		dispatchSessionAlarmFired({
			conversationId,
			botName,
			title: conversationTitle,
			type: "waiting_for_input",
			question,
			metadata,
		})
	}

	if (!shouldNotify({ conversationId, activeConversationId, force: force || isArmed })) {
		return null
	}

	const q = question || metadata?.question || {}
	const promptText =
		q.prompt ||
		q.title ||
		metadata?.step ||
		"Agent is waiting for your approval or answer to continue."
	const body = promptText.length > 140 ? `${promptText.slice(0, 137)}...` : promptText
	const title = conversationTitle
		? `${conversationTitle}: Input required`
		: `${botName}: Input required`

	return showNativeNotification(title, {
		body,
		tag: conversationId ? `session-wait-${conversationId}` : "waiting-for-input",
		requireInteraction: true,
		force: force || isArmed,
		data: {
			conversationId,
			type: "waiting_for_input",
		},
	})
}

// Backward-compatible alias for existing imports
export async function showNotificationIfBackgrounded(message, context = {}) {
	if (message?.role !== "bot") return null
	return notifyBotResponse({
		message,
		...context,
	})
}
