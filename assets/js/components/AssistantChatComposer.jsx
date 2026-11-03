import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	ComposerPrimitive,
} from "@assistant-ui/react"
import PromptQueue from "./PromptQueue.jsx"
import AgentPromptControls from "./AgentPromptControls.jsx"

export const AGENT_TYPES = [
	{ id: "general", label: "Auto", icon: "🤖", title: "General Assistant (Adaptive)" },
	{ id: "coder", label: "Coder", icon: "💻", title: "Full-Stack Coding & Implementation" },
	{ id: "researcher", label: "Researcher", icon: "🔍", title: "Codebase & Architecture Analysis" },
	{ id: "architect", label: "Architect", icon: "📐", title: "System Design & Schemas" },
	{ id: "debugger", label: "Debugger", icon: "🐞", title: "Troubleshooting & Test Verification" },
	{ id: "reviewer", label: "Reviewer", icon: "📝", title: "Code Review & Standards Audit" },
]

export const SKILLS = [
	{ id: "none", label: "Standard", icon: "⚡", title: "Standard Skills" },
	{ id: "code_review", label: "Review", icon: "👀", title: "Code Review & Quality Check" },
	{ id: "refactor", label: "Refactor", icon: "🧹", title: "Code Modernization & Refactoring" },
	{ id: "testing", label: "Testing", icon: "🧪", title: "Unit & Integration Tests" },
	{ id: "docs", label: "Docs", icon: "📖", title: "Documentation & ADRs" },
	{ id: "perf", label: "Performance", icon: "🚀", title: "Speed & Query Optimization" },
	{ id: "security", label: "Security", icon: "🛡️", title: "Defensive Coding & Hardening" },
	{ id: "a11y", label: "A11y", icon: "♿", title: "Accessibility & WCAG Compliance" },
]

