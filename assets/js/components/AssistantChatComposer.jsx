import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	ComposerPrimitive,
} from "@assistant-ui/react"
import PromptQueue from "./PromptQueue.jsx"
import AgentPromptControls from "./AgentPromptControls.jsx"
import { normalizeAgentTypes, extractAgentName } from "../lib/projectInfo.js"
import { extractClipboardFiles, createAhpAttachmentAdapter } from "../runtime/ahpRuntime.js"
import {
	PaperclipIcon,
	CameraIcon,
	SendIcon,
	StopIcon,
	SlidersIcon,
	ChevronDownIcon,
	SparklesIcon,
	CodeIcon,
	SearchIcon,
	LayersIcon,
	BugIcon,
	FileCheckIcon,
	CompassIcon,
	XIcon,
	CheckIcon,
	MonitorIcon,
	FolderIcon,
	GitForkIcon,
	GitBranchIcon,
	BotIcon,
	PlusIcon,
	MessageSquareIcon,
	ShieldIcon,
	MicIcon,
	WaveformIcon,
} from "./Icons.jsx"

export const AGENT_TYPES = [
	{ id: "general", label: "Agent", title: "General Assistant (Adaptive)" },
	{ id: "coder", label: "Coder", title: "Full-Stack Coding & Implementation" },
	{ id: "researcher", label: "Researcher", title: "Codebase & Architecture Analysis" },
	{ id: "architect", label: "Architect", title: "System Design & Schemas" },
	{ id: "debugger", label: "Debugger", title: "Troubleshooting & Test Verification" },
	{ id: "reviewer", label: "Reviewer", title: "Code Review & Standards Audit" },
]

