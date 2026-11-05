import { readFileSync } from "node:fs"
import { URL as NodeURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"

const html = readFileSync(
	new NodeURL("../../../crates/aims-proxy/src/admin.html", import.meta.url),
	"utf8",
)
const script = readFileSync(
	new NodeURL("../../../crates/aims-proxy/src/admin.js", import.meta.url),
	"utf8",
)

const snapshot = (supported = true) => ({
	connected: true,
	archive_supported: supported,
	sessions: {
		done: { id: "done", title: "Finished task", status: "completed", completed: true },
		idle: { id: "idle", title: "Unconfirmed task", status: "idle", completed: false },
		running: { id: "running", title: "Active task", status: "running", completed: false },
	},
})

async function load(data = snapshot()) {
	const fetch = vi.fn(async (_url, options) => ({
		ok: true,
		json: async () =>
			options?.method === "POST"
				? { archived_session_ids: ["done"], failed_session_ids: [] }
				: data,
	}))
	vi.stubGlobal("fetch", fetch)
	new Function(script)()
	await waitFor(() => expect(document.querySelectorAll("#sessions tr")).toHaveLength(3))
	return fetch
}

describe("proxy administration dashboard", () => {
	beforeEach(() => {
		document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		vi.spyOn(globalThis, "setInterval").mockReturnValue(0)
		const dialog = document.getElementById("confirm")
		dialog.showModal = () => dialog.setAttribute("open", "")
		dialog.close = () => dialog.removeAttribute("open")
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		document.body.innerHTML = ""
	})

	it("requires review and confirmation and only selects completed resources", async () => {
		const fetch = await load()
		document.getElementById("select-completed").click()
		expect(document.getElementById("selection")).toHaveTextContent("1 selected")
		document.getElementById("archive").click()
		expect(document.getElementById("confirm")).toHaveAttribute("open")
		expect(document.getElementById("confirm-titles")).toHaveTextContent("Finished task")
		expect(document.getElementById("confirm-titles")).not.toHaveTextContent("Unconfirmed task")
		expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0)
		document.getElementById("cancel").click()
		expect(document.getElementById("confirm")).not.toHaveAttribute("open")
		document.getElementById("archive").click()
		document.getElementById("confirm-archive").click()
		await waitFor(() =>
			expect(document.getElementById("feedback")).toHaveTextContent("1 archived in AIMS."),
		)
		expect(fetch).toHaveBeenCalledWith(
			"/api/archive",
			expect.objectContaining({ body: JSON.stringify({ ids: ["done"] }), method: "POST" }),
		)
	})

	it("disables archiving when the AIMS server lacks archive support", async () => {
		await load(snapshot(false))
		document.getElementById("select-completed").click()
		expect(document.getElementById("archive")).toBeDisabled()
		expect(document.getElementById("resync")).not.toBeDisabled()
		expect(document.getElementById("feedback")).toHaveTextContent("Deploy the updated aims-server")
	})

	it("labels and filters confirmed subagents without selecting them for bulk archive", async () => {
		const data = snapshot()
		data.sessions.idle = {
			id: "idle",
			title: "Worker task",
			status: "completed",
			completed: true,
			is_subagent: true,
			hidden_in_aims: true,
		}
		await load(data)
		expect(document.getElementById("subagents")).toHaveTextContent("1 confirmed subagents")
		expect(document.getElementById("sessions")).toHaveTextContent("Hidden in AIMS")
		document.getElementById("select-completed").click()
		expect(document.getElementById("selection")).toHaveTextContent("1 selected")
		document.getElementById("filter").value = "subagents"
		document.getElementById("filter").dispatchEvent(new Event("change"))
		expect(document.querySelectorAll("#sessions tr")).toHaveLength(1)
		expect(document.getElementById("sessions")).toHaveTextContent("Worker task")
	})
})
