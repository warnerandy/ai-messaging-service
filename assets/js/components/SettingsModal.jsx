import React, { useState, useEffect } from "react"
import { regenerateBotToken } from "../lib/data.js"
import {
	VSCodeGearIcon,
	VSCodeSparkleIcon,
	VSCodeIconsShowcase,
	VSCodeLoadingIcon,
	VSCodePulseDot,
} from "./VSCodeWorkingIcons.jsx"
import { BotIcon } from "./Icons.jsx"
import {
	getNotificationPermission,
	requestNotificationPermission,
	isNotificationSupported,
	isVibrationSupported,
	isSessionAlarmEnabled,
	toggleSessionAlarm,
	unlockAudio,
	playAlarmChime,
	triggerAlarmVibration,
	testNativeNotification,
} from "../lib/notifications.js"

export default function SettingsModal({
	isOpen,
	onClose,
	initialTab = "states",
	token,
	bot,
	showBotConfig = false,
	selectedConversationId,
	onBotUpdated,
}) {
	const [activeTab, setActiveTab] = useState(initialTab)
	const [permission, setPermission] = useState(() => getNotificationPermission())
	const [alarmArmed, setAlarmArmed] = useState(() => isSessionAlarmEnabled(selectedConversationId))
	const [testedSound, setTestedSound] = useState(false)
	const [testedVibe, setTestedVibe] = useState(false)
	const [vibeStatus, setVibeStatus] = useState(null) // null | "vibrating" | "unsupported" | "blocked"
	const [testingNotification, setTestingNotification] = useState(false)
	const [notifFeedback, setNotifFeedback] = useState(null) // null | "sent" | "denied" | "unsupported" | "error"

	// Bot config tab state
	const [regenerating, setRegenerating] = useState(false)
	const [newKey, setNewKey] = useState(null)
	const [copiedKey, setCopiedKey] = useState(false)
	const [copiedWs, setCopiedWs] = useState(false)
	const [copiedHttp, setCopiedHttp] = useState(false)
	const [copiedTopic, setCopiedTopic] = useState(false)
	const [botError, setBotError] = useState(null)

	useEffect(() => {
		if (isOpen) {
			setPermission(getNotificationPermission())
			setAlarmArmed(isSessionAlarmEnabled(selectedConversationId))
			if (initialTab) {
				setActiveTab(initialTab)
			}
		}
	}, [isOpen, initialTab, selectedConversationId])

	if (!isOpen) return null

	const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const host = window.location.host
	const wsUrl = `${wsProtocol}//${host}/socket/websocket`
	const httpUrl = `${window.location.origin}/api/bot`
	const channelTopic = bot ? `bot:${bot.channel_code || bot.id}` : ""

	async function handleRequestPermission() {
		const res = await requestNotificationPermission()
		setPermission(res)
	}

	async function handleTestNotification() {
		setTestingNotification(true)
		setNotifFeedback(null)
		try {
			const res = await testNativeNotification()
			if (res.permission) {
				setPermission(res.permission)
			}
			if (res.ok) {
				setNotifFeedback("sent")
				setTimeout(() => setNotifFeedback(null), 4000)
			} else if (res.reason === "unsupported") {
				setNotifFeedback("unsupported")
				setTimeout(() => setNotifFeedback(null), 4000)
			} else if (res.reason === "denied") {
				setNotifFeedback("denied")
				setTimeout(() => setNotifFeedback(null), 4000)
			} else {
				setNotifFeedback("error")
				setTimeout(() => setNotifFeedback(null), 4000)
			}
		} catch {
			setNotifFeedback("error")
			setTimeout(() => setNotifFeedback(null), 4000)
		} finally {
			setTestingNotification(false)
		}
	}

	function handleToggleAlarm() {
		unlockAudio()
		const next = toggleSessionAlarm(selectedConversationId)
		setAlarmArmed(next)
	}

	async function handleTestSound() {
		setTestedSound(true)
		try {
			unlockAudio()
			await playAlarmChime()
		} finally {
			setTimeout(() => setTestedSound(false), 2000)
		}
	}

	function handleTestVibration() {
		if (!isVibrationSupported()) {
			setVibeStatus("unsupported")
			setTimeout(() => setVibeStatus(null), 4500)
			return
		}
		const ok = triggerAlarmVibration()
		if (ok) {
			setTestedVibe(true)
			setVibeStatus("vibrating")
			setTimeout(() => {
				setTestedVibe(false)
				setVibeStatus(null)
			}, 1500)
		} else {
			setVibeStatus("blocked")
			setTimeout(() => setVibeStatus(null), 4500)
		}
	}

	async function handleRegenerate() {
		if (regenerating || !bot) return
		setBotError(null)
		setRegenerating(true)
		try {
			const res = await regenerateBotToken(token, bot.id)
			if (res?.token) {
				setNewKey(res.token)
				onBotUpdated && onBotUpdated({ ...bot, channel_code: res.channel_code })
			}
		} catch (err) {
			setBotError(err.message || "Failed to regenerate token")
		} finally {
			setRegenerating(false)
		}
	}

	function copyToClipboard(text, setter) {
		navigator.clipboard.writeText(text)
		setter(true)
		setTimeout(() => setter(false), 2000)
	}

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div
				className="modal-card modal-card--settings"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-label="Settings and AHP reference"
			>
				{/* Modal Header */}
				<div className="modal-header">
					<div className="modal-title-row">
						<VSCodeGearIcon size={18} spin={false} className="text-slate-300 mr-2" />
						<h3 className="modal-title">Settings &amp; AHP Statuses</h3>
					</div>
					<button
						type="button"
						className="modal-close-btn"
						onClick={onClose}
						aria-label="Close settings"
					>
						✕
					</button>
				</div>

				{/* Tab Navigation */}
				<div className="settings-tabs-nav" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "states"}
						className={`settings-tab-btn ${activeTab === "states" ? "settings-tab-btn--active" : ""}`}
						onClick={() => setActiveTab("states")}
					>
						<VSCodeSparkleIcon
							size={14}
							animated={false}
							ariaLabel=""
							className="text-purple-400 mr-1 inline"
						/>
						<span>AHP Statuses</span>
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "alerts"}
						className={`settings-tab-btn ${activeTab === "alerts" ? "settings-tab-btn--active" : ""}`}
						onClick={() => setActiveTab("alerts")}
					>
						<span className="settings-tab-icon inline-flex items-center">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
								<path d="M13.73 21a2 2 0 0 1-3.46 0" />
							</svg>
						</span>
						<span>Alert List &amp; Sound</span>
					</button>
					{bot && showBotConfig && (
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === "bot"}
							className={`settings-tab-btn ${activeTab === "bot" ? "settings-tab-btn--active" : ""}`}
							onClick={() => setActiveTab("bot")}
						>
							<span className="settings-tab-icon">
								<BotIcon size={14} />
							</span>
							<span>Bot Config</span>
						</button>
					)}
				</div>

				{/* Modal Body */}
				<div className="modal-body settings-modal-body">
					{/* ─── TAB 1: AHP Statuses & Working States ─── */}
					{activeTab === "states" && (
						<div className="settings-tab-content">
							<p className="settings-tab-desc">
								Live status indicators for Agent Host Protocol (AHP) and VS Code sessions:
							</p>

							{/* AHP Status Guide Cards */}
							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<span className="settings-card-icon inline-flex items-center text-amber-400">
											<VSCodePulseDot size={12} />
										</span>
										<div>
											<h4 className="settings-card-title">Waiting for Input / Approval</h4>
											<p className="settings-card-desc">
												Pulses amber when the agent is waiting for you to answer a question, select
												an option, or approve a dangerous action before continuing.
											</p>
										</div>
									</div>
									<span className="settings-status-pill settings-status-pill--pending">
										needs_input
									</span>
								</div>
							</div>

							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<span className="settings-card-icon inline-flex items-center text-blue-400">
											<VSCodeLoadingIcon size={14} spin smooth={false} />
										</span>
										<div>
											<h4 className="settings-card-title">Running Tool Execution</h4>
											<p className="settings-card-desc">
												Stepped spin indicating the agent is actively executing commands, reading or
												editing files, or compiling code.
											</p>
										</div>
									</div>
									<span className="settings-status-pill settings-status-pill--granted">
										running
									</span>
								</div>
							</div>

							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<span className="settings-card-icon inline-flex items-center text-purple-400">
											<VSCodeSparkleIcon size={14} animated ariaLabel="" />
										</span>
										<div>
											<h4 className="settings-card-title">Model Thinking &amp; Reasoning</h4>
											<p className="settings-card-desc">
												Breathing sparkle indicating the language model is thinking, evaluating
												context, or formulating its plan.
											</p>
										</div>
									</div>
									<span className="settings-status-pill settings-status-pill--granted">
										thinking
									</span>
								</div>
							</div>

							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<span className="settings-card-icon inline-flex items-center">
											<span className="conv-status-dot conv-status-dot--idle" />
										</span>
										<div>
											<h4 className="settings-card-title">Idle / Ready</h4>
											<p className="settings-card-desc">
												The session turn is complete and waiting for your next message or task.
											</p>
										</div>
									</div>
									<span className="settings-status-pill settings-status-pill--disarmed">idle</span>
								</div>
							</div>

							{/* Interactive Codicon Animation Showcase */}
							<div className="settings-showcase-container">
								<VSCodeIconsShowcase />
							</div>
						</div>
					)}

					{/* ─── TAB 2: Alert List & Sounds ─── */}
					{activeTab === "alerts" && (
						<div className="settings-tab-content">
							{/* Native Push Notifications */}
							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<div>
											<h4 className="settings-card-title">Browser &amp; PWA Notifications</h4>
											<p className="settings-card-desc">
												Alerts you when bot finishes a task, completes a response, or needs input
												while backgrounded.
											</p>
										</div>
									</div>
									<span
										className={`settings-status-pill settings-status-pill--${
											permission === "granted"
												? "granted"
												: permission === "denied"
													? "denied"
													: "pending"
										}`}
									>
										{permission === "granted"
											? "Enabled"
											: permission === "denied"
												? "Blocked"
												: "Not Enabled"}
									</span>
								</div>

								<div className="settings-card-actions settings-card-actions--row">
									{permission !== "granted" ? (
										<button
											type="button"
											className="settings-btn settings-btn--primary"
											onClick={handleRequestPermission}
										>
											Enable System Notifications
										</button>
									) : (
										<span className="settings-hint-text">
											System notifications are active and permitted for this origin.
										</span>
									)}
									<button
										type="button"
										className="settings-btn settings-btn--secondary"
										onClick={handleTestNotification}
										disabled={testingNotification}
									>
										{testingNotification ? "Sending..." : "Test Native Notification"}
									</button>
								</div>

								{notifFeedback === "sent" && (
									<div className="settings-feedback-banner settings-feedback-banner--success">
										<span>Test notification sent! Check your notification tray or banner.</span>
									</div>
								)}
								{notifFeedback === "denied" && (
									<div className="settings-feedback-banner settings-feedback-banner--warning">
										<span>Notifications are blocked or denied in your browser settings.</span>
									</div>
								)}
								{notifFeedback === "unsupported" && (
									<div className="settings-feedback-banner settings-feedback-banner--warning">
										<span>
											{typeof navigator !== "undefined" &&
											/iPhone|iPad|iPod/.test(navigator.userAgent)
												? "On iOS, Apple requires adding Botamus to your Home Screen (Safari Share ➔ Add to Home Screen) to enable native notifications."
												: "Native notifications are not supported in this browser."}
										</span>
									</div>
								)}
								{notifFeedback === "error" && (
									<div className="settings-feedback-banner settings-feedback-banner--warning">
										<span>
											Failed to deliver notification. Check your system notification permissions.
										</span>
									</div>
								)}
							</div>

							{/* Session Alarm */}
							{selectedConversationId && (
								<div className="settings-card">
									<div className="settings-card-header">
										<div className="settings-card-title-group">
											<span className="settings-card-icon">⏰</span>
											<div>
												<h4 className="settings-card-title">Active Session Alarm</h4>
												<p className="settings-card-desc">
													Arming a session plays chimes, vibrates, and alerts you when turns
													complete or questions need approval.
												</p>
											</div>
										</div>
										<span
											className={`settings-status-pill settings-status-pill--${
												alarmArmed ? "armed" : "disarmed"
											}`}
										>
											{alarmArmed ? (
												<span className="inline-flex items-center gap-1">
													<svg
														width="11"
														height="11"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
														aria-hidden="true"
													>
														<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
														<path d="M13.73 21a2 2 0 0 1-3.46 0" />
													</svg>
													Armed
												</span>
											) : (
												"Disarmed"
											)}
										</span>
									</div>

									<div className="settings-card-actions">
										<button
											type="button"
											className={`settings-btn ${alarmArmed ? "settings-btn--danger" : "settings-btn--primary"}`}
											onClick={handleToggleAlarm}
										>
											{alarmArmed ? "Disarm Session Alarm" : "Arm Alarm for Active Session"}
										</button>
									</div>
								</div>
							)}

							{/* Sound & Haptic Testing */}
							<div className="settings-card">
								<div className="settings-card-header">
									<div className="settings-card-title-group">
										<div>
											<h4 className="settings-card-title">Sound Effects &amp; Haptic Vibration</h4>
											<p className="settings-card-desc">
												Test audio chime playback and physical vibration for active session alarms.
											</p>
										</div>
									</div>
									<span
										className={`settings-status-pill settings-status-pill--${
											isVibrationSupported() ? "granted" : "pending"
										}`}
									>
										{isVibrationSupported() ? "Haptics Ready" : "Vibration: Android only"}
									</span>
								</div>

								<div className="settings-card-actions settings-card-actions--row">
									<button
										type="button"
										className="settings-btn settings-btn--secondary"
										onClick={handleTestSound}
									>
										{testedSound ? "Playing Chime..." : "Test Audio Chime"}
									</button>
									<button
										type="button"
										className="settings-btn settings-btn--secondary"
										onClick={handleTestVibration}
									>
										{testedVibe ? "Vibrating..." : "Test Vibration"}
									</button>
								</div>

								{vibeStatus === "unsupported" && (
									<div className="settings-feedback-banner settings-feedback-banner--warning">
										<span>
											Vibration is not supported on this device/browser. iOS Safari and desktop PCs
											lack the Vibration API (supported on Android).
										</span>
									</div>
								)}

								{vibeStatus === "blocked" && (
									<div className="settings-feedback-banner settings-feedback-banner--warning">
										<span>
											Vibration was blocked by device or browser settings. Check if Do Not Disturb
											or system Haptics is turned off.
										</span>
									</div>
								)}
							</div>

							{/* Alert Behavior Breakdown */}
							<div className="settings-info-box">
								<h5 className="settings-info-title">When do alerts fire?</h5>
								<ul className="settings-info-list">
									<li>
										<strong>Waiting for Input:</strong> Pulses amber, triggers chime, and requests
										approval for tool execution or agent questions.
									</li>
									<li>
										<strong>Turn Completed / Idle:</strong> Rings when long-running tool runs or
										reasoning steps finish.
									</li>
									<li>
										<strong>New Bot Message:</strong> Notifies when responses arrive from chat
										assistants.
									</li>
								</ul>
							</div>
						</div>
					)}

					{/* ─── TAB 3: Bot Configuration (Optional) ─── */}
					{showBotConfig && bot && activeTab === "bot" && (
						<div className="settings-tab-content">
							{/* Bot Info */}
							<div className="config-field-group">
								<div className="config-field">
									<span className="config-label">Bot Name</span>
									<span className="config-value-bold">{bot.name}</span>
								</div>
								<div className="config-field">
									<span className="config-label">Integration Type</span>
									<span
										className={`config-type-badge config-type-badge--${bot.bot_type || "chat"}`}
									>
										{(bot.bot_type || "chat").toUpperCase()}
									</span>
								</div>
							</div>

							{/* Service URLs */}
							<div className="config-section">
								<label className="config-section-title">WebSocket Service URL</label>
								<div className="copy-field">
									<input type="text" readOnly value={wsUrl} className="copy-input" />
									<button
										type="button"
										className="copy-btn"
										onClick={() => copyToClipboard(wsUrl, setCopiedWs)}
									>
										{copiedWs ? "Copied!" : "Copy"}
									</button>
								</div>
							</div>

							<div className="config-section">
								<label className="config-section-title">WebSocket Channel Topic</label>
								<div className="copy-field">
									<input type="text" readOnly value={channelTopic} className="copy-input" />
									<button
										type="button"
										className="copy-btn"
										onClick={() => copyToClipboard(channelTopic, setCopiedTopic)}
									>
										{copiedTopic ? "Copied!" : "Copy"}
									</button>
								</div>
							</div>

							<div className="config-section">
								<label className="config-section-title">REST API URL</label>
								<div className="copy-field">
									<input type="text" readOnly value={httpUrl} className="copy-input" />
									<button
										type="button"
										className="copy-btn"
										onClick={() => copyToClipboard(httpUrl, setCopiedHttp)}
									>
										{copiedHttp ? "Copied!" : "Copy"}
									</button>
								</div>
							</div>

							{/* Token Regeneration */}
							<div className="config-section config-section--danger">
								<label className="config-section-title">Bot Secret Token</label>
								<p className="config-section-desc">
									Regenerating the token immediately revokes the existing key. Any active bridge or
									agent using the previous key will need to reconnect.
								</p>

								{newKey ? (
									<div className="token-reveal-box">
										<div className="token-reveal-alert">
											<span>New Token Generated! Save it now; it won't be shown again.</span>
										</div>
										<div className="copy-field">
											<input
												type="text"
												readOnly
												value={newKey}
												className="copy-input copy-input--token"
											/>
											<button
												type="button"
												className="copy-btn"
												onClick={() => copyToClipboard(newKey, setCopiedKey)}
											>
												{copiedKey ? "Copied!" : "Copy Key"}
											</button>
										</div>
									</div>
								) : (
									<button
										type="button"
										className="modal-btn modal-btn--regenerate"
										onClick={handleRegenerate}
										disabled={regenerating}
									>
										{regenerating ? (
											<>
												<VSCodeLoadingIcon size={14} className="inline mr-1" />
												Regenerating...
											</>
										) : (
											"Regenerate Secret Key"
										)}
									</button>
								)}

								{botError && <div className="modal-error-banner mt-2">{botError}</div>}
							</div>
						</div>
					)}
				</div>

				{/* Modal Footer Actions */}
				<div className="modal-actions">
					<button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>
						Done
					</button>
				</div>
			</div>
		</div>
	)
}
