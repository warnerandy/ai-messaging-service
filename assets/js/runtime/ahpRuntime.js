/**
 * @assistant-ui/react Runtime & Mobile Clipboard Image Attachment Architecture for AHP.
 *
 * Implements the AssistantRuntime / ExternalStoreAdapter / AttachmentAdapter / ThreadListAdapter
 * contracts from https://www.assistant-ui.com/docs/runtimes/concepts/architecture
 * and maps them to Agent Host Protocol (AHP) sessions, turns, tool calls, reasoning, and
 * embedded/resource image attachments.
 */

import { useMemo, useCallback } from "react"
import { useExternalStoreRuntime } from "@assistant-ui/react"

export const AHP_ACCEPTED_ATTACHMENT_TYPES =
	"image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.txt,.json,.csv"

/**
 * Read a File or Blob as a base64 Data URL for zero-latency mobile preview and
 * AHP `MessageEmbeddedResourceAttachment` (`data` + `contentType`) wire transport.
 */
export function readFileAsDataUrl(file) {
	return new Promise((resolve) => {
		if (!file || typeof FileReader === "undefined") {
			resolve(null)
			return
		}
		const reader = new FileReader()
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
		reader.onerror = () => resolve(null)
		try {
			reader.readAsDataURL(file)
		} catch {
			resolve(null)
		}
	})
}

/**
 * Normalize a pasted or selected File with a descriptive filename when pasted from
 * a mobile clipboard (iOS Safari, Android Chrome/Gboard, or desktop screenshot).
 */
export function normalizePastedFile(file, index = 0) {
	if (!file) return null
	const rawName = file.name || ""
	const isGenericPasteName =
		!rawName || /^image(\.[a-z0-9]+)?$/i.test(rawName) || /^blob(\.[a-z0-9]+)?$/i.test(rawName)

	if (!isGenericPasteName) {
		return file
	}

	const mime = file.type || "image/png"
	const ext = mime.includes("/") ? mime.split("/")[1].split(";")[0].replace("jpeg", "jpg") : "png"
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
	const suffix = index > 0 ? `-${index + 1}` : ""
	const nextName = `pasted-image-${timestamp}${suffix}.${ext || "png"}`

	try {
		return new File([file], nextName, {
			type: mime,
			lastModified: file.lastModified || Date.now(),
		})
	} catch {
		return file
	}
}

/**
 * Extract image and asset files from a ClipboardEvent's `clipboardData` across
 * mobile and desktop browsers (`clipboardData.items` and `clipboardData.files`).
 */
export function extractClipboardFiles(eventOrClipboardData) {
	if (!eventOrClipboardData) return []
	const clipboardData =
		eventOrClipboardData.clipboardData ||
		eventOrClipboardData.nativeEvent?.clipboardData ||
		eventOrClipboardData
	if (!clipboardData) return []
	const extracted = []
	const seenKeys = new Set()

	if (clipboardData.items && clipboardData.items.length > 0) {
		for (let i = 0; i < clipboardData.items.length; i += 1) {
			const item = clipboardData.items[i]
			if (item && (item.kind === "file" || (item.type && item.type.startsWith("image/")))) {
				const file = typeof item.getAsFile === "function" ? item.getAsFile() : null
				if (file) {
					const key = `${file.name || "blob"}:${file.size}:${file.type}`
					seenKeys.add(key)
					extracted.push(normalizePastedFile(file, extracted.length))
				}
			}
		}
	}

	if (extracted.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
		for (let i = 0; i < clipboardData.files.length; i += 1) {
			const file = clipboardData.files[i]
			if (file) {
				const key = `${file.name || "blob"}:${file.size}:${file.type}`
				if (!seenKeys.has(key)) {
					seenKeys.add(key)
					extracted.push(normalizePastedFile(file, extracted.length))
				}
			}
		}
	}

	return extracted.filter(Boolean)
}

/**
 * Creates an `@assistant-ui/react` `AttachmentAdapter` for AHP image & file attachments.
 */
