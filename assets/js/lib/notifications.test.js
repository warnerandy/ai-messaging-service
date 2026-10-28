import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	shouldNotify,
	showNativeNotification,
	notifyBotResponse,
	notifySessionCompleted,
	notifyWaitingForInput,
	requestNotificationPermission,
	getNotificationPermission,
	isNotificationSupported,
	initNotificationListeners,
	showNotificationIfBackgrounded,
	isSessionAlarmEnabled,
	setSessionAlarmEnabled,
	toggleSessionAlarm,
	getSessionAlarms,
	unlockAudio,
	playConfirmationPing,
	playAlarmChime,
	triggerAlarmVibration,
	triggerConfirmationVibration,
	isVibrationSupported,
	getChimeDataUri,
	clearRecentNotifications,
	testNativeNotification,
} from "./notifications.js"

describe("notifications module", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Notification.permission = "granted"
		localStorage.clear()
		clearRecentNotifications()
	})

	describe("isNotificationSupported & getNotificationPermission", () => {
		it("detects notification support", () => {
			expect(isNotificationSupported()).toBe(true)
			expect(getNotificationPermission()).toBe("granted")
		})

		it("requests permission when default", async () => {
			Notification.permission = "default"
			const perm = await requestNotificationPermission()
			expect(Notification.requestPermission).toHaveBeenCalled()
			expect(perm).toBe("granted")
		})
	})

	describe("session alarm state management", () => {
		it("returns false by default for any conversation", () => {
			expect(isSessionAlarmEnabled(101)).toBe(false)
			expect(isSessionAlarmEnabled(null)).toBe(false)
		})

		it("enables and remembers alarm for a specific session", () => {
			setSessionAlarmEnabled(101, true)
			expect(isSessionAlarmEnabled(101)).toBe(true)
			expect(isSessionAlarmEnabled(102)).toBe(false)

			// Persists in localStorage
			const all = getSessionAlarms()
			expect(all["101"]).toBe(true)
			expect(all["102"]).toBeUndefined()
		})

		it("remembers different alarm states across multiple sessions", () => {
			setSessionAlarmEnabled(101, true)
			setSessionAlarmEnabled(102, false)
			setSessionAlarmEnabled(103, true)

			expect(isSessionAlarmEnabled(101)).toBe(true)
			expect(isSessionAlarmEnabled(102)).toBe(false)
			expect(isSessionAlarmEnabled(103)).toBe(true)
		})

		it("toggles session alarm state", () => {
			expect(toggleSessionAlarm(200)).toBe(true)
			expect(isSessionAlarmEnabled(200)).toBe(true)

			expect(toggleSessionAlarm(200)).toBe(false)
			expect(isSessionAlarmEnabled(200)).toBe(false)
		})

		it("dispatches session-alarm-changed event when updated", () => {
			const listener = vi.fn()
			window.addEventListener("session-alarm-changed", listener)

			setSessionAlarmEnabled(305, true)
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					detail: { conversationId: 305, enabled: true },
				}),
			)

			window.removeEventListener("session-alarm-changed", listener)
		})
	})

	describe("audio and vibration sensory triggers", () => {
		it("unlocks audio without throwing", () => {
			const ctx = unlockAudio()
			expect(ctx).toBeDefined()
		})

		it("plays confirmation ping and chime without error", () => {
			expect(() => playConfirmationPing()).not.toThrow()
			expect(() => playAlarmChime()).not.toThrow()
			expect(getChimeDataUri()).toMatch(/^data:audio\/wav;base64,/)
		})

		it("triggers vibration if supported", () => {
			expect(isVibrationSupported()).toBe(true)
			const confOk = triggerConfirmationVibration()
			expect(confOk).toBe(true)
			expect(navigator.vibrate).toHaveBeenCalledWith([60])

			const alarmOk = triggerAlarmVibration()
			expect(alarmOk).toBe(true)
			expect(navigator.vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 300])
		})
	})

	describe("shouldNotify", () => {
		it("returns true if force is true", () => {
			expect(shouldNotify({ force: true })).toBe(true)
		})

		it("returns true when document is hidden", () => {
			Object.defineProperty(document, "hidden", { value: true, configurable: true })
			expect(shouldNotify({ conversationId: 1, activeConversationId: 1 })).toBe(true)
		})

		it("returns true when document does not have focus", () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(false)
			expect(shouldNotify({ conversationId: 1, activeConversationId: 1 })).toBe(true)
			hasFocusSpy.mockRestore()
		})

		it("returns true when viewing a different conversation", () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
			expect(shouldNotify({ conversationId: 2, activeConversationId: 1 })).toBe(true)
			hasFocusSpy.mockRestore()
		})

		it("returns false when user is focused on the active conversation", () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
			expect(shouldNotify({ conversationId: 1, activeConversationId: 1 })).toBe(false)
			hasFocusSpy.mockRestore()
		})
	})

	describe("notifyBotResponse", () => {
		it("triggers native notification when bot responds and tab is backgrounded", async () => {
			Object.defineProperty(document, "hidden", { value: true, configurable: true })
			Notification.instances = []

			await notifyBotResponse({
				botName: "Atlas",
				conversationTitle: "General Chat",
				conversationId: 42,
				activeConversationId: 42,
				message: { role: "bot", body: "Hello, world!" },
			})

			expect(Notification.instances.length).toBe(1)
			const instance = Notification.instances[0]
			expect(instance.title).toBe("Atlas (General Chat)")
			expect(instance.options.body).toBe("Hello, world!")
			expect(instance.options.tag).toBe("bot-resp-42")
		})

		it("forces notification, chime, and vibration when session alarm is armed even if focused", async () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
			Notification.instances = []

			setSessionAlarmEnabled(42, true)

			const alarmListener = vi.fn()
			window.addEventListener("session-alarm-fired", alarmListener)

			await notifyBotResponse({
				botName: "Atlas",
				conversationId: 42,
				activeConversationId: 42,
				message: { role: "bot", body: "Important answer" },
			})

			expect(Notification.instances.length).toBe(1)
			expect(navigator.vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 300])
			expect(alarmListener).toHaveBeenCalledWith(
				expect.objectContaining({
					detail: expect.objectContaining({ conversationId: 42, type: "bot_response" }),
				}),
			)

			window.removeEventListener("session-alarm-fired", alarmListener)
			hasFocusSpy.mockRestore()
		})

		it("does not trigger when focused on active conversation and alarm is not armed", async () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
			Notification.instances = []

			await notifyBotResponse({
				botName: "Atlas",
				conversationId: 42,
				activeConversationId: 42,
				message: { role: "bot", body: "Hello" },
			})

			expect(Notification.instances.length).toBe(0)
			hasFocusSpy.mockRestore()
		})
	})

	describe("notifySessionCompleted", () => {
		it("triggers native notification when an active session completes", async () => {
			Object.defineProperty(document, "hidden", { value: true, configurable: true })
			Notification.instances = []

			await notifySessionCompleted({
				botName: "Claude Code",
				conversationTitle: "Refactor Database Models",
				conversationId: 101,
				activeConversationId: 101,
				metadata: { step: "Finished all database migrations" },
			})

			expect(Notification.instances.length).toBe(1)
			const instance = Notification.instances[0]
			expect(instance.title).toBe("Refactor Database Models: Session completed")
			expect(instance.options.body).toBe("Finished all database migrations")
			expect(instance.options.tag).toBe("session-comp-101")
		})

		it("triggers alarm alert when session alarm is armed", async () => {
			Object.defineProperty(document, "hidden", { value: false, configurable: true })
			const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
			Notification.instances = []

			setSessionAlarmEnabled(101, true)

			await notifySessionCompleted({
				botName: "Claude Code",
				conversationTitle: "Deploy Pipeline",
				conversationId: 101,
				activeConversationId: 101,
				metadata: { step: "Build and test completed successfully" },
			})

			expect(Notification.instances.length).toBe(1)
			expect(navigator.vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 300])
			hasFocusSpy.mockRestore()
		})
	})

	describe("notifyWaitingForInput", () => {
		it("triggers native notification when AHP agent wants info / approval", async () => {
			Object.defineProperty(document, "hidden", { value: true, configurable: true })
			Notification.instances = []

			await notifyWaitingForInput({
				botName: "AHP Worker",
				conversationTitle: "Feature Deploy",
				conversationId: 202,
				activeConversationId: 202,
				question: {
					title: "Allow push to remote?",
					prompt: "Do you want to allow pushing branch feature/deploy to origin?",
				},
			})

			expect(Notification.instances.length).toBe(1)
			const instance = Notification.instances[0]
			expect(instance.title).toBe("Feature Deploy: Input required")
			expect(instance.options.body).toBe(
				"Do you want to allow pushing branch feature/deploy to origin?",
			)
			expect(instance.options.requireInteraction).toBe(true)
		})
	})

	describe("notification click and navigation listener", () => {
		it("dispatches notification-select-conversation event on click", async () => {
			Object.defineProperty(document, "hidden", { value: true, configurable: true })
			Notification.instances = []

			const onSelect = vi.fn()
			const cleanup = initNotificationListeners(onSelect)

			await notifyWaitingForInput({
				botName: "Worker",
				conversationId: 777,
				question: { prompt: "Need info" },
			})

			const instance = Notification.instances[0]
			expect(instance).toBeDefined()
			instance.onclick?.()

			expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 777 }))
			cleanup()
		})
	})

	describe("testNativeNotification", () => {
		it("sends native test notification when permission is granted", async () => {
			Notification.permission = "granted"
			Notification.instances = []

			const result = await testNativeNotification()
			expect(result.ok).toBe(true)
			expect(result.permission).toBe("granted")
			expect(Notification.instances.length).toBe(1)
			expect(Notification.instances[0].title).toBe("Botamus Prime Notification Test")
		})

		it("requests permission when default and proceeds if granted", async () => {
			Notification.permission = "default"
			Notification.instances = []
			Notification.requestPermission.mockImplementation(async (cb) => {
				Notification.permission = "granted"
				cb && cb("granted")
				return "granted"
			})

			const result = await testNativeNotification()
			expect(result.ok).toBe(true)
			expect(Notification.requestPermission).toHaveBeenCalled()
			expect(Notification.instances.length).toBe(1)
		})

		it("returns denied if permission is denied", async () => {
			Notification.permission = "denied"
			Notification.instances = []

			const result = await testNativeNotification()
			expect(result.ok).toBe(false)
			expect(result.reason).toBe("denied")
			expect(Notification.instances.length).toBe(0)
		})
	})
})
