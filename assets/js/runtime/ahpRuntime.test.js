import { describe, expect, it, vi } from "vitest"
import {
	extractClipboardFiles,
	normalizePastedFile,
	createAhpAttachmentAdapter,
	convertToAhpAssistantMessage,
} from "./ahpRuntime.js"

describe("ahpRuntime", () => {
	describe("normalizePastedFile & extractClipboardFiles", () => {
		it("extracts pasted image files from clipboardData.items (mobile & desktop)", () => {
			const blob = new Blob(["fake-image-bytes"], { type: "image/png" })
			const mockClipboardEvent = {
				clipboardData: {
					items: [
						{
							kind: "string",
							type: "text/plain",
							getAsFile: () => null,
						},
						{
							kind: "file",
							type: "image/png",
							getAsFile: () => blob,
						},
					],
					files: [],
				},
			}

			const files = extractClipboardFiles(mockClipboardEvent)
			expect(files).toHaveLength(1)
			expect(files[0].type).toBe("image/png")
			expect(files[0].name).toMatch(/^pasted-image-.*\.png$/)
		})

		it("falls back to clipboardData.files when items is empty", () => {
			const namedFile = new File(["pdf-bytes"], "architecture.pdf", {
				type: "application/pdf",
			})
			const mockClipboardEvent = {
				clipboardData: {
					items: [],
					files: [namedFile],
				},
			}

			const files = extractClipboardFiles(mockClipboardEvent)
			expect(files).toHaveLength(1)
			expect(files[0].name).toBe("architecture.pdf")
			expect(files[0].type).toBe("application/pdf")
		})

		it("normalizes generic image.png names from mobile clipboards into unique timestamped filenames", () => {
			const mobileFile = new File(["png-data"], "image.png", { type: "image/png" })
			const normalized = normalizePastedFile(mobileFile, 0)
			expect(normalized.name).toMatch(/^pasted-image-.*\.png$/)
			expect(normalized.type).toBe("image/png")
		})
	})

	describe("createAhpAttachmentAdapter", () => {
		it("stages and completes image attachments with inline data URL and optional upload callback", async () => {
			const uploadAsset = vi.fn().mockResolvedValue({
				url: "/uploads/42/mobile-screenshot.png?token=sig",
			})
			const adapter = createAhpAttachmentAdapter({ uploadAsset })
			const imageFile = new File(["hello-image"], "mobile-screenshot.png", {
				type: "image/png",
			})

			const pending = await adapter.add({ file: imageFile })
			expect(pending.type).toBe("image")
			expect(pending.name).toBe("mobile-screenshot.png")
			expect(pending.status.type).toBe("requires-action")

			const completed = await adapter.send(pending)
			expect(uploadAsset).toHaveBeenCalledWith(imageFile)
			expect(completed.status.type).toBe("complete")
			expect(completed.remoteUrl).toBe("/uploads/42/mobile-screenshot.png?token=sig")
			expect(completed.content[0].type).toBe("image")
		})
	})

	describe("convertToAhpAssistantMessage", () => {
		it("converts user messages with pasted image attachments and bot messages with reasoning & tool calls", () => {
			const userMsg = convertToAhpAssistantMessage({
				id: 101,
				role: "user",
				body: "Here is a screenshot from my phone",
				metadata: {
					attachments: [
						{
							name: "pasted-image.png",
							type: "image/png",
							data_url: "data:image/png;base64,AAA=",
						},
					],
				},
			})
			expect(userMsg.role).toBe("user")
			expect(userMsg.attachments).toHaveLength(1)
			expect(userMsg.content.some((p) => p.type === "image")).toBe(true)

			const botMsg = convertToAhpAssistantMessage({
				id: 102,
				role: "bot",
				body: "I inspected the mobile screenshot and fixed the layout.",
				metadata: {
					thinking: "Analyzing mobile viewport flexbox constraints...",
					tool_calls: [
						{
							id: "tc-1",
							name: "edit_file",
							args: { path: "src/App.jsx" },
							result: { ok: true },
						},
					],
				},
			})
			expect(botMsg.role).toBe("assistant")
			expect(botMsg.content[0]).toEqual({
				type: "reasoning",
				text: "Analyzing mobile viewport flexbox constraints...",
			})
			expect(botMsg.content[1].type).toBe("tool-call")
			expect(botMsg.content[1].toolName).toBe("edit_file")
			expect(botMsg.content[2]).toEqual({
				type: "text",
				text: "I inspected the mobile screenshot and fixed the layout.",
			})
		})
	})
})