export function createAhpAttachmentAdapter({
	uploadAsset,
	onAttachmentAdded,
	onAttachmentRemoved,
} = {}) {
	return {
		accept: AHP_ACCEPTED_ATTACHMENT_TYPES,

		async add({ file }) {
			const normalized = normalizePastedFile(file)
			const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
			const isImage = Boolean(normalized?.type?.startsWith("image/"))
			const dataUrl = isImage ? await readFileAsDataUrl(normalized) : null
			const previewUrl =
				dataUrl ||
				(isImage && typeof URL !== "undefined" && URL.createObjectURL
					? URL.createObjectURL(normalized)
					: null)

			const attachmentItem = {
				id,
				file: normalized,
				name: normalized.name || "pasted-image.png",
				size: normalized.size || 0,
				type: normalized.type || "image/png",
				contentType: normalized.type || "image/png",
				previewUrl,
				dataUrl,
			}

			if (onAttachmentAdded) {
				onAttachmentAdded(attachmentItem)
			}

			return {
				id,
				type: isImage ? "image" : "document",
				name: attachmentItem.name,
				contentType: attachmentItem.contentType,
				file: normalized,
				content: isImage && previewUrl ? [{ type: "image", image: previewUrl }] : [],
				status: { type: "requires-action", reason: "composer-send" },
			}
		},

		async send(attachment) {
			let uploadedUrl = null
			if (uploadAsset && attachment.file) {
				try {
					const res = await uploadAsset(attachment.file)
					uploadedUrl = res?.url || null
				} catch {
					// Fallback to inline base64 dataUrl if upload fails
				}
			}
			const isImage = attachment.type === "image" || attachment.contentType?.startsWith("image/")
			const existingImage = attachment.content?.find((c) => c.type === "image")?.image
			const imageSrc = uploadedUrl || existingImage || null

			return {
				...attachment,
				remoteUrl: uploadedUrl || undefined,
				status: { type: "complete" },
				content:
					isImage && imageSrc ? [{ type: "image", image: imageSrc }] : attachment.content || [],
			}
		},

		async remove(attachment) {
			if (onAttachmentRemoved && attachment?.id) {
				onAttachmentRemoved(attachment.id)
			}
		},
	}
}

/**
 * Convert an AHP / database message record into an `@assistant-ui/react` `ThreadMessageLike`
 * object with support for reasoning (`ChainOfThought`), `tool-call` parts, `image` parts,
 * and `text` parts.
 */
