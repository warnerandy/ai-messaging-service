import { describe, expect, it, vi, beforeEach } from "vitest"
import { createConversation } from "./data.js"
import { apiRequest } from "./api.js"

vi.mock("./api.js", () => ({
	apiRequest: vi.fn(),
	uploadFile: vi.fn(),
}))

describe("createConversation", () => {
	beforeEach(() => {
		apiRequest.mockReset()
	})

	it("sends the bot name as the conversation title when provided", async () => {
		apiRequest.mockResolvedValue({ id: "conversation-1" })

		await createConversation("token-1", "bot-1", "Atlas")

		expect(apiRequest).toHaveBeenCalledWith("/api/conversations", {
			method: "POST",
			body: {
				bot_token_id: "bot-1",
				title: "Atlas",
			},
			token: "token-1",
		})
	})

	it("omits the title when one is not provided", async () => {
		apiRequest.mockResolvedValue({ id: "conversation-1" })

		await createConversation("token-1", "bot-1")

		expect(apiRequest).toHaveBeenCalledWith("/api/conversations", {
			method: "POST",
			body: {
				bot_token_id: "bot-1",
			},
			token: "token-1",
		})
	})

	it("sends metadata when passed as fourth parameter", async () => {
		apiRequest.mockResolvedValue({ id: "conversation-1" })

		await createConversation("token-1", "bot-1", "Atlas", {
			project: { name: "infra-k8s" },
		})

		expect(apiRequest).toHaveBeenCalledWith("/api/conversations", {
			method: "POST",
			body: {
				bot_token_id: "bot-1",
				title: "Atlas",
				metadata: {
					project: { name: "infra-k8s" },
				},
			},
			token: "token-1",
		})
	})

	it("supports options object with title and metadata", async () => {
		apiRequest.mockResolvedValue({ id: "conversation-1" })

		await createConversation("token-1", "bot-1", {
			title: "Backend Session",
			metadata: { project: { name: "backend-api" } },
		})

		expect(apiRequest).toHaveBeenCalledWith("/api/conversations", {
			method: "POST",
			body: {
				bot_token_id: "bot-1",
				title: "Backend Session",
				metadata: {
					project: { name: "backend-api" },
				},
			},
			token: "token-1",
		})
	})

	it("supports external_session_id in options object", async () => {
		apiRequest.mockResolvedValue({ id: "conversation-1" })

		await createConversation("token-1", "bot-1", {
			title: "New Task",
			external_session_id: "123e4567-e89b-12d3-a456-426614174000",
		})

		expect(apiRequest).toHaveBeenCalledWith("/api/conversations", {
			method: "POST",
			body: {
				bot_token_id: "bot-1",
				title: "New Task",
				external_session_id: "123e4567-e89b-12d3-a456-426614174000",
			},
			token: "token-1",
		})
	})
})
