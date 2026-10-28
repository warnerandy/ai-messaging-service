import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SettingsModal from "./SettingsModal.jsx"
import {
	getNotificationPermission,
	requestNotificationPermission,
	isSessionAlarmEnabled,
	isVibrationSupported,
	toggleSessionAlarm,
	playAlarmChime,
	triggerAlarmVibration,
	testNativeNotification,
} from "../lib/notifications.js"
import { regenerateBotToken } from "../lib/data.js"

vi.mock("../lib/notifications.js", () => ({
	getNotificationPermission: vi.fn(() => "default"),
	requestNotificationPermission: vi.fn(),
	isNotificationSupported: vi.fn(() => true),
	isVibrationSupported: vi.fn(() => true),
	isSessionAlarmEnabled: vi.fn(() => false),
	toggleSessionAlarm: vi.fn(),
	unlockAudio: vi.fn(),
	playAlarmChime: vi.fn(),
	triggerAlarmVibration: vi.fn(() => true),
	testNativeNotification: vi.fn(() => Promise.resolve({ ok: true, permission: "granted" })),
}))

vi.mock("../lib/data.js", () => ({
	regenerateBotToken: vi.fn(),
}))

describe("SettingsModal", () => {
	const sampleBot = {
		id: "bot-123",
		name: "CodeAssistant",
		channel_code: "bot-code-xyz",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		getNotificationPermission.mockReturnValue("default")
		isSessionAlarmEnabled.mockReturnValue(false)
	})

	it("renders nothing when isOpen is false", () => {
		const { container } = render(
			<SettingsModal
				isOpen={false}
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)
		expect(container.firstChild).toBeNull()
	})

	it("renders modal with header and tabs when isOpen is true", () => {
		render(
			<SettingsModal
				isOpen={true}
				onClose={vi.fn()}
				bot={sampleBot}
				showBotConfig={true}
				selectedConversationId="conv-1"
			/>,
		)

		expect(screen.getByText("Settings & AHP Statuses")).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: /AHP Statuses/i })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: /Alert List & Sound/i })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: /Bot Config/i })).toBeInTheDocument()
	})

	it("does not render Bot Config tab when showBotConfig is false", () => {
		render(
			<SettingsModal
				isOpen={true}
				onClose={vi.fn()}
				bot={sampleBot}
				showBotConfig={false}
				selectedConversationId="conv-1"
			/>,
		)

		expect(screen.getByRole("tab", { name: /AHP Statuses/i })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: /Alert List & Sound/i })).toBeInTheDocument()
		expect(screen.queryByRole("tab", { name: /Bot Config/i })).not.toBeInTheDocument()
	})

	it("switches to Alert List & Sound tab and renders alert controls", async () => {
		const user = userEvent.setup()

		render(
			<SettingsModal
				isOpen={true}
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const alertsTab = screen.getByRole("tab", { name: /Alert List & Sound/i })
		await user.click(alertsTab)

		expect(screen.getByText("Browser & PWA Notifications")).toBeInTheDocument()
		expect(screen.getByText("Active Session Alarm")).toBeInTheDocument()
	})

	it("opens directly on initialTab if specified", () => {
		render(
			<SettingsModal
				isOpen={true}
				initialTab="states"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		expect(screen.getByText("Waiting for Input / Approval")).toBeInTheDocument()
		expect(screen.getByText("Model Thinking & Reasoning")).toBeInTheDocument()
	})

	it("handles enabling system push notifications", async () => {
		const user = userEvent.setup()
		requestNotificationPermission.mockResolvedValue("granted")

		render(
			<SettingsModal
				isOpen={true}
				initialTab="alerts"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const enableBtn = screen.getByRole("button", { name: "Enable System Notifications" })
		await user.click(enableBtn)

		expect(requestNotificationPermission).toHaveBeenCalledTimes(1)
	})

	it("handles testing native notifications with feedback banner", async () => {
		const user = userEvent.setup()
		testNativeNotification.mockResolvedValue({ ok: true, permission: "granted" })

		render(
			<SettingsModal
				isOpen={true}
				initialTab="alerts"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const testBtn = screen.getByRole("button", { name: /Test Native Notification/i })
		await user.click(testBtn)

		expect(testNativeNotification).toHaveBeenCalledTimes(1)
		await waitFor(() => {
			expect(screen.getByText(/Test notification sent/i)).toBeInTheDocument()
		})
	})

	it("handles toggling active session alarm", async () => {
		const user = userEvent.setup()
		toggleSessionAlarm.mockReturnValue(true)

		render(
			<SettingsModal
				isOpen={true}
				initialTab="alerts"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const alarmBtn = screen.getByRole("button", { name: "Arm Alarm for Active Session" })
		await user.click(alarmBtn)

		expect(toggleSessionAlarm).toHaveBeenCalledWith("conv-1")
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Disarm Session Alarm" })).toBeInTheDocument()
		})
	})

	it("triggers sound and vibration tests", async () => {
		const user = userEvent.setup()

		render(
			<SettingsModal
				isOpen={true}
				initialTab="alerts"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const chimeBtn = screen.getByRole("button", { name: /Test Audio Chime/i })
		await user.click(chimeBtn)
		expect(playAlarmChime).toHaveBeenCalledTimes(1)

		const vibeBtn = screen.getByRole("button", { name: /Test Vibration/i })
		await user.click(vibeBtn)
		expect(triggerAlarmVibration).toHaveBeenCalledTimes(1)
	})

	it("displays helpful unsupported banner when vibration is not supported (iOS / desktop)", async () => {
		const user = userEvent.setup()
		isVibrationSupported.mockReturnValue(false)

		render(
			<SettingsModal
				isOpen={true}
				initialTab="alerts"
				onClose={vi.fn()}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		expect(screen.getByText("Vibration: Android only")).toBeInTheDocument()

		const vibeBtn = screen.getByRole("button", { name: /Test Vibration/i })
		await user.click(vibeBtn)

		expect(triggerAlarmVibration).not.toHaveBeenCalled()
		expect(
			screen.getByText(/Vibration is not supported on this device\/browser/i),
		).toBeInTheDocument()
	})

	it("handles bot token regeneration in Bot Config tab", async () => {
		const user = userEvent.setup()
		const onBotUpdated = vi.fn()
		regenerateBotToken.mockResolvedValue({
			token: "new-secret-token-456",
			channel_code: "bot-new-channel",
		})

		render(
			<SettingsModal
				isOpen={true}
				initialTab="bot"
				showBotConfig={true}
				onClose={vi.fn()}
				token="user-jwt"
				bot={sampleBot}
				selectedConversationId="conv-1"
				onBotUpdated={onBotUpdated}
			/>,
		)

		expect(screen.getByText("Bot Secret Token")).toBeInTheDocument()
		const regenBtn = screen.getByRole("button", { name: "Regenerate Secret Key" })
		await user.click(regenBtn)

		expect(regenerateBotToken).toHaveBeenCalledWith("user-jwt", "bot-123")
		await waitFor(() => {
			expect(screen.getByDisplayValue("new-secret-token-456")).toBeInTheDocument()
		})
		expect(onBotUpdated).toHaveBeenCalledWith({
			...sampleBot,
			channel_code: "bot-new-channel",
		})
	})

	it("calls onClose when close button is clicked", async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()

		render(
			<SettingsModal
				isOpen={true}
				onClose={onClose}
				bot={sampleBot}
				selectedConversationId="conv-1"
			/>,
		)

		const closeBtn = screen.getByRole("button", { name: "Close settings" })
		await user.click(closeBtn)

		expect(onClose).toHaveBeenCalledTimes(1)
	})
})
