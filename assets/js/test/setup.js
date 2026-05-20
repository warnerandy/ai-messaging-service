import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
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
