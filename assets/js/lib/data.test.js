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
})
