import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	if (
		typeof globalThis.localStorage !== "undefined" &&
		typeof globalThis.localStorage.clear === "function"
	) {
		globalThis.localStorage.clear()
	}
})

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
	value: vi.fn(),
	writable: true,
})

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
}

Object.defineProperty(URL, "createObjectURL", {
	value: vi.fn(() => "blob:mock"),
	writable: true,
})

const createStorage = () => {
	let store = {}
	return {
		getItem: vi.fn((key) => store[key] ?? null),
		setItem: vi.fn((key, value) => {
			store[key] = String(value)
		}),
		removeItem: vi.fn((key) => {
			delete store[key]
		}),
		clear: vi.fn(() => {
			store = {}
		}),
		key: vi.fn((i) => Object.keys(store)[i] ?? null),
		get length() {
			return Object.keys(store).length
		},
	}
}
const storage = createStorage()
try {
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		writable: true,
		configurable: true,
	})
	if (typeof window !== "undefined") {
		Object.defineProperty(window, "localStorage", {
			value: storage,
			writable: true,
			configurable: true,
		})
	}
} catch (e) {}

if (typeof navigator !== "undefined") {
	if (!navigator.clipboard || !navigator.clipboard.writeText) {
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: vi.fn().mockResolvedValue(undefined),
				readText: vi.fn().mockResolvedValue(""),
			},
			writable: true,
			configurable: true,
		})
	}
}

if (typeof globalThis.Notification === "undefined") {
	class MockNotification {
		static permission = "default"
		static requestPermission = vi.fn().mockResolvedValue("granted")
		static instances = []
		constructor(title, options = {}) {
			this.title = title
			this.options = options
			this.onclick = null
			this.close = vi.fn()
			MockNotification.instances.push(this)
		}
	}
	Object.defineProperty(globalThis, "Notification", {
		value: MockNotification,
		writable: true,
		configurable: true,
	})
	if (typeof window !== "undefined") {
		Object.defineProperty(window, "Notification", {
			value: MockNotification,
			writable: true,
			configurable: true,
		})
	}
}

if (typeof navigator !== "undefined" && !navigator.vibrate) {
	navigator.vibrate = vi.fn().mockReturnValue(true)
}

if (typeof window !== "undefined" && !window.AudioContext && !window.webkitAudioContext) {
	class MockAudioContext {
		currentTime = 0
		state = "running"
		createOscillator() {
			return {
				type: "sine",
				frequency: { setValueAtTime: vi.fn() },
				connect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
			}
		}
		createGain() {
			return {
				gain: {
					setValueAtTime: vi.fn(),
					linearRampToValueAtTime: vi.fn(),
					exponentialRampToValueAtTime: vi.fn(),
				},
				connect: vi.fn(),
			}
		}
		resume() {
			return Promise.resolve()
		}
		destination = {}
	}
	window.AudioContext = MockAudioContext
	window.webkitAudioContext = MockAudioContext
}
