import React, { useState } from "react"
import {
	VSCodeWorkingStateIcon,
	VSCodeGearIcon,
	VSCodeProgressBar,
} from "./VSCodeWorkingIcons.jsx"

export default function LiveThinking({
	status = "idle",
	metadata = {},
	thinkingText = "",
	toolCalls = [],
	onStop,
	onSteer,
}) {
	const [isOpen, setIsOpen] = useState(true)
	const [steerInput, setSteerInput] = useState("")
	const [showSteerModal, setShowSteerModal] = useState(false)

	const isBusy = status === "running" || status === "thinking"
	const currentStep = metadata?.step || metadata?.action || metadata?.current_step || ""
	const currentTool = metadata?.tool || metadata?.tool_name || ""

	if (!isBusy && !thinkingText && toolCalls.length === 0) {
		return null
	}

	function handleSteerSubmit(e) {
		e.preventDefault()
		if (!steerInput.trim()) return
		onSteer && onSteer(steerInput.trim())
		setSteerInput("")
		setShowSteerModal(false)
	}

	return (
		<div className="live-thinking-card">
			{/* VS Code Indeterminate Progress Bar */}
			<VSCodeProgressBar
				active={isBusy}
				variant={status === "thinking" ? "thinking" : "running"}
			/>

			{/* Status & Tool Step Header */}
			<div className="live-thinking-header">
				<div className="live-thinking-status">
					<span
						className={`live-status-badge live-status-badge--${status}`}
					>
						<VSCodeWorkingStateIcon
							status={status}
							size={13}
							className="live-status-icon mr-1"
						/>
						{status === "thinking" ? "Thinking" : status === "running" ? "Running" : status}
					</span>

					{currentStep && (
						<span className="live-step-desc" title={currentStep}>
							{currentStep}
						</span>
					)}

					{currentTool && (
						<span className="live-tool-chip">
							<VSCodeGearIcon size={12} spin={true} className="inline mr-1 text-sky-400" />
							{currentTool}
						</span>
					)}
				</div>

				<div className="live-thinking-actions">
					{isBusy && onSteer && (
						<button
							type="button"
							className="btn-steer"
							onClick={() => setShowSteerModal(!showSteerModal)}
							title="Steer agent execution"
						>
							🧭 Steer
						</button>
					)}

					{isBusy && onStop && (
						<button
							type="button"
							className="btn-stop"
							onClick={onStop}
							title="Interrupt agent"
						>
							⏹ Stop
						</button>
					)}

					<button
						type="button"
						className="btn-toggle-thinking"
						onClick={() => setIsOpen(!isOpen)}
						aria-label={isOpen ? "Collapse thinking" : "Expand thinking"}
					>
						{isOpen ? "Hide Thoughts ▲" : "Show Thoughts ▼"}
					</button>
				</div>
			</div>

			{/* Inline Steer Form */}
			{showSteerModal && (
				<form onSubmit={handleSteerSubmit} className="steer-form">
					<input
						type="text"
						className="steer-input"
						placeholder="Give redirection instruction (e.g. 'Use approach B instead')..."
						value={steerInput}
						onChange={(e) => setSteerInput(e.target.value)}
						autoFocus
					/>
					<button type="submit" className="steer-submit-btn">
						Send Instruction
					</button>
					<button
						type="button"
						className="steer-cancel-btn"
						onClick={() => setShowSteerModal(false)}
					>
						Cancel
					</button>
				</form>
			)}

			{/* Tool chips history */}
			{toolCalls.length > 0 && (
				<div className="tool-chips-row">
					<span className="tool-chips-label">Recent tools:</span>
					{toolCalls.slice(-5).map((tool, idx) => (
						<span key={idx} className="tool-chip-item" title={typeof tool === "string" ? tool : JSON.stringify(tool)}>
							<VSCodeGearIcon size={11} spin={false} className="inline mr-1 opacity-70" />
							{typeof tool === "string" ? tool : tool.name || tool.tool || "call"}
						</span>
					))}
				</div>
			)}

			{/* Collapsible Thinking Stream Body */}
			{isOpen && thinkingText && (
				<div className="live-thinking-body">
					<div className="live-thinking-label">Reasoning & Execution Log:</div>
					<pre className="live-thinking-content">{thinkingText}</pre>
				</div>
			)}
		</div>
	)
}
