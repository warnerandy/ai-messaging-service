import React, { useState } from "react"
import { regenerateBotToken } from "../lib/data.js"
import { VSCodeGearIcon, VSCodeLoadingIcon } from "./VSCodeWorkingIcons.jsx"

export default function BotConfigModal({
	token,
	bot,
	onClose,
	onBotUpdated,
}) {
	const [regenerating, setRegenerating] = useState(false)
	const [newKey, setNewKey] = useState(null)
	const [copiedKey, setCopiedKey] = useState(false)
	const [copiedWs, setCopiedWs] = useState(false)
	const [copiedHttp, setCopiedHttp] = useState(false)
	const [copiedTopic, setCopiedTopic] = useState(false)
	const [error, setError] = useState(null)

	if (!bot) return null

	const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const host = window.location.host
	const wsUrl = `${wsProtocol}//${host}/socket/websocket`
	const httpUrl = `${window.location.origin}/api/bot`
	const channelTopic = `bot:${bot.channel_code || bot.id}`

	async function handleRegenerate() {
		if (regenerating) return
		setError(null)
		setRegenerating(true)
		try {
			const res = await regenerateBotToken(token, bot.id)
			if (res?.token) {
				setNewKey(res.token)
				onBotUpdated && onBotUpdated({ ...bot, channel_code: res.channel_code })
			}
		} catch (err) {
			setError(err.message || "Failed to regenerate token")
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
			<div className="modal-card modal-card--config" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<div className="modal-title-row">
						<VSCodeGearIcon size={18} spin={false} className="modal-gear-icon inline mr-2 text-slate-300" />
						<h3 className="modal-title">Bot Configuration</h3>
					</div>
					<button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>

				<div className="modal-body">
					{/* Bot Info */}
					<div className="config-field-group">
						<div className="config-field">
							<span className="config-label">Bot Name</span>
							<span className="config-value-bold">{bot.name}</span>
						</div>
						<div className="config-field">
							<span className="config-label">Integration Type</span>
							<span className={`config-type-badge config-type-badge--${bot.bot_type || "chat"}`}>
								{(bot.bot_type || "chat").toUpperCase()}
							</span>
						</div>
					</div>

					{/* Service URLs */}
					<div className="config-section">
						<label className="config-section-title">WebSocket Service URL</label>
						<p className="config-section-desc">Connect bot WebSocket clients to this endpoint:</p>
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
							Regenerating the token immediately revokes the existing key. Any active bridge or agent using the previous key will need to reconnect with the new key.
						</p>

						{newKey ? (
							<div className="token-reveal-box">
								<div className="token-reveal-alert">
									<span>🔑 New Token Generated! Save it now; it won't be shown again.</span>
								</div>
								<div className="copy-field">
									<input type="text" readOnly value={newKey} className="copy-input copy-input--token" />
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
										<VSCodeLoadingIcon size={14} spin className="inline mr-2" />
										Regenerating...
									</>
								) : (
									<>
										<VSCodeLoadingIcon size={14} spin={false} className="inline mr-2 opacity-80" />
										Regenerate Bot Token
									</>
								)}
							</button>
						)}

						{error && <p className="config-error">{error}</p>}
					</div>
				</div>

				<div className="modal-actions">
					<button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>
						Done
					</button>
				</div>
			</div>
		</div>
	)
}
