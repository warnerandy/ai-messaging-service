import React, { useState } from "react"

export default function BotTokenReveal({ token, onDismiss }) {
	const [copied, setCopied] = useState(false)

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(token)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			setCopied(false)
		}
	}

	return (
		<div className="token-reveal">
			<p className="token-title">Bot Token Created</p>
			<p className="token-warning">Copy this token now — it won't be shown again.</p>
			<div className="token-row">
				<code className="token-value">{token}</code>
				<button type="button" className="token-copy-btn" onClick={handleCopy}>
					{copied ? "Copied!" : "Copy"}
				</button>
			</div>
			<button type="button" className="token-dismiss" onClick={onDismiss}>
				Dismiss
			</button>
		</div>
	)
}
