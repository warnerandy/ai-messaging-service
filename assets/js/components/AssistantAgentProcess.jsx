import React, { useState, useMemo, useCallback } from "react"
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	ThreadPrimitive,
	MessagePrimitive,
	ChainOfThoughtPrimitive,
} from "@assistant-ui/react"
import { renderMarkdown } from "../lib/renderMarkdown.js"
import { VSCodeWorkingStateIcon, VSCodeGearIcon } from "./VSCodeWorkingIcons.jsx"
import {
	SettingsIcon,
	BotIcon,
	FolderIcon,
	CheckIcon,
	FileCheckIcon,
	LayersIcon,
} from "./Icons.jsx"

/**
 * Normalizes tool calls or process steps from a message's metadata into
 * @assistant-ui/react `tool-call` content parts.
 */
export function extractToolCallParts(meta = {}, messageId = "msg") {
	const parts = []
	const rawTools = Array.isArray(meta.tool_calls)
		? meta.tool_calls
		: Array.isArray(meta.processes)
			? meta.processes
			: Array.isArray(meta.steps)
				? meta.steps
				: []

	rawTools.forEach((tc, idx) => {
		if (!tc) return
		if (typeof tc === "string") {
			parts.push({
				type: "tool-call",
				toolCallId: `${messageId}-tc-${idx}`,
				toolName: tc,
				args: {},
				result: "Completed",
			})
			return
		}
		if (typeof tc === "object") {
			const toolName =
				tc.name || tc.tool || tc.tool_name || (tc.command ? "terminal" : tc.step || "process_step")
			const args =
				tc.args && typeof tc.args === "object"
					? tc.args
					: tc.command
						? { command: tc.command, ...(tc.step ? { step: tc.step } : {}) }
						: tc.step
							? { step: tc.step }
							: {}
			const result =
				tc.result ??
				tc.output ??
				tc.stdout ??
				(tc.status === "running" ? undefined : tc.step || "Completed")
			parts.push({
				type: "tool-call",
				toolCallId: String(tc.id || tc.toolCallId || `${messageId}-tc-${idx}`),
				toolName: String(toolName),
				args,
				...(result !== undefined ? { result } : {}),
				...(tc.isError || tc.error ? { isError: true } : {}),
			})
		}
	})

	// If no array of tool_calls was provided, but single step/tool metadata exists on the turn
	if (parts.length === 0 && (meta.tool || meta.tool_name || meta.command)) {
		const toolName = meta.tool || meta.tool_name || "terminal"
		parts.push({
			type: "tool-call",
			toolCallId: `${messageId}-tc-single`,
			toolName: String(toolName),
			args: {
				...(meta.command ? { command: meta.command } : {}),
				...(meta.step ? { step: meta.step } : {}),
			},
			result: meta.output || meta.step || "Completed",
		})
	}

	return parts
}

/**
 * Converts an application message object into an @assistant-ui/react `ThreadMessageLike`.
 */
export function convertToAssistantMessage(message) {
	const role =
		message.role === "bot" || message.role === "assistant"
			? "assistant"
			: message.role === "system"
				? "system"
				: "user"

	const id = String(message.id ?? `msg-${Date.now()}`)
	const createdAt = message.inserted_at ? new Date(message.inserted_at) : new Date()
	const meta = message.metadata || {}

	if (role !== "assistant") {
		return {
			id,
			role,
			createdAt,
			content: [{ type: "text", text: message.body || "" }],
			metadata: {
				custom: { originalMessage: message },
			},
		}
	}

	const content = []
	const reasoningText = meta.thinking || meta.reasoning || meta.thought || ""
	if (typeof reasoningText === "string" && reasoningText.trim()) {
		content.push({
			type: "reasoning",
			text: reasoningText.trim(),
		})
	}

	const toolParts = extractToolCallParts(meta, id)
	content.push(...toolParts)

	if (message.body && String(message.body).trim()) {
		content.push({
			type: "text",
			text: String(message.body),
		})
	}

	return {
		id,
		role: "assistant",
		createdAt,
		content,
		status: { type: "complete", reason: "stop" },
		metadata: {
			custom: {
				originalMessage: message,
			},
		},
	}
}

/**
 * Renders a Reasoning part inside @assistant-ui/react's MessagePrimitive.Parts / ChainOfThoughtPrimitive.Parts.
 */