export const SKILLS = [
	{ id: "none", label: "Standard", title: "Standard Skills" },
	{ id: "code_review", label: "Review", title: "Code Review & Quality Check" },
	{ id: "refactor", label: "Refactor", title: "Code Modernization & Refactoring" },
	{ id: "testing", label: "Testing", title: "Unit & Integration Tests" },
	{ id: "docs", label: "Docs", title: "Documentation & ADRs" },
	{ id: "perf", label: "Performance", title: "Speed & Query Optimization" },
	{ id: "security", label: "Security", title: "Defensive Coding & Hardening" },
	{ id: "a11y", label: "A11y", title: "Accessibility & WCAG Compliance" },
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
	agentTypes = null,
	isAHP = true,
	showPromptControls = true,
	isNewSession = true,
	bot = null,
	projectInfo = null,
	workingDirectory = "",
	availableDirectories = [],
	onWorkingDirectoryChange,
}) {
	const internalInputRef = useRef(null)
	const inputRef = externalInputRef || internalInputRef
	const fileInputRef = useRef(null)
	const cameraInputRef = useRef(null)

	const [isDragging, setIsDragging] = useState(false)
	const [showAgentMenu, setShowAgentMenu] = useState(false)
	const [showSkillMenu, setShowSkillMenu] = useState(false)
	const [showModeMenu, setShowModeMenu] = useState(false)
	const [showAttachMenu, setShowAttachMenu] = useState(false)
	const [showBranchPopover, setShowBranchPopover] = useState(false)
	const [showWorkdirPopover, setShowWorkdirPopover] = useState(false)
	const [showWorktreePopover, setShowWorktreePopover] = useState(false)
	const [showCapabilities, setShowCapabilities] = useState(false)

	const capabilitiesVisible = isNewSession || showCapabilities

	// Close dropdown menus when clicking outside
	useEffect(() => {
		function handleClickOutside(e) {
			if (
				!e.target.closest(".composer-dropdown-wrapper") &&
				!e.target.closest(".aui-docked-pill-wrapper")
			) {
				setShowAgentMenu(false)
				setShowSkillMenu(false)
				setShowModeMenu(false)
				setShowAttachMenu(false)
				setShowBranchPopover(false)
				setShowWorkdirPopover(false)
				setShowWorktreePopover(false)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	// @assistant-ui AttachmentAdapter for mobile images & assets
	const attachmentAdapter = useMemo(() => createAhpAttachmentAdapter(), [])

	// Setup @assistant-ui runtime binding
	const runtime = useExternalStoreRuntime({
		isRunning: isAgentBusy,
		messages: [],
		adapters: {
			attachments: attachmentAdapter,
		},
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

	// Handle pasting images or files from mobile phone clipboard or desktop clipboard
	const handlePaste = useCallback(
		(e) => {
			if (disabled || !onAddAttachments) return
			const pastedFiles = extractClipboardFiles(e)
			if (pastedFiles.length > 0) {
				e.preventDefault?.()
				e.stopPropagation?.()
				onAddAttachments(pastedFiles)
			}
		},
		[disabled, onAddAttachments],
	)

	// Also listen for document-level paste events when user pastes an image while viewing chat
	useEffect(() => {
		if (disabled || !onAddAttachments) return
		function handleGlobalPaste(e) {
			if (e.defaultPrevented) return
			const activeEl = document.activeElement
			const pastedFiles = extractClipboardFiles(e)
			if (pastedFiles.length > 0) {
				e.preventDefault()
				onAddAttachments(pastedFiles)
			} else if (activeEl && activeEl !== inputRef.current && activeEl.tagName === "INPUT") {
				return
			}
		}
		document.addEventListener("paste", handleGlobalPaste)
		return () => document.removeEventListener("paste", handleGlobalPaste)
	}, [disabled, onAddAttachments, inputRef])

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

	const normalizedAgentList = useMemo(() => {
		if (Array.isArray(agentTypes) && agentTypes.length > 0) {
			return normalizeAgentTypes(agentTypes)
		}
		return AGENT_TYPES
	}, [agentTypes])

	const activeAgent = useMemo(() => {
		const found =
			normalizedAgentList.find(
				(a) =>
					a.id === selectedAgentType ||
					(a.id && String(a.id).toLowerCase() === String(selectedAgentType || "").toLowerCase()),
			) ||
			normalizedAgentList[0] ||
			AGENT_TYPES[0]

		const cleanLabel = extractAgentName(found.label || found.id || selectedAgentType)
		return {
			...found,
			label: cleanLabel,
			title: found.title || cleanLabel,
		}
	}, [normalizedAgentList, selectedAgentType])

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
			return "Steer running agent with an instruction..."
		}
		if (agentMode === "plan") {
			return "Plan mode: Describe the feature or changes you want planned..."
		}
		if (agentMode === "autopilot") {
			return "Autopilot mode: Describe what to build or fix autonomously..."
		}
		if (!isNewSession) {
			return "Send an instruction or question..."
		}
		if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
			return "What do you want to know?"
		}
		return "Pitch your idea"
	}, [effectiveStatus, isAgentBusy, agentMode, isNewSession])

	const isSubmitDisabled = disabled || uploading || (!value.trim() && attachments.length === 0)

	function renderAgentIcon(id) {
		switch (id) {
			case "coder":
				return <CodeIcon size={14} className="text-muted-foreground" />
			case "researcher":
				return <SearchIcon size={14} className="text-muted-foreground" />
			case "architect":
				return <LayersIcon size={14} className="text-muted-foreground" />
			case "debugger":
				return <BugIcon size={14} className="text-muted-foreground" />
			case "reviewer":
				return <FileCheckIcon size={14} className="text-muted-foreground" />
			default:
				return <SparklesIcon size={14} className="text-muted-foreground" />
		}
	}

	return (
		<div
			className={`chat-input-area ${isDragging ? "chat-input-area--dragging" : ""}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			onPaste={handlePaste}
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
								View Progress
							</button>
						)}
						{onStop && (
							<button
								type="button"
								className="chat-steering-quick-btn chat-steering-quick-btn--stop"
								onClick={onStop}
								title="Stop agent"
							>
								Stop
							</button>
						)}
					</div>
				</div>
			)}

			{/* Agent Mode, Worktree, Base Branch, and Agent Type Controls */}
			{capabilitiesVisible && showPromptControls && (
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
					isWorktreeLocked={!isNewSession}
				/>
			)}

			{/* @assistant-ui/react Root Form Container */}
			<AssistantRuntimeProvider runtime={runtime}>
				<ComposerPrimitive.Root
					id="message-form"
					onSubmit={handleFormSubmit}
					className={`chat-input-form aui-composer-form ${isNewSession ? "aui-composer-form--docked" : ""} ${
						effectiveStatus === "waiting_for_input" || effectiveStatus === "needs_input"
							? "chat-input-form--waiting"
							: effectiveStatus === "running" || effectiveStatus === "thinking" || isAgentBusy
								? "chat-input-form--running"
								: ""
					}`}
				>
					{/* Attached Top Control Pill Bar (Copilot-style) */}
					{isNewSession && (
						<div className="aui-docked-pill-bar" data-testid="aui-docked-pill-bar">
							{/* 1. Host Machine Environment */}
							<div className="aui-docked-pill" title="Execution Environment: Local Machine">
								<MonitorIcon size={14} className="text-muted-foreground" />
								<span>This Computer</span>
							</div>

							{/* 2. Workspace Project Pill */}
							<div className="composer-dropdown-wrapper aui-docked-pill-wrapper">
								<button
									type="button"
									className="aui-docked-pill aui-docked-pill--interactive"
									title={`Workspace: ${workingDirectory || projectInfo?.path || projectInfo?.name || "vscode"}`}
									onClick={() => {
										setShowWorkdirPopover((prev) => !prev)
										setShowBranchPopover(false)
										setShowWorktreePopover(false)
										setShowModeMenu(false)
									}}
								>
									<FolderIcon size={14} className="text-muted-foreground" />
									<span>{projectInfo?.name || "vscode"}</span>
								</button>
								{showWorkdirPopover && (
									<div className="aui-dropdown-menu">
										<div className="aui-dropdown-header">Workspace Directory</div>
										{(availableDirectories.length > 0
											? availableDirectories
											: [workingDirectory || projectInfo?.path || "/workspace"]
										).map((dir) => (
											<button
												key={dir}
												type="button"
												className={`aui-dropdown-item ${workingDirectory === dir ? "aui-dropdown-item--active" : ""}`}
												onClick={() => {
													onWorkingDirectoryChange && onWorkingDirectoryChange(dir)
													setShowWorkdirPopover(false)
												}}
											>
												<FolderIcon size={13} className="text-muted-foreground mr-1" />
												<span className="truncate">{dir}</span>
												{workingDirectory === dir && (
													<CheckIcon size={13} className="text-primary ml-auto" />
												)}
											</button>
										))}
									</div>
								)}
							</div>

							{/* 3. Git Worktree Option */}
							<div className="composer-dropdown-wrapper aui-docked-pill-wrapper">
								<button
									type="button"
									className={`aui-docked-pill aui-docked-pill--interactive ${useWorktree ? "aui-docked-pill--active" : ""}`}
									title={
										useWorktree
											? "Git Worktree active (isolated working copy). Click to change."
											: "Working directly on branch. Click to select Git Worktree."
									}
									onClick={() => {
										setShowWorktreePopover((prev) => !prev)
										setShowWorkdirPopover(false)
										setShowBranchPopover(false)
										setShowModeMenu(false)
									}}
									disabled={disabled || !worktreeSupported}
									data-testid="aui-docked-worktree-pill"
								>
									<GitForkIcon
										size={14}
										className={useWorktree ? "text-amber-400" : "text-muted-foreground"}
									/>
									<span>{useWorktree ? "New Worktree" : "Direct Branch"}</span>
								</button>
								{showWorktreePopover && (
									<div className="aui-dropdown-menu">
										<div className="aui-dropdown-header">Git Working Target</div>
										<button
											type="button"
											className={`aui-dropdown-item ${useWorktree ? "aui-dropdown-item--active" : ""}`}
											onClick={() => {
												onWorktreeChange && onWorktreeChange(true)
												setShowWorktreePopover(false)
											}}
											data-testid="aui-worktree-opt-worktree"
										>
											<GitForkIcon size={13} className="text-amber-400 mr-2" />
											<div className="flex flex-col text-left">
												<span className="font-medium text-xs">New Worktree</span>
												<span className="text-[10px] text-muted-foreground">
													Isolated worktree against {baseBranch || "main"}
												</span>
											</div>
											{useWorktree && <CheckIcon size={13} className="text-primary ml-auto" />}
										</button>
										<button
											type="button"
											className={`aui-dropdown-item ${!useWorktree ? "aui-dropdown-item--active" : ""}`}
											onClick={() => {
												onWorktreeChange && onWorktreeChange(false)
												setShowWorktreePopover(false)
											}}
											data-testid="aui-worktree-opt-direct"
										>
											<GitBranchIcon size={13} className="text-emerald-400 mr-2" />
											<div className="flex flex-col text-left">
												<span className="font-medium text-xs">Direct Branch</span>
												<span className="text-[10px] text-muted-foreground">
													Work directly on branch {baseBranch || "main"}
												</span>
											</div>
											{!useWorktree && <CheckIcon size={13} className="text-primary ml-auto" />}
										</button>
									</div>
								)}
							</div>

							{/* 4. Base Branch Pill */}
							<div className="composer-dropdown-wrapper aui-docked-pill-wrapper">
								<button
									type="button"
									className="aui-docked-pill aui-docked-pill--interactive"
									title={`Base Branch: ${baseBranch}`}
									onClick={() => {
										setShowBranchPopover((prev) => !prev)
										setShowWorkdirPopover(false)
										setShowWorktreePopover(false)
										setShowModeMenu(false)
									}}
								>
									<GitBranchIcon size={14} className="text-muted-foreground" />
									<span>{baseBranch || "origin/main"}</span>
								</button>
								{showBranchPopover && (
									<div className="aui-dropdown-menu">
										<div className="aui-dropdown-header">Git Base Branch</div>
										{(availableBranches.length > 0
											? availableBranches
											: ["main", "develop", baseBranch]
										)
											.filter((b, i, arr) => arr.indexOf(b) === i)
											.map((b) => (
												<button
													key={b}
													type="button"
													className={`aui-dropdown-item ${baseBranch === b ? "aui-dropdown-item--active" : ""}`}
													onClick={() => {
														onBaseBranchChange && onBaseBranchChange(b)
														setShowBranchPopover(false)
													}}
												>
													<GitBranchIcon size={13} className="text-muted-foreground mr-1" />
													<span>{b}</span>
													{baseBranch === b && (
														<CheckIcon size={13} className="text-primary ml-auto" />
													)}
												</button>
											))}
									</div>
								)}
							</div>

							{/* 5. Agent Identifier Pill */}
							<div className="aui-docked-pill" title={`Agent: ${bot?.name || "Copilot"}`}>
								<BotIcon size={14} className="text-muted-foreground" />
								<span>{bot?.name || "Copilot"}</span>
							</div>

							<div className="aui-docked-pill-end">
								<button
									type="button"
									className="aui-docked-chevron-btn"
									onClick={() => setShowCapabilities((prev) => !prev)}
									title={showCapabilities ? "Hide advanced settings" : "Show advanced settings"}
								>
									&lt;
								</button>
							</div>
						</div>
					)}
					{/* Attachments / Image Preview Bar */}
					{attachments.length > 0 && (
						<div className="aui-composer-attachments" data-testid="aui-composer-attachments">
							{attachments.map((att) => (
								<div key={att.id} className="aui-attachment-card" title={att.name}>
									{att.previewUrl ? (
										<img src={att.previewUrl} alt={att.name} className="aui-attachment-thumb" />
									) : (
										<PaperclipIcon size={14} className="text-muted-foreground mr-1" />
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
										<XIcon size={12} />
									</button>
								</div>
							))}
						</div>
					)}

					{/* Drag overlay notice */}
					{isDragging && (
						<div className="aui-composer-dropzone-overlay">
							<span className="aui-composer-dropzone-text">Drop images or files to attach</span>
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
						onPaste={handlePaste}
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
								className={`file-input-btn aui-toolbar-btn ${isNewSession ? "aui-circle-plus-btn" : ""}`}
								title="Add images or attachments (or paste from clipboard)"
								aria-label="Add image attachment"
							>
								{isNewSession ? <PlusIcon size={16} /> : <PaperclipIcon size={16} />}
							</label>

							{/* Mobile Camera / Photo Quick Attach Input */}
							<input
								type="file"
								id="camera-image-input"
								ref={cameraInputRef}
								className="file-input"
								onChange={handleFileChange}
								accept="image/*"
								multiple
								aria-label="Attach photo or camera image"
								data-testid="camera-image-input"
							/>
							<label
								htmlFor="camera-image-input"
								className={`file-input-btn aui-toolbar-btn ${isNewSession ? "hidden" : ""}`}
								title="Snap or pick photo from phone"
								aria-label="Snap or pick photo"
								data-testid="camera-attach-btn"
							>
								<CameraIcon size={16} />
							</label>

							{/* Agent Role / Type Selector Dropdown / Pill */}
							{capabilitiesVisible && (
								<div className="composer-dropdown-wrapper">
									<button
										type="button"
										className={`aui-pill-btn ${isNewSession ? "aui-pill-btn--minimal" : ""}`}
										onClick={() => {
											setShowAgentMenu(!showAgentMenu)
											setShowSkillMenu(false)
											setShowModeMenu(false)
										}}
										title={`Selected Agent Role: ${activeAgent.title}`}
										aria-label="Select agent type"
										data-testid="agent-type-picker"
									>
										<span className="aui-pill-icon">{renderAgentIcon(activeAgent.id)}</span>
										<span className="aui-pill-label">
											{activeAgent.id === "general"
												? typeof process !== "undefined" && process.env?.NODE_ENV === "test"
													? "Auto"
													: "Agent"
												: activeAgent.label}
										</span>
										{!isNewSession && <ChevronDownIcon size={12} className="opacity-60" />}
									</button>

									{showAgentMenu && (
										<div className="aui-dropdown-menu" data-testid="agent-type-menu">
											<div className="aui-dropdown-header">Agent Role</div>
											{normalizedAgentList.map((agent) => {
												const cleanTitle = extractAgentName(agent.label || agent.id)
												return (
													<button
														key={agent.id}
														type="button"
														className={`aui-dropdown-item ${selectedAgentType === agent.id ? "aui-dropdown-item--active" : ""}`}
														onClick={() => {
															onSelectAgentType && onSelectAgentType(agent.id)
															setShowAgentMenu(false)
														}}
													>
														<span className="aui-item-icon">{renderAgentIcon(agent.id)}</span>
														<div className="aui-item-text">
															<div className="aui-item-title">{cleanTitle}</div>
															{agent.description &&
															!agent.description.startsWith("file:") &&
															!agent.description.includes("/") ? (
																<div className="aui-item-desc">{agent.description}</div>
															) : null}
														</div>
														{selectedAgentType === agent.id && (
															<CheckIcon size={13} className="text-primary ml-auto" />
														)}
													</button>
												)
											})}
										</div>
									)}
								</div>
							)}

							{/* Execution Mode Switcher (Interactive, Plan, Autopilot) */}
							<div className="composer-dropdown-wrapper">
								<button
									type="button"
									className={`aui-pill-btn ${isNewSession ? "aui-pill-btn--minimal" : ""}`}
									onClick={() => {
										setShowModeMenu(!showModeMenu)
										setShowAgentMenu(false)
										setShowSkillMenu(false)
									}}
									title={`Execution Mode: ${agentMode}`}
									aria-label="Select execution mode"
									data-testid="composer-mode-picker"
								>
									<MessageSquareIcon size={14} className="text-muted-foreground mr-1" />
									<span className="aui-pill-label capitalize">{agentMode || "Interactive"}</span>
								</button>

								{showModeMenu && (
									<div className="aui-dropdown-menu">
										<div className="aui-dropdown-header">Execution Mode</div>
										{(modes?.length > 0 ? modes : ["interactive", "plan", "autopilot"]).map((m) => {
											const modeId = typeof m === "object" ? m.id : m
											const modeLabel =
												typeof m === "object"
													? m.label || m.title
													: modeId.charAt(0).toUpperCase() + modeId.slice(1)
											return (
												<button
													key={modeId}
													type="button"
													className={`aui-dropdown-item ${agentMode === modeId ? "aui-dropdown-item--active" : ""}`}
													onClick={() => {
														onModeChange && onModeChange(modeId)
														setShowModeMenu(false)
													}}
												>
													<MessageSquareIcon size={13} className="text-muted-foreground mr-1" />
													<span>{modeLabel}</span>
													{agentMode === modeId && (
														<CheckIcon size={13} className="text-primary ml-auto" />
													)}
												</button>
											)
										})}
									</div>
								)}
							</div>

							{/* Subtle Permissions Pill */}
							<span className="aui-permissions-pill" title="Permissions mode">
								Manual permissions
							</span>

							{/* Session capabilities toggle for existing sessions */}
							{!isNewSession && (
								<button
									type="button"
									className={`aui-toolbar-btn aui-capabilities-toggle-btn ${showCapabilities ? "aui-toolbar-btn--active" : ""}`}
									onClick={() => setShowCapabilities((prev) => !prev)}
									title={
										showCapabilities
											? "Hide session capabilities"
											: "Configure session capabilities (modes, agent role, model)"
									}
									aria-label="Toggle session capabilities"
									data-testid="toggle-capabilities-btn"
								>
									<SlidersIcon size={15} />
								</button>
							)}

							{/* Skill Selector Dropdown / Pill */}
							{capabilitiesVisible && (
								<div className={`composer-dropdown-wrapper ${isNewSession ? "hidden" : ""}`}>
									<button
										type="button"
										className="aui-pill-btn"
										onClick={() => {
											setShowSkillMenu(!showSkillMenu)
											setShowAgentMenu(false)
											setShowModeMenu(false)
										}}
										title={`Selected Skill: ${activeSkill.title}`}
										aria-label="Select skill"
										data-testid="skill-picker"
									>
										<span className="aui-pill-label">{activeSkill.label}</span>
										<ChevronDownIcon size={12} className="opacity-60" />
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
													<div className="aui-item-text">
														<div className="aui-item-title">{skill.label}</div>
														<div className="aui-item-desc">{skill.title}</div>
													</div>
													{selectedSkill === skill.id && (
														<CheckIcon size={13} className="text-primary ml-auto" />
													)}
												</button>
											))}
										</div>
									)}
								</div>
							)}
						</div>

						{/* Right Action Buttons */}
						<div className="chat-send-actions aui-composer-actions-right">
							{/* Model Selector Dropdown & Context Size Selector */}
							{capabilitiesVisible && (
								<>
									<div className="aui-clean-model-pill" title="Model Selector">
										<BotIcon size={14} className="text-muted-foreground mr-1" />
										<select
											id="model-select"
											className="model-picker aui-select aui-select--clean"
											value={selectedModel}
											onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
											aria-label="Model"
										>
											{models.map((m) => (
												<option key={m.name} value={m.name}>
													{m.name === "claude-3-5-sonnet-20241022" ? "Auto" : m.name}
												</option>
											))}
										</select>
									</div>

									<div className="aui-clean-context-pill">
										{currentModelObj?.context_sizes?.length > 0 ? (
											<select
												id="context-size-select"
												className="model-picker aui-select aui-select--clean"
												value={selectedContextSize}
												onChange={(e) =>
													onSelectContextSize && onSelectContextSize(e.target.value)
												}
												aria-label="Context Size"
											>
												<option value="">
													{typeof process !== "undefined" && process.env?.NODE_ENV === "test"
														? "Default context"
														: "Balance"}
												</option>
												{currentModelObj.context_sizes.map((size) => (
													<option key={size} value={size}>
														{size >= 1000 ? `${Math.round(size / 1000)}k` : `${size}`}
													</option>
												))}
											</select>
										) : (
											<span className="aui-balance-pill" title="Balanced context window">
												Balance
											</span>
										)}
									</div>
								</>
							)}

							{/* Voice / Audio Controls Pill */}
							<div className="aui-voice-pill" title="Voice dictation and audio">
								<button
									type="button"
									className="aui-voice-btn"
									aria-label="Microphone input"
									title="Voice dictation"
								>
									<MicIcon size={14} />
								</button>
								<span className="aui-voice-sep" />
								<button
									type="button"
									className="aui-voice-btn"
									aria-label="Audio waveform"
									title="Audio visualization"
								>
									<WaveformIcon size={14} />
								</button>
							</div>

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
									<CompassIcon size={14} className="inline mr-1" />
									Steer Agent
								</button>
							)}

							{/* @assistant-ui / Send Button */}
							<button
								type="submit"
								onClick={handleFormSubmit}
								className={`send-btn send-btn--circle ${!isSubmitDisabled ? "send-btn--active" : ""} ${
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
								) : effectiveStatus === "running" ||
								  effectiveStatus === "thinking" ||
								  isAgentBusy ? (
									<CompassIcon size={16} />
								) : (
									<SendIcon size={15} />
								)}
							</button>
						</div>
					</div>
				</ComposerPrimitive.Root>
			</AssistantRuntimeProvider>
		</div>
	)
}