export default function AssistantChatComposer({
	value = "",
	onChange,
	onSubmit,
	onSteerSubmit,
	disabled = false,
	uploading = false,
	effectiveStatus = "idle",
	isAgentBusy = false,
	effectiveMetadata = {},
	models = [],
	selectedModel = "",
	onSelectModel,
	selectedContextSize = "",
	onSelectContextSize,
	selectedAgentType = "general",
	onSelectAgentType,
	selectedSkill = "none",
	onSelectSkill,
	attachments = [],
	onAddAttachments,
	onRemoveAttachment,
	promptQueue = [],
	onRemovePrompt,
	onViewProgress,
	onStop,
	inputRef: externalInputRef,
	modes,
	agentMode = "interactive",
	onModeChange,
	worktreeSupported = true,
	useWorktree = false,
	onWorktreeChange,
	baseBranch = "main",
	onBaseBranchChange,
	availableBranches = [],
	agentTypes = ["workspace", "coder", "architect", "reviewer"],
	isAHP = true,
	showPromptControls = true,
}) {
	const internalInputRef = useRef(null)
	const inputRef = externalInputRef || internalInputRef
	const fileInputRef = useRef(null)

	const [isDragging, setIsDragging] = useState(false)
	const [showAgentMenu, setShowAgentMenu] = useState(false)
	const [showSkillMenu, setShowSkillMenu] = useState(false)

	// Close dropdown menus when clicking outside
	useEffect(() => {
		function handleClickOutside(e) {
			if (!e.target.closest(".composer-dropdown-wrapper")) {
				setShowAgentMenu(false)
				setShowSkillMenu(false)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	// Setup @assistant-ui runtime binding
	const runtime = useExternalStoreRuntime({
		isRunning: isAgentBusy,
		messages: [],
		onNew: async (msg) => {
			if (onSubmit) {
				onSubmit(msg)
			}
		},
	})

	const handleFormSubmit = useCallback(
		(e) => {
			if (e) e.preventDefault()
			if (onSubmit) {
				onSubmit(e)
			}
		},
		[onSubmit],
	)

	const handleKeyDown = useCallback(
		(e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleFormSubmit(e)
			}
		},
		[handleFormSubmit],
	)

	const handleFileChange = useCallback(
		(e) => {
			const files = Array.from(e.target.files || [])
			if (files.length > 0 && onAddAttachments) {
				onAddAttachments(files)
			}
			if (e.target) {
				e.target.value = ""
			}
		},
		[onAddAttachments],
	)

	const handleDragOver = useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragLeave = useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = useCallback(
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragging(false)
			const files = Array.from(e.dataTransfer?.files || [])
			if (files.length > 0 && onAddAttachments) {
				onAddAttachments(files)
			}
		},
		[onAddAttachments],
	)

	const activeAgent = useMemo(
		() => AGENT_TYPES.find((a) => a.id === selectedAgentType) || AGENT_TYPES[0],
		[selectedAgentType],
	)

	const activeSkill = useMemo(
		() => SKILLS.find((s) => s.id === selectedSkill) || SKILLS[0],
		[selectedSkill],
	)

	const currentModelObj = useMemo(
		() => models.find((m) => m.name === selectedModel),
		[models, selectedModel],
	)

	const placeholder = useMemo(() => {
		if (effectiveStatus === "waiting_for_input" || effectiveStatus === "needs_input") {
			return "Agent is waiting for your input to continue..."
		}
		if (effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy) {
			return "Steer running agent with an instruction (or ask a question)..."
		}
		if (agentMode === "plan") {
			return "Plan mode: Describe the feature or changes you want planned..."
		}
		if (agentMode === "autopilot") {
			return "Autopilot mode: Describe what to build or fix autonomously..."
		}
		return "What do you want to know?"
	}, [effectiveStatus, isAgentBusy, agentMode])

	const isSubmitDisabled = disabled || uploading || (!value.trim() && attachments.length === 0)

	return (
		<div
			className={`chat-input-area ${isDragging ? "chat-input-area--dragging" : ""}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			data-testid="assistant-chat-composer"
		>
			{/* Prompt Queue Chips */}
			<PromptQueue queue={promptQueue} onRemovePrompt={onRemovePrompt} />

			{/* Agent Steering & Live Progress Bar when Agent is Busy */}
			{(effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy) && (
				<div className="chat-steering-bar" data-testid="chat-steering-bar">
					<div className="chat-steering-info">
						<span className="chat-steering-pulse" />
						<span className="chat-steering-label">
							Agent is {effectiveStatus === "thinking" ? "thinking" : "running"}
						</span>
						{(effectiveMetadata?.step || effectiveMetadata?.tool || effectiveMetadata?.action) && (
							<span
								className="chat-steering-step"
								title={effectiveMetadata.step || effectiveMetadata.action || effectiveMetadata.tool}
							>
								{effectiveMetadata.step ||
									effectiveMetadata.action ||
									`Running ${effectiveMetadata.tool}...`}
							</span>
						)}
					</div>
					<div className="chat-steering-actions">
						{onViewProgress && (
							<button
								type="button"
								className="chat-steering-quick-btn chat-steering-quick-btn--jump"
								onClick={onViewProgress}
								title="Jump to live progress"
							>
								↓ View Progress
							</button>
						)}
						{onStop && (
							<button
								type="button"
								className="chat-steering-quick-btn chat-steering-quick-btn--stop"
								onClick={onStop}
								title="Stop agent"
							>
								⏹ Stop
							</button>
						)}
					</div>
				</div>
			)}

			{/* Agent Mode, Worktree, Base Branch, and Agent Type Controls */}
			{showPromptControls && (
				<AgentPromptControls
					modes={modes}
					mode={agentMode}
					onModeChange={onModeChange}
					worktreeSupported={worktreeSupported}
					useWorktree={useWorktree}
					onWorktreeChange={onWorktreeChange}
					baseBranch={baseBranch}
					availableBranches={availableBranches}
					onBaseBranchChange={onBaseBranchChange}
					agentType={selectedAgentType}
					onAgentTypeChange={onSelectAgentType}
					agentTypes={agentTypes}
					disabled={disabled || uploading}
					isAHP={isAHP}
				/>
			)}

			{/* @assistant-ui/react Root Form Container */}
			<AssistantRuntimeProvider runtime={runtime}>
				<ComposerPrimitive.Root
					id="message-form"
					onSubmit={handleFormSubmit}
					className={`chat-input-form aui-composer-form ${
						effectiveStatus === "waiting_for_input" || effectiveStatus === "needs_input"
							? "chat-input-form--waiting"
							: effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
								? "chat-input-form--running"
								: ""
					}`}
				>
					{/* Attachments / Image Preview Bar */}
					{attachments.length > 0 && (
						<div className="aui-composer-attachments" data-testid="aui-composer-attachments">
							{attachments.map((att) => (
								<div key={att.id} className="aui-attachment-card" title={att.name}>
									{att.previewUrl ? (
										<img src={att.previewUrl} alt={att.name} className="aui-attachment-thumb" />
									) : (
										<span className="aui-attachment-icon">📎</span>
									)}
									<div className="aui-attachment-info">
										<span className="aui-attachment-name">{att.name}</span>
										{att.size && (
											<span className="aui-attachment-size">{Math.round(att.size / 1024)} KB</span>
										)}
									</div>
									<button
										type="button"
										className="aui-attachment-remove"
										onClick={() => onRemoveAttachment && onRemoveAttachment(att.id)}
										title="Remove attachment"
										aria-label="Remove attachment"
									>
										✕
									</button>
								</div>
							))}
						</div>
					)}

					{/* Drag overlay notice */}
					{isDragging && (
						<div className="aui-composer-dropzone-overlay">
							<span className="aui-composer-dropzone-text">📸 Drop images or files to attach</span>
						</div>
					)}

					{/* Composer Input Area */}
					<ComposerPrimitive.Input
						id="message-input"
						ref={inputRef}
						className="chat-textarea aui-composer-input"
						placeholder={placeholder}
						value={value}
						onChange={(e) => onChange && onChange(e.target.value)}
						rows={1}
						onKeyDown={handleKeyDown}
						onInput={(e) => {
							e.target.style.height = "auto"
							e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px"
						}}
					/>

					{/* Actions Toolbar */}
					<div className="chat-input-actions aui-composer-toolbar">
						<div className="chat-input-left aui-composer-controls">
							{/* Hidden File Input for Attachments */}
							<input
								type="file"
								id="file-input"
								ref={fileInputRef}
								className="file-input"
								onChange={handleFileChange}
								accept="image/*,.pdf"
								multiple
								aria-label="Upload file"
							/>
							<label
								htmlFor="file-input"
								className="file-input-btn aui-toolbar-btn"
								title="Add images or attachments"
								aria-label="Add image attachment"
							>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</label>

							{/* Model Selector Dropdown */}
							<div className="aui-model-group">
								<select
									id="model-select"
									className="model-picker aui-select"
									value={selectedModel}
									onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
									aria-label="Model"
								>
									{models.map((m) => (
										<option key={m.name} value={m.name}>
											{m.name}
										</option>
									))}
								</select>

								{/* Context Window Size Selector */}
								{currentModelObj?.context_sizes?.length > 0 && (
									<select
										id="context-size-select"
										className="model-picker aui-select"
										value={selectedContextSize}
										onChange={(e) => onSelectContextSize && onSelectContextSize(e.target.value)}
										aria-label="Context Size"
									>
										<option value="">Default context</option>
										{currentModelObj.context_sizes.map((size) => (
											<option key={size} value={size}>
												{size >= 1000
													? `${Math.round(size / 1000)}k (${size.toLocaleString()} tokens)`
													: `${size} tokens`}
											</option>
										))}
									</select>
								)}
							</div>

							{/* Agent Type Selector Dropdown / Pill */}
							<div className="composer-dropdown-wrapper">
								<button
									type="button"
									className="aui-pill-btn"
									onClick={() => {
										setShowAgentMenu(!showAgentMenu)
										setShowSkillMenu(false)
									}}
									title={`Selected Agent Type: ${activeAgent.title}`}
									aria-label="Select agent type"
									data-testid="agent-type-picker"
								>
									<span className="aui-pill-icon">{activeAgent.icon}</span>
									<span className="aui-pill-label">{activeAgent.label}</span>
									<span className="aui-pill-caret">▾</span>
								</button>

								{showAgentMenu && (
									<div className="aui-dropdown-menu" data-testid="agent-type-menu">
										<div className="aui-dropdown-header">Agent Type</div>
										{AGENT_TYPES.map((agent) => (
											<button
												key={agent.id}
												type="button"
												className={`aui-dropdown-item ${selectedAgentType === agent.id ? "aui-dropdown-item--active" : ""}`}
												onClick={() => {
													onSelectAgentType && onSelectAgentType(agent.id)
													setShowAgentMenu(false)
												}}
											>
												<span className="aui-item-icon">{agent.icon}</span>
												<div className="aui-item-text">
													<div className="aui-item-title">{agent.label}</div>
													<div className="aui-item-desc">{agent.title}</div>
												</div>
												{selectedAgentType === agent.id && (
													<span className="aui-item-check">✓</span>
												)}
											</button>
										))}
									</div>
								)}
							</div>

							{/* Skill Selector Dropdown / Pill */}
							<div className="composer-dropdown-wrapper">
								<button
									type="button"
									className="aui-pill-btn"
									onClick={() => {
										setShowSkillMenu(!showSkillMenu)
										setShowAgentMenu(false)
									}}
									title={`Selected Skill: ${activeSkill.title}`}
									aria-label="Select skill"
									data-testid="skill-picker"
								>
									<span className="aui-pill-icon">{activeSkill.icon}</span>
									<span className="aui-pill-label">{activeSkill.label}</span>
									<span className="aui-pill-caret">▾</span>
								</button>

								{showSkillMenu && (
									<div className="aui-dropdown-menu" data-testid="skill-menu">
										<div className="aui-dropdown-header">Specialized Skill</div>
										{SKILLS.map((skill) => (
											<button
												key={skill.id}
												type="button"
												className={`aui-dropdown-item ${selectedSkill === skill.id ? "aui-dropdown-item--active" : ""}`}
												onClick={() => {
													onSelectSkill && onSelectSkill(skill.id)
													setShowSkillMenu(false)
												}}
											>
												<span className="aui-item-icon">{skill.icon}</span>
												<div className="aui-item-text">
													<div className="aui-item-title">{skill.label}</div>
													<div className="aui-item-desc">{skill.title}</div>
												</div>
												{selectedSkill === skill.id && <span className="aui-item-check">✓</span>}
											</button>
										))}
									</div>
								)}
							</div>
						</div>

						{/* Right Action Buttons */}
						<div className="chat-send-actions">
							{/* Steer action button if agent is busy */}
							{(effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy) && (
								<button
									type="button"
									className={`steer-action-btn ${value.trim() ? "steer-action-btn--active" : ""}`}
									onClick={onSteerSubmit}
									disabled={disabled || !value.trim()}
									title="Steer agent with this message"
									data-testid="steer-agent-btn"
								>
									🧭 Steer Agent
								</button>
							)}

							{/* @assistant-ui / Send Button */}
							<button
								type="submit"
								onClick={handleFormSubmit}
								className={`send-btn ${!isSubmitDisabled ? "send-btn--active" : ""} ${
									effectiveStatus === "waiting_for_input" || effectiveStatus === "needs_input"
										? "send-btn--waiting"
										: effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
											? "send-btn--steer"
											: ""
								}`}
								disabled={isSubmitDisabled}
								aria-label={
									effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
										? "Steer agent"
										: "Send message"
								}
								title={
									effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
										? "Steer agent with message (Enter)"
										: "Send message (Enter)"
								}
							>
								{uploading ? (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
										<circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.3" />
										<circle cx="12" cy="12" r="1" fill="currentColor" />
									</svg>
								) : (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
										<path
											d="M12 19V5M5 12l7-7 7 7"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								)}
							</button>
						</div>
					</div>
				</ComposerPrimitive.Root>
			</AssistantRuntimeProvider>
		</div>
	)
}
