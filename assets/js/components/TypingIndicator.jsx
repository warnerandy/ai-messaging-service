import React, { useEffect, useState } from "react"
import { formatThinkingDuration, pickThinkingBlurb } from "../lib/thinkingConfig.js"

export default function TypingIndicator() {
	const [blurb] = useState(() => pickThinkingBlurb())
	const [elapsedMs, setElapsedMs] = useState(0)

	useEffect(() => {
		const startedAt = Date.now()
		const updateElapsed = () => setElapsedMs(Date.now() - startedAt)
		updateElapsed()
		const intervalId = window.setInterval(updateElapsed, 1000)

		return () => window.clearInterval(intervalId)
	}, [])

	return (
		<div className="msg msg--bot">
			<div className="msg-avatar">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<circle cx="9" cy="11" r="1.25" fill="currentColor" />
					<circle cx="15" cy="11" r="1.25" fill="currentColor" />
				</svg>
			</div>
			<div className="msg-content">
				<div className="msg-bubble msg-bubble--bot msg-bubble--typing">
					<div className="msg-thinking">
						<div className="typing-dots">
							<span />
							<span />
							<span />
						</div>
						<p className="msg-thinking-blurb" aria-live="polite">
							{blurb}
						</p>
						<span
							className="msg-thinking-timer"
							aria-label={`Bot has been thinking for ${formatThinkingDuration(elapsedMs)}`}
						>
							{formatThinkingDuration(elapsedMs)}
						</span>
					</div>
				</div>
			</div>
		</div>
	)
}
