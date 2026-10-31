import React, { useState, useRef, useEffect, useMemo, useCallback } from "react"
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	ThreadPrimitive,
	MessagePrimitive,
} from "@assistant-ui/react"
import { VSCodeWorkingStateIcon, VSCodeGearIcon, VSCodeProgressBar } from "./VSCodeWorkingIcons.jsx"
import { AssistantToolCallPart } from "./AssistantAgentProcess.jsx"

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
	const bodyRef = useRef(null)
	const userScrolledUpRef = useRef(false)

	const isBusy = status === "running" || status === "thinking"
	const currentStep = metadata?.step || metadata?.action || metadata?.current_step || ""
	const currentTool = metadata?.tool || metadata?.tool_name || ""

	useEffect(() => {
		if (isOpen && bodyRef.current && !userScrolledUpRef.current) {
			bodyRef.current.scrollTop = bodyRef.current.scrollHeight
		}
	}, [thinkingText, isOpen])

	const handleScroll = (e) => {
		const target = e.currentTarget
		const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 40
		userScrolledUpRef.current = !atBottom
	}

	const liveToolParts = useMemo(() => {
		return toolCalls.slice(-8).map((tc, idx) => {
			const isLast = idx === Math.min(toolCalls.length, 8) - 1
			if (typeof tc === "string") {
				return {
					type: "tool-call",
					toolCallId: `live-tc-${idx}`,
					toolName: tc,
					args: {},
					...(isBusy && isLast ? {} : { result: "Completed" }),
				}
			}
			const toolName = tc?.name || tc?.tool || tc?.tool_name || (tc?.command ? "terminal" : "call")
			const args =
				tc?.args && typeof tc.args === "object"
					? tc.args
					: tc?.command
						? { command: tc.command, ...(tc?.step ? { step: tc.step } : {}) }
						: tc?.step
							? { step: tc.step }
							: {}
			const result = tc?.result ?? tc?.output ?? (isBusy && isLast ? undefined : "Completed")
			return {
				type: "tool-call",
				toolCallId: String(tc?.id || `live-tc-${idx}`),
				toolName: String(toolName),
				args,
				...(result !== undefined ? { result } : {}),
			}
		})
	}, [toolCalls, isBusy])

	const liveMessages = useMemo(
		() => [
			{
				id: "live-agent-process",
				role: "assistant",
				content: liveToolParts,
			},
		],
		[liveToolParts],
	)

	const convertLiveMessage = useCallback(
		(m) => ({
			id: m.id,
			role: "assistant",
			createdAt: new Date(),
			content: m.content,
			status: isBusy ? { type: "running" } : { type: "complete", reason: "stop" },
		}),
		[isBusy],
	)

	const runtime = useExternalStoreRuntime({
		isRunning: isBusy,
		messages: liveMessages,
		convertMessage: convertLiveMessage,
		onNew: async () => {},
	})

	const LiveAssistantMessage = useCallback(
		() => (
			<MessagePrimitive.Root className="aui-live-message-root">
				<MessagePrimitive.Parts
					components={{
						tools: {
							Fallback: AssistantToolCallPart,
						},
					}}
				/>
			</MessagePrimitive.Root>
		),
		[],
	)

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

	const displayStatus =
		status === "thinking"
			? "Thinking"
			: status === "running"
				? "Running"
				: status === "waiting_for_input" || status === "needs_input"
					? "Waiting for Input"
					: status.replace(/_/g, " ")

	return (
		<div className="live-thinking-card" data-testid="live-thinking-card">
			{/* VS Code Indeterminate Progress Bar */}
			<VSCodeProgressBar active={isBusy} variant={status === "thinking" ? "thinking" : "running"} />

			{/* Status & Tool Step Header */}
			<div className="live-thinking-header">
				<div className="live-thinking-status">
					<span className={`live-status-badge live-status-badge--${status}`}>
						<VSCodeWorkingStateIcon status={status} size={13} className="live-status-icon mr-1" />
						{displayStatus}
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

					{metadata?.changeset && (
						<span
							className="live-tool-chip"
							title={
								Array.isArray(metadata.changeset?.files)
									? metadata.changeset.files.join(", ")
									: "Changeset tracked"
							}
						>
							📁{" "}
							{Array.isArray(metadata.changeset?.files)
								? `${metadata.changeset.files.length} files changed`
								: "Changeset"}
						</span>
					)}

					{metadata?.plan && (
						<span className="live-tool-chip" title="Active Execution Plan">
							📋 Plan
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
						<button type="button" className="btn-stop" onClick={onStop} title="Interrupt agent">
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

			{/* @assistant-ui/react Live Tool Execution Steps */}
			{isOpen && liveToolParts.length > 0 && (
				<div className="aui-live-tools-stream" data-testid="aui-live-tools-stream">
					<span className="tool-chips-label">Process Steps:</span>
					<AssistantRuntimeProvider runtime={runtime}>
						<ThreadPrimitive.Root className="aui-live-thread">
							<ThreadPrimitive.Messages
								components={{
									AssistantMessage: LiveAssistantMessage,
								}}
							/>
						</ThreadPrimitive.Root>
					</AssistantRuntimeProvider>
				</div>
			)}

			{/* Collapsible Thinking Stream Body */}
			{isOpen && thinkingText && (
				<div className="live-thinking-body" ref={bodyRef} onScroll={handleScroll}>
					<div className="live-thinking-label">Reasoning & Execution Log:</div>
					<pre className="live-thinking-content">{thinkingText}</pre>
				</div>
			)}
		</div>
	)
}