export function convertToAhpAssistantMessage(msg) {
	const role = msg?.role === "user" ? "user" : msg?.role === "system" ? "system" : "assistant"
	const contentParts = []
	const meta = msg?.metadata || {}

	if (role === "assistant") {
		const thinking = meta.thinking || meta.thought || meta.reasoning || ""
		if (thinking) {
			contentParts.push({
				type: "reasoning",
				text: String(thinking),
			})
		}

		const rawTools = Array.isArray(meta.tool_calls)
			? meta.tool_calls
			: Array.isArray(meta.steps)
				? meta.steps
				: []
		rawTools.forEach((tc, idx) => {
			if (typeof tc === "string") {
				contentParts.push({
					type: "tool-call",
					toolCallId: `${msg.id || "msg"}-tc-${idx}`,
					toolName: tc,
					args: {},
					result: "Completed",
				})
			} else if (tc && typeof tc === "object") {
				contentParts.push({
					type: "tool-call",
					toolCallId: String(tc.id || `${msg.id || "msg"}-tc-${idx}`),
					toolName: String(tc.name || tc.tool || tc.tool_name || "tool"),
					args: tc.args && typeof tc.args === "object" ? tc.args : {},
					result: tc.result ?? tc.output ?? "Completed",
				})
			}
		})
	}

	const attachments = Array.isArray(meta.attachments) ? meta.attachments : []
	if (attachments.length > 0) {
		attachments.forEach((att) => {
			const imgUrl = att.url || att.previewUrl || att.data_url || att.dataUrl
			const isImg =
				(att.type || att.content_type || "").startsWith("image/") ||
				(typeof imgUrl === "string" &&
					(imgUrl.startsWith("data:image/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(imgUrl)))
			if (isImg && imgUrl) {
				contentParts.push({
					type: "image",
					image: imgUrl,
				})
			}
		})
	} else if (
		(msg?.content_type === "image" ||
			(meta.url && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(meta.url))) &&
		meta.url
	) {
		contentParts.push({
			type: "image",
			image: meta.url,
		})
	}

	if (msg?.body) {
		contentParts.push({
			type: "text",
			text: String(msg.body),
		})
	}

	if (contentParts.length === 0) {
		contentParts.push({ type: "text", text: "" })
	}

	return {
		id: String(msg?.id ?? `msg-${Date.now()}`),
		role,
		content: contentParts,
		attachments: attachments.length > 0 ? attachments : undefined,
		createdAt: msg?.inserted_at ? new Date(msg.inserted_at) : new Date(),
		status:
			role === "assistant"
				? msg?.pending
					? { type: "running" }
					: { type: "complete", reason: "stop" }
				: undefined,
	}
}

/**
 * React hook creating the `@assistant-ui/react` `AssistantRuntime` for the active AHP workspace and session.
 */
export function useAhpAssistantRuntime({
	isRunning = false,
	messages = [],
	conversations = [],
	selectedConversationId = null,
	onSelectConversation,
	onNewSession,
	onArchiveConversation,
	onSend,
	onStop,
	uploadAsset,
	onAttachmentAdded,
	onAttachmentRemoved,
}) {
	const attachmentAdapter = useMemo(
		() =>
			createAhpAttachmentAdapter({
				uploadAsset,
				onAttachmentAdded,
				onAttachmentRemoved,
			}),
		[uploadAsset, onAttachmentAdded, onAttachmentRemoved],
	)

	const threadListAdapter = useMemo(() => {
		const activeThreads = (conversations || [])
			.filter((c) => c && c.status !== "archived")
			.map((c) => ({
				id: String(c.id),
				threadId: String(c.id),
				title: c.title || "AHP Session",
				status: "regular",
			}))
		const archivedThreads = (conversations || [])
			.filter((c) => c && c.status === "archived")
			.map((c) => ({
				id: String(c.id),
				threadId: String(c.id),
				title: c.title || "Archived Session",
				status: "archived",
			}))

		return {
			threadId: selectedConversationId ? String(selectedConversationId) : undefined,
			threads: activeThreads,
			archivedThreads,
			onSwitchToNewThread: async () => {
				if (onNewSession) {
					await onNewSession()
				}
			},
			onSwitchToThread: async (tid) => {
				if (onSelectConversation) {
					const numeric = /^\d+$/.test(String(tid)) ? Number(tid) : tid
					onSelectConversation(numeric)
				}
			},
			onArchive: async (tid) => {
				if (onArchiveConversation) {
					const numeric = /^\d+$/.test(String(tid)) ? Number(tid) : tid
					await onArchiveConversation(numeric)
				}
			},
		}
	}, [
		conversations,
		selectedConversationId,
		onSelectConversation,
		onNewSession,
		onArchiveConversation,
	])

	const convertMessage = useCallback((m) => convertToAhpAssistantMessage(m), [])

	const handleNew = useCallback(
		async (appendMessage) => {
			if (onSend) {
				await onSend(appendMessage)
			}
		},
		[onSend],
	)

	const handleCancel = useCallback(async () => {
		if (onStop) {
			onStop()
		}
	}, [onStop])

	return useExternalStoreRuntime({
		isRunning,
		messages,
		convertMessage,
		onNew: handleNew,
		onCancel: handleCancel,
		adapters: {
			attachments: attachmentAdapter,
			threadList: threadListAdapter,
		},
	})
}
