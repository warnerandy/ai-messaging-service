import React, { useState } from "react"
import {
	DEFAULT_AGENT_MODES,
	DEFAULT_AGENT_TYPES,
	normalizeAgentModes,
	normalizeAgentTypes,
	extractAgentName,
} from "../lib/projectInfo.js"
import {
	SparklesIcon,
	BotIcon,
	CodeIcon,
	SearchIcon,
	LayersIcon,
	FileCheckIcon,
	GitBranchIcon,
	GitForkIcon,
	FolderIcon,
	CheckIcon,
	ChevronRightIcon,
	SlidersIcon,
} from "./Icons.jsx"

/**
 * NewSessionCanvas — Base assistant-ui Empty State for AHP Sessions.
 *
 * Clean, modern, minimalist Claude / assistant-ui empty state:
 * - Centered welcome headline with subtle AI monogram
 * - Modern segmented Git Target (Direct Branch vs Git Worktree)
 * - Clean inline branch & workspace directory pills with quick-edit
 * - Monochromatic execution mode selector (Interactive, Plan, Autopilot)
 * - Specialized agent participant role tags
 * - Quick starter prompts with clean typography (zero emojis)
 */
export default function NewSessionCanvas({
	bot,
	isAhp = true,
	projectInfo,
	workingDirectory = "",
	availableDirectories = [],
	onWorkingDirectoryChange,
	modes = DEFAULT_AGENT_MODES,
	mode = "interactive",
	onModeChange,
	worktreeSupported = true,
	useWorktree = false,
	onWorktreeChange,
	baseBranch = "main",
	availableBranches = [],
	onBaseBranchChange,
	agentTypes = DEFAULT_AGENT_TYPES,
	agentType = "workspace",
	onAgentTypeChange,
	onSelectStarter,
	disabled = false,
}) {
	const [customBranchInput, setCustomBranchInput] = useState("")
	const [isEditingBranch, setIsEditingBranch] = useState(false)
	const [customDirInput, setCustomDirInput] = useState("")
	const [isEditingDir, setIsEditingDir] = useState(false)
	const [showConfigDetails, setShowConfigDetails] = useState(true)

	const normalizedModes = normalizeAgentModes(modes)
	const normalizedAgentTypes = normalizeAgentTypes(agentTypes)
	const effectiveWorkingDirectory =
		workingDirectory ||
		(projectInfo?.name ? `${projectInfo.name} (Project Root)` : "Host Default Workspace")

	function handleApplyCustomBranch(e) {
		if (e) e.preventDefault()
		const trimmed = customBranchInput.trim()
		if (trimmed && onBaseBranchChange) {
			onBaseBranchChange(trimmed)
			setIsEditingBranch(false)
			setCustomBranchInput("")
		}
	}

	function handleApplyCustomDir(e) {
		if (e) e.preventDefault()
		const trimmed = customDirInput.trim()
		if (onWorkingDirectoryChange) {
			onWorkingDirectoryChange(trimmed)
			setIsEditingDir(false)
			setCustomDirInput("")
		}
	}

	const defaultStarters = [
		{
			title: "Plan Next Feature",
			desc: `Structured implementation checklist on ${baseBranch}`,
			prompt: `Help me plan and design a new feature on branch "${baseBranch}". Let's start with a clear requirements breakdown and checklist.`,
		},
		{
			title: "Explain Codebase Architecture",
			desc: "Project structure, key modules, and workflows",
			prompt:
				"Can you provide a high-level overview of this codebase architecture and its main modules?",
		},
		{
			title: "Write & Verify Tests",
			desc: "Generate comprehensive tests and verify coverage",
			prompt: "Review recent changes or core modules and help me write unit and integration tests.",
		},
		{
			title: "Audit & Optimize",
			desc: "Inspect for potential bugs, bottlenecks, and edge cases",
			prompt: "Audit this project for potential bugs, edge cases, and performance improvements.",
		},
	]

	function renderRoleIcon(id) {
		switch (id) {
			case "coder":
				return <CodeIcon size={13} className="text-muted-foreground" />
			case "researcher":
				return <SearchIcon size={13} className="text-muted-foreground" />
			case "architect":
				return <LayersIcon size={13} className="text-muted-foreground" />
			case "reviewer":
				return <FileCheckIcon size={13} className="text-muted-foreground" />
			default:
				return <SparklesIcon size={13} className="text-muted-foreground" />
		}
	}

	return (
		<div className="new-session-canvas aui-agent-empty-state" data-testid="new-session-canvas">
			{/* Minimalist Copilot-style Hero Welcome */}
			<div className="aui-welcome-hero aui-ship-hero">
				<h1 className="aui-ship-title">
					What are we building?
				</h1>
				<div className="aui-welcome-meta">
					<span className="aui-meta-pill">
						Start a conversation with {bot?.name || "your bot"}
					</span>
					<span className="aui-meta-pill">
						{bot?.bot_type === "ahp" ? "AHP Protocol" : "Chat Protocol"}
					</span>
					{projectInfo?.hasProject && (
						<span className="aui-meta-pill aui-meta-pill--project">
							<FolderIcon size={12} className="inline mr-1 opacity-70" />
							<span>{projectInfo.name}</span>
						</span>
					)}
				</div>
			</div>

			{/* Clean Minimalist Session Setup Box */}
			<div className="aui-session-setup-panel" data-testid="canvas-git-section">
				<div className="aui-setup-header">
					<div className="flex items-center gap-2">
						<SlidersIcon size={14} className="text-muted-foreground" />
						<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							Session Setup
						</span>
					</div>
					<button
						type="button"
						onClick={() => setShowConfigDetails((prev) => !prev)}
						className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1"
					>
						{showConfigDetails ? "Compact" : "Configure"}
					</button>
				</div>

				{/* Target Copy: Direct Branch vs Worktree */}
				<div className="aui-setup-row">
					<div className="canvas-card-grid aui-target-switcher">
						{/* Direct Branch Option */}
						<button
							type="button"
							className={`canvas-target-card aui-target-card ${!useWorktree ? "canvas-target-card--active aui-target-card--active" : ""}`}
							onClick={() => !disabled && onWorktreeChange && onWorktreeChange(false)}
							disabled={disabled}
							data-testid="canvas-opt-direct-branch"
						>
							<div className="flex items-center justify-between mb-1">
								<div className="flex items-center gap-1.5 text-xs font-medium">
									<GitBranchIcon size={14} className="text-emerald-400" />
									<span>Direct Branch</span>
								</div>
								<span
									className={`canvas-check-badge ${!useWorktree ? "canvas-check-badge--active" : ""}`}
								>
									{!useWorktree ? "✓ Selected" : "Select"}
								</span>
							</div>
							<p className="canvas-target-card-desc text-xs text-muted-foreground m-0">
								Work on <strong className="text-foreground">{baseBranch}</strong> directly.
							</p>
						</button>

						{/* Isolated Git Worktree Option */}
						<button
							type="button"
							className={`canvas-target-card aui-target-card ${useWorktree ? "canvas-target-card--active canvas-target-card--worktree aui-target-card--active" : ""} ${!worktreeSupported ? "canvas-target-card--disabled" : ""}`}
							onClick={() => {
								if (!disabled && worktreeSupported && onWorktreeChange) {
									onWorktreeChange(true)
								}
							}}
							disabled={disabled || !worktreeSupported}
							data-testid="canvas-opt-worktree"
						>
							<div className="flex items-center justify-between mb-1">
								<div className="flex items-center gap-1.5 text-xs font-medium">
									<GitForkIcon size={14} className="text-amber-400" />
									<span>New Git Worktree</span>
								</div>
								<span
									className={`canvas-check-badge ${useWorktree ? "canvas-check-badge--worktree" : ""}`}
								>
									{!worktreeSupported
										? "Not Supported"
										: useWorktree
											? "✓ Worktree Active"
											: "Make Worktree"}
								</span>
							</div>
							<p className="canvas-target-card-desc text-xs text-muted-foreground m-0">
								Isolated worktree against <strong className="text-foreground">{baseBranch}</strong>.
							</p>
						</button>
					</div>
				</div>

				{/* Base Branch & Workspace Directory Pills */}
				<div className="aui-setup-pills-row">
					{/* Target Base Branch */}
					<div className="aui-pill-box">
						<span className="aui-pill-box-label">Base Branch:</span>
						{!isEditingBranch ? (
							<button
								type="button"
								aria-label="Change Branch"
								onClick={() => {
									setCustomBranchInput(baseBranch)
									setIsEditingBranch(true)
								}}
								className="aui-value-pill"
								title="Click to change branch"
							>
								<GitBranchIcon size={12} className="text-muted-foreground" />
								<span>{baseBranch}</span>
							</button>
						) : (
							<form onSubmit={handleApplyCustomBranch} className="canvas-branch-form">
								<input
									type="text"
									className="canvas-branch-input"
									placeholder="e.g. main, feat/login"
									value={customBranchInput}
									onChange={(e) => setCustomBranchInput(e.target.value)}
									autoFocus
								/>
								<button type="submit" className="canvas-branch-submit-btn">
									Set Base Branch
								</button>
								<button
									type="button"
									className="canvas-branch-cancel-btn"
									onClick={() => setIsEditingBranch(false)}
								>
									Cancel
								</button>
							</form>
						)}

						{availableBranches.length > 0 && !isEditingBranch && (
							<div className="flex items-center gap-1 overflow-x-auto py-0.5">
								{availableBranches.slice(0, 4).map((b) => (
									<button
										key={b}
										type="button"
										className={`canvas-branch-pill ${baseBranch === b ? "canvas-branch-pill--active" : ""}`}
										onClick={() => onBaseBranchChange && onBaseBranchChange(b)}
									>
										{b}
									</button>
								))}
							</div>
						)}
					</div>

					{/* Workspace Directory */}
					<div className="aui-pill-box" data-testid="canvas-workdir-box">
						<span className="aui-pill-box-label">Workspace:</span>
						<span className="hidden" data-testid="canvas-workdir-current">
							{effectiveWorkingDirectory}
						</span>
						{!isEditingDir ? (
							<button
								type="button"
								onClick={() => {
									setCustomDirInput(effectiveWorkingDirectory)
									setIsEditingDir(true)
								}}
								className="aui-value-pill"
								data-testid="canvas-workdir-edit-btn"
								title="Click to set workspace directory"
							>
								<FolderIcon size={12} className="text-muted-foreground" />
								<span className="truncate max-w-[200px]">{effectiveWorkingDirectory}</span>
							</button>
						) : (
							<form
								onSubmit={handleApplyCustomDir}
								className="canvas-branch-form"
								data-testid="canvas-workdir-form"
							>
								<input
									type="text"
									className="canvas-branch-input"
									placeholder="e.g. /workspace/my-app"
									value={customDirInput}
									onChange={(e) => setCustomDirInput(e.target.value)}
									data-testid="canvas-workdir-input"
									autoFocus
								/>
								<button
									type="submit"
									className="canvas-branch-submit-btn"
									data-testid="canvas-workdir-submit-btn"
								>
									Apply Path
								</button>
								<button
									type="button"
									className="canvas-branch-cancel-btn"
									onClick={() => setIsEditingDir(false)}
								>
									Cancel
								</button>
							</form>
						)}

						{Array.isArray(availableDirectories) &&
							availableDirectories.length > 0 &&
							!isEditingDir && (
								<div className="flex items-center gap-1 overflow-x-auto py-0.5">
									{availableDirectories.slice(0, 3).map((dir) => (
										<button
											key={dir}
											type="button"
											aria-label={dir}
											className={`canvas-branch-pill ${effectiveWorkingDirectory === dir ? "canvas-branch-pill--active" : ""}`}
											onClick={() => onWorkingDirectoryChange && onWorkingDirectoryChange(dir)}
											title={dir}
										>
											{dir}
										</button>
									))}
								</div>
							)}
					</div>
				</div>

				{/* Execution Modes Segmented Control */}
				{normalizedModes.length > 0 && (
					<div className="aui-setup-section" data-testid="canvas-mode-section">
						<div className="text-xs text-muted-foreground mb-1.5 font-medium">
							Execution Mode:
						</div>
						<div className="aui-segmented-control">
							{normalizedModes.map((m) => {
								const isSelected = mode === m.id
								return (
									<button
										key={m.id}
										type="button"
										className={`aui-segmented-btn ${isSelected ? "aui-segmented-btn--active" : ""}`}
										onClick={() => !disabled && onModeChange && onModeChange(m.id)}
										disabled={disabled}
										data-testid={`canvas-mode-${m.id}`}
										title={m.description || m.label}
									>
										<span>{m.label}</span>
									</button>
								)
							})}
						</div>
					</div>
				)}

				{/* Agent Participant Roles */}
				{normalizedAgentTypes.length > 0 && (
					<div className="aui-setup-section" data-testid="canvas-role-section">
						<div className="text-xs text-muted-foreground mb-1.5 font-medium">Agent Role:</div>
						<div className="flex items-center gap-1.5 flex-wrap">
							{normalizedAgentTypes.map((item) => {
								const isSelected = (agentType || "").toLowerCase() === item.id.toLowerCase()
								return (
									<button
										key={item.id}
										type="button"
										className={`aui-role-chip ${isSelected ? "aui-role-chip--active" : ""}`}
										onClick={() => !disabled && onAgentTypeChange && onAgentTypeChange(item.id)}
										disabled={disabled}
										title={item.description || item.label}
									>
										{renderRoleIcon(item.id)}
										<span>{extractAgentName(item.label || item.id)}</span>
										{isSelected && <CheckIcon size={12} className="text-primary" />}
									</button>
								)
							})}
						</div>
					</div>
				)}
			</div>

			{/* Quick Starter Prompts (Clean typography, zero emojis) */}
			{onSelectStarter && (
				<div className="aui-starters-section" data-testid="canvas-starters-section">
					<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
						Suggested Prompts
					</div>

					<div className="aui-starters-grid">
						{defaultStarters.map((starter, idx) => (
							<button
								key={idx}
								type="button"
								className="aui-clean-starter-card"
								onClick={() => onSelectStarter(starter.prompt)}
								title={starter.prompt}
							>
								<div className="flex items-center justify-between mb-1">
									<div className="font-medium text-sm text-foreground">{starter.title}</div>
									<ChevronRightIcon
										size={14}
										className="text-muted-foreground opacity-60 group-hover:opacity-100"
									/>
								</div>
								<div className="text-xs text-muted-foreground line-clamp-2">{starter.desc}</div>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