export function AssistantReasoningPart({ text }) {
	const [isExpanded, setIsExpanded] = useState(false)
	if (!text) return null

	const lines = text.trim().split("\n")
	const previewLine = lines[0]?.slice(0, 90) || "Agent reasoning"

	return (
		<div className="aui-reasoning-block" data-testid="aui-reasoning-block">
			<button
				type="button"
				className="aui-reasoning-trigger"
				onClick={() => setIsExpanded((prev) => !prev)}
				aria-expanded={isExpanded}
			>
				<span className="aui-reasoning-trigger__icon">
					<VSCodeWorkingStateIcon status="thinking" size={12} className="inline-flex" />
				</span>
				<span className="aui-reasoning-trigger__label">Thinking Process</span>
				{!isExpanded && <span className="aui-reasoning-trigger__preview">{previewLine}</span>}
				<span className="aui-reasoning-trigger__chevron">{isExpanded ? "▴" : "▾"}</span>
			</button>
			{isExpanded && <pre className="aui-reasoning-content">{text}</pre>}
		</div>
	)
}

/**
 * Renders a Tool Call / Process Execution part inside @assistant-ui/react's MessagePrimitive.Parts.
 */
export function AssistantToolCallPart({ toolName, args, argsText, result, isError, status }) {
	const [isExpanded, setIsExpanded] = useState(false)
	const isRunning = status?.type === "running"
	const stepDesc =
		args?.step || args?.command || args?.CommandLine || args?.Path || args?.query || ""

	const hasDetails =
		(args && Object.keys(args).length > 0) ||
		(result !== undefined && result !== "Completed") ||
		Boolean(argsText && argsText !== "{}")

	return (
		<div
			className={[
				"aui-tool-call-card",
				isRunning ? "aui-tool-call-card--running" : "aui-tool-call-card--completed",
				isError ? "aui-tool-call-card--error" : "",
			]
				.filter(Boolean)
				.join(" ")}
			data-testid="aui-tool-call-card"
		>
			<button
				type="button"
				className="aui-tool-call-header"
				onClick={() => hasDetails && setIsExpanded((prev) => !prev)}
				aria-expanded={hasDetails ? isExpanded : undefined}
			>
				<span className="aui-tool-call-icon">
					<VSCodeGearIcon
						size={12}
						spin={isRunning}
						className={isRunning ? "text-sky-400" : "opacity-75"}
					/>
				</span>
				<code className="aui-tool-call-name">{toolName || "process"}</code>
				{stepDesc && stepDesc !== toolName && (
					<span className="aui-tool-call-desc" title={String(stepDesc)}>
						{String(stepDesc)}
					</span>
				)}
				<span
					className={`aui-tool-call-status aui-tool-call-status--${isRunning ? "running" : isError ? "error" : "done"}`}
				>
					{isRunning ? "Running" : isError ? "Error" : "Done"}
				</span>
				{hasDetails && (
					<span className="aui-tool-call-chevron" aria-hidden="true">
						{isExpanded ? "▴" : "▾"}
					</span>
				)}
			</button>

			{isExpanded && hasDetails && (
				<div className="aui-tool-call-body">
					{args && Object.keys(args).length > 0 && (
						<div className="aui-tool-call-section">
							<span className="aui-tool-call-section-label">Input / Parameters</span>
							<pre className="aui-tool-call-pre">{JSON.stringify(args, null, 2)}</pre>
						</div>
					)}
					{result !== undefined && result !== "Completed" && (
						<div className="aui-tool-call-section">
							<span className="aui-tool-call-section-label">Output / Result</span>
							<pre className="aui-tool-call-pre">
								{typeof result === "string" ? result : JSON.stringify(result, null, 2)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Renders ChainOfThoughtPrimitive container for grouped reasoning + tool call steps.
 */
export function AssistantChainOfThought() {
	return (
		<ChainOfThoughtPrimitive.Root className="aui-cot-root" data-testid="aui-chain-of-thought">
			<div className="aui-cot-header-row">
				<ChainOfThoughtPrimitive.AccordionTrigger className="aui-cot-trigger">
					<VSCodeGearIcon size={12} spin={false} className="inline mr-1 text-indigo-400" />
					<span>Agent Execution Steps & Reasoning</span>
				</ChainOfThoughtPrimitive.AccordionTrigger>
			</div>
			<div className="aui-cot-parts">
				<ChainOfThoughtPrimitive.Parts
					components={{
						Reasoning: AssistantReasoningPart,
						tools: {
							Fallback: AssistantToolCallPart,
						},
					}}
				/>
			</div>
		</ChainOfThoughtPrimitive.Root>
	)
}

/**
 * Renders an Assistant turn using @assistant-ui/react primitives (`AssistantRuntimeProvider`,
 * `ThreadPrimitive`, `MessagePrimitive`, `ChainOfThoughtPrimitive`), styled as a standardized
 * agent process turn rather than a basic chat bubble.
 */
export function AssistantProcessTurn({ message, onSuggestion, usedSuggestion }) {
	const [copied, setCopied] = useState(false)
	const meta = message.metadata || {}
	const botBodyHtml = useMemo(
		() => (message.body ? renderMarkdown(message.body) : ""),
		[message.body],
	)

	const handleCopy = useCallback(async () => {
		if (message?.body) {
			try {
				await navigator.clipboard.writeText(message.body)
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			} catch {
				// Ignore clipboard failure
			}
		}
	}, [message?.body])

	const singleMessageList = useMemo(() => [message], [message])
	const convertMessage = useCallback((m) => convertToAssistantMessage(m), [])

	const runtime = useExternalStoreRuntime({
		isRunning: false,
		messages: singleMessageList,
		convertMessage,
		onNew: async () => {},
	})

	const toolParts = useMemo(
		() => extractToolCallParts(meta, String(message.id || "m")),
		[meta, message.id],
	)
	const reasoningText = meta.thinking || meta.reasoning || meta.thought || ""
	const stepTitle = meta.step || meta.current_step || meta.action || ""
	const planSteps = Array.isArray(meta.plan)
		? meta.plan
		: Array.isArray(meta.plan?.steps)
			? meta.plan.steps
			: []
	const changesetFiles = Array.isArray(meta.changeset?.files)
		? meta.changeset.files
		: Array.isArray(meta.changeset)
			? meta.changeset
			: []
	const subagents = Array.isArray(meta.subagents) ? meta.subagents : []

	const actions =
		message.content_type === "actions" && Array.isArray(meta.actions) ? meta.actions : []

	const hasProcessMetadata =
		Boolean(reasoningText) ||
		toolParts.length > 0 ||
		Boolean(stepTitle) ||
		planSteps.length > 0 ||
		changesetFiles.length > 0 ||
		subagents.length > 0

	const TextPartComponent = useCallback(
		() => (
			<div className="msg-bubble msg-bubble--bot aui-process-output">
				<div
					className="msg-text msg-text--markdown"
					dangerouslySetInnerHTML={{ __html: botBodyHtml }}
				/>
				{message.model && (
					<span className="msg-model">
						{message.model}
						{message.context_size
							? ` (${message.context_size >= 1000 ? `${Math.round(message.context_size / 1000)}k` : message.context_size})`
							: ""}
					</span>
				)}
			</div>
		),
		[botBodyHtml, message.model, message.context_size],
	)

	const partComponents = useMemo(
		() => ({
			Reasoning: AssistantReasoningPart,
			tools: {
				Fallback: AssistantToolCallPart,
			},
			Text: TextPartComponent,
		}),
		[TextPartComponent],
	)

	const AssistantMessageRenderer = useCallback(
		() => (
			<MessagePrimitive.Root className="aui-message-root">
				<MessagePrimitive.Parts components={partComponents} />
			</MessagePrimitive.Root>
		),
		[partComponents],
	)

	const botAvatarSvg = (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
			<path
				d="M12 2a7 7 0 00-7 7v1a2 2 0 00-2 2v2a2 2 0 002 2h1a7 7 0 0012 0h1a2 2 0 002-2v-2a2 2 0 00-2-2V9a7 7 0 00-7-7z"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<circle cx="9" cy="11" r="1.25" fill="currentColor" />
			<circle cx="15" cy="11" r="1.25" fill="currentColor" />
		</svg>
	)

	return (
		<div className="msg msg--bot aui-agent-turn" data-testid="aui-agent-turn">
			<div className="msg-avatar aui-agent-avatar">{botAvatarSvg}</div>
			<div className="msg-content aui-agent-content">
				{/* Standardized Agent Process Header Bar */}
				<div className="aui-turn-header">
					<span className="aui-turn-badge">
						<VSCodeWorkingStateIcon status="idle" size={11} className="inline-flex mr-1" />
						Agent Output
					</span>
					{stepTitle && (
						<span className="aui-turn-step" title={stepTitle}>
							{stepTitle}
						</span>
					)}
					{toolParts.length > 0 && (
						<span className="aui-turn-meta-chip">
							<SettingsIcon size={12} className="inline mr-1" />
							{toolParts.length} {toolParts.length === 1 ? "process" : "processes"}
						</span>
					)}
					{subagents.length > 0 && (
						<span className="aui-turn-meta-chip aui-turn-meta-chip--subagent">
							<BotIcon size={12} className="inline mr-1" />
							{subagents.length} {subagents.length === 1 ? "subagent" : "subagents"}
						</span>
					)}
					{changesetFiles.length > 0 && (
						<span
							className="aui-turn-meta-chip"
							title={changesetFiles
								.map((f) => (typeof f === "string" ? f : f.path || f.file))
								.join(", ")}
						>
							<FolderIcon size={12} className="inline mr-1" />
							{changesetFiles.length} {changesetFiles.length === 1 ? "file" : "files"}
						</span>
					)}
					{hasProcessMetadata && (
						<span className="aui-turn-status-done">
							<CheckIcon size={11} className="inline mr-1" />
							Completed
						</span>
					)}
					{message.body && (
						<button
							type="button"
							className="aui-turn-copy-btn"
							onClick={handleCopy}
							title={copied ? "Copied response to clipboard" : "Copy response"}
							aria-label="Copy response"
						>
							{copied ? (
								<>
									<CheckIcon size={12} className="inline mr-1" />
									Copied
								</>
							) : (
								<>
									<FileCheckIcon size={12} className="inline mr-1" />
									Copy
								</>
							)}
						</button>
					)}
				</div>

				{/* Plan steps if included in turn metadata */}
				{planSteps.length > 0 && (
					<div className="aui-turn-plan" data-testid="aui-turn-plan">
						<div className="aui-turn-plan__title">
							<LayersIcon size={13} className="inline mr-1" />
							Execution Plan
						</div>
						<ul className="aui-turn-plan__list">
							{planSteps.map((stepItem, i) => {
								const text =
									typeof stepItem === "string"
										? stepItem
										: stepItem.title ||
											stepItem.step ||
											stepItem.description ||
											JSON.stringify(stepItem)
								const done =
									typeof stepItem === "object" &&
									(stepItem.done || stepItem.status === "completed" || stepItem.completed)
								return (
									<li
										key={i}
										className={`aui-turn-plan__item ${done ? "aui-turn-plan__item--done" : ""}`}
									>
										<span className="aui-turn-plan__check">
											{done ? <CheckIcon size={12} className="inline" /> : "•"}
										</span>
										<span>{text}</span>
									</li>
								)
							})}
						</ul>
					</div>
				)}

				{/* @assistant-ui/react Thread & Message Primitives */}
				<AssistantRuntimeProvider runtime={runtime}>
					<ThreadPrimitive.Root className="aui-thread-primitive">
						<ThreadPrimitive.Messages
							components={{
								UserMessage: () => null,
								AssistantMessage: AssistantMessageRenderer,
							}}
						/>
					</ThreadPrimitive.Root>
				</AssistantRuntimeProvider>

				{message.content_type === "image" && meta.url && (
					<div className="msg-bubble msg-bubble--bot">
						<img src={meta.url} alt="Bot shared image" className="msg-image" />
					</div>
				)}
				{message.content_type === "file" && meta.url && (
					<div className="msg-bubble msg-bubble--bot">
						<div className="msg-file">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
								<path
									d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								<path
									d="M13 2v7h7"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<a href={meta.url} download={meta.filename} className="msg-file-link">
								{meta.filename || "File"}
							</a>
						</div>
					</div>
				)}
				{actions.length > 0 && (
					<div className="msg-suggestions">
						{actions.map((action, index) => {
							const label = typeof action === "string" ? action : action.label
							const value = typeof action === "string" ? action : (action.value ?? action.label)
							const isUsed = usedSuggestion === value
							const isDisabled = usedSuggestion !== undefined

							return (
								<button
									key={index}
									type="button"
									disabled={isDisabled}
									onClick={() => !isDisabled && onSuggestion && onSuggestion(value)}
									className={[
										"suggestion-chip",
										isUsed ? "suggestion-chip--used" : "",
										isDisabled && !isUsed ? "suggestion-chip--dismissed" : "",
									]
										.filter(Boolean)
										.join(" ")}
									aria-pressed={isUsed}
								>
									{isUsed && (
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none">
											<path
												d="M5 12h14M13 6l6 6-6 6"
												stroke="currentColor"
												strokeWidth="2.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
									{label}
									{isUsed && <span className="suggestion-chip__sent">Sent</span>}
								</button>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
