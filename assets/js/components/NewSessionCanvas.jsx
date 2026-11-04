import React, { useState } from "react"
import {
	DEFAULT_AGENT_MODES,
	DEFAULT_AGENT_TYPES,
	normalizeAgentModes,
	normalizeAgentTypes,
	extractAgentName,
} from "../lib/projectInfo.js"
import { VSCodeWorkingStateIcon } from "./VSCodeWorkingIcons.jsx"

/**
 * NewSessionCanvas
 *
 * Compact VS Code Agents Window / Claude Code empty state for AHP & Chat sessions.
 * Provides a streamlined setup surface:
 * - Direct Branch vs Isolated Git Worktree toggle
 * - Target Base Branch selector with repository branch pills and inline editor
 * - Execution Mode tabs (Interactive, Plan, Autopilot)
 * - Agent Role / Participant specialization pills (@workspace, coder, architect, reviewer)
 * - Quick starter prompt suggestions to immediately begin the session
 */
export default function NewSessionCanvas({
	bot,
	isAhp = true,
	projectInfo,
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

	const normalizedModes = normalizeAgentModes(modes)
	const normalizedAgentTypes = normalizeAgentTypes(agentTypes)

	function handleApplyCustomBranch(e) {
		if (e) e.preventDefault()
		const trimmed = customBranchInput.trim()
		if (trimmed && onBaseBranchChange) {
			onBaseBranchChange(trimmed)
			setIsEditingBranch(false)
			setCustomBranchInput("")
		}
	}

	const defaultStarters = [
		{
			icon: "📋",
			title: "Plan Next Feature",
			desc: `Structured implementation checklist on ${baseBranch}`,
			prompt: `Help me plan and design a new feature on branch "${baseBranch}". Let's start with a clear requirements breakdown and checklist.`,
		},
		{
			icon: "🔍",
			title: "Explain Codebase Architecture",
			desc: "Project structure, key modules, and workflows",
			prompt:
				"Can you provide a high-level overview of this codebase architecture and its main modules?",
		},
		{
			icon: "🧪",
			title: "Write & Verify Tests",
			desc: "Generate comprehensive tests and verify coverage",
			prompt: "Review recent changes or core modules and help me write unit and integration tests.",
		},
		{
			icon: "⚡",
			title: "Audit & Optimize",
			desc: "Inspect for bugs, bottlenecks, and edge cases",
			prompt: "Audit this project for potential bugs, edge cases, and performance improvements.",
		},
	]

	return (
		<div className="new-session-canvas aui-agent-empty-state" data-testid="new-session-canvas">
			{/* Compact Hero Header */}
			<div className="canvas-header aui-hero-header">
				<div className="canvas-header-bot">
					<div className="canvas-bot-avatar aui-bot-badge-icon">
						{bot?.bot_type === "ahp" ? "🤖" : "💬"}
					</div>
					<div className="aui-hero-text">
						<div className="aui-hero-title-row">
							<h1 className="canvas-bot-title">
								Start a conversation with {bot?.name || "your bot"}
							</h1>
							<div className="canvas-badges">
								<span
									className={`bot-protocol-badge bot-protocol-badge--${bot?.bot_type === "ahp" ? "ahp" : "chat"}`}
								>
									{bot?.bot_type === "ahp" ? "AHP Protocol" : "Chat Protocol"}
								</span>
								{projectInfo?.hasProject && (
									<span
										className="canvas-project-badge"
										title={projectInfo.path || projectInfo.name}
									>
										📁 {projectInfo.name}
									</span>
								)}
							</div>
						</div>
						<p className="canvas-bot-subtitle">
							Configure your working copy, git branch, and execution mode before sending your
							prompt.
						</p>
					</div>
				</div>
			</div>

			{/* Unified Workspace & Target Command Center */}
			<div className="aui-command-card">
				{/* Section 1: Git Target & Working Copy (Worktree vs Direct Branch) */}
				<div className="canvas-section aui-command-section" data-testid="canvas-git-section">
					<div className="canvas-section-header aui-command-section-header">
						<div className="canvas-section-title-wrap">
							<svg
								className="canvas-section-icon text-emerald-400"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<line x1="6" y1="3" x2="6" y2="15" />
								<circle cx="18" cy="6" r="3" />
								<circle cx="6" cy="18" r="3" />
								<path d="M18 9a9 9 0 0 1-9 9" />
							</svg>
							<span className="canvas-section-title">Working Copy & Target</span>
						</div>
						<div className="canvas-section-desc aui-command-hint">
							Execute on direct local branch or in an isolated git worktree
						</div>
					</div>

					<div className="canvas-card-grid aui-target-switcher">
						{/* Direct Branch Option */}
						<button
							type="button"
							className={`canvas-target-card aui-target-card ${!useWorktree ? "canvas-target-card--active aui-target-card--active" : ""}`}
							onClick={() => !disabled && onWorktreeChange && onWorktreeChange(false)}
							disabled={disabled}
							data-testid="canvas-opt-direct-branch"
						>
							<div className="canvas-target-card-top">
								<div className="canvas-card-icon-wrap text-emerald-400">
									<svg
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
									>
										<line x1="6" y1="3" x2="6" y2="15" />
										<circle cx="18" cy="6" r="3" />
										<circle cx="6" cy="18" r="3" />
										<path d="M18 9a9 9 0 0 1-9 9" />
									</svg>
								</div>
								<span
									className={`canvas-check-badge ${!useWorktree ? "canvas-check-badge--active" : ""}`}
								>
									{!useWorktree ? "✓ Selected" : "Select"}
								</span>
							</div>
							<div className="canvas-target-card-body">
								<div className="canvas-target-card-title">Direct Branch</div>
								<div className="canvas-target-card-subtitle">
									Work directly on <strong className="text-emerald-300">{baseBranch}</strong>
								</div>
								<p className="canvas-target-card-desc">
									Changes are written directly into your active working tree. Ideal for fast local
									iterations.
								</p>
							</div>
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
							<div className="canvas-target-card-top">
								<div className="canvas-card-icon-wrap text-amber-400">
									<svg
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
									>
										<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
									</svg>
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
							<div className="canvas-target-card-body">
								<div className="canvas-target-card-title">New Git Worktree</div>
								<div className="canvas-target-card-subtitle">
									Isolated worktree against <strong className="text-amber-300">{baseBranch}</strong>
								</div>
								<p className="canvas-target-card-desc">
									Creates an isolated git worktree branch for this session. Protects your local
									uncommitted code.
								</p>
							</div>
						</button>
					</div>

					{/* Base Branch Selection & Quick-Pick */}
					<div className="canvas-branch-box aui-branch-strip">
						<div className="canvas-branch-header">
							<span className="canvas-branch-label">Target Base Branch:</span>
							<span className="canvas-branch-current">
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
								<strong>{baseBranch}</strong>
							</span>
							{!isEditingBranch && (
								<button
									type="button"
									className="canvas-branch-edit-btn"
									onClick={() => {
										setCustomBranchInput(baseBranch)
										setIsEditingBranch(true)
									}}
								>
									Change Branch
								</button>
							)}
						</div>

						{isEditingBranch && (
							<form onSubmit={handleApplyCustomBranch} className="canvas-branch-form">
								<input
									type="text"
									className="canvas-branch-input"
									placeholder="e.g. main, feat/login, release-1.0"
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

						{/* Repository Branches Synced from Integration */}
						{availableBranches.length > 0 && (
							<div className="canvas-branch-pills">
								<span className="canvas-branch-pills-label">Repository Branches:</span>
								<div className="canvas-branch-pills-list">
									{availableBranches.map((b) => (
										<button
											key={b}
											type="button"
											className={`canvas-branch-pill ${baseBranch === b ? "canvas-branch-pill--active" : ""}`}
											onClick={() => onBaseBranchChange && onBaseBranchChange(b)}
											title={`Switch base branch to ${b}`}
										>
											{b}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Section 2: Agent Execution Mode */}
				{normalizedModes.length > 0 && (
					<div className="canvas-section aui-command-section" data-testid="canvas-mode-section">
						<div className="canvas-section-header aui-command-section-header">
							<div className="canvas-section-title-wrap">
								<svg
									className="canvas-section-icon text-sky-400"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.2"
								>
									<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
								</svg>
								<span className="canvas-section-title">Execution Mode</span>
							</div>
							<div className="canvas-section-desc aui-command-hint">
								Choose agent autonomy level
							</div>
						</div>

						<div className="canvas-mode-grid aui-mode-row">
							{normalizedModes.map((m) => {
								const isSelected = mode === m.id
								return (
									<button
										key={m.id}
										type="button"
										className={`canvas-mode-card aui-mode-pill-card canvas-mode-card--${m.id} ${isSelected ? "canvas-mode-card--active aui-mode-pill-card--active" : ""}`}
										onClick={() => !disabled && onModeChange && onModeChange(m.id)}
										disabled={disabled}
										data-testid={`canvas-mode-${m.id}`}
									>
										<div className="canvas-mode-card-header">
											<span className="canvas-mode-card-icon">
												{m.id === "autopilot" ? "🚀" : m.id === "plan" ? "📋" : "💬"}
											</span>
											<span className="canvas-mode-card-name">{m.label}</span>
											{isSelected && <span className="canvas-mode-card-badge">Active</span>}
										</div>
										<p className="canvas-mode-card-desc">
											{m.description || `${m.label} execution mode`}
										</p>
									</button>
								)
							})}
						</div>
					</div>
				)}

				{/* Section 3: Agent Role / Participant */}
				{normalizedAgentTypes.length > 0 && (
					<div className="canvas-section aui-command-section" data-testid="canvas-role-section">
						<div className="canvas-section-header aui-command-section-header">
							<div className="canvas-section-title-wrap">
								<svg
									className="canvas-section-icon text-indigo-400"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.2"
								>
									<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
									<circle cx="9" cy="7" r="4" />
									<polyline points="16 11 18 13 22 9" />
								</svg>
								<span className="canvas-section-title">Agent Role & Capabilities</span>
							</div>
							<div className="canvas-section-desc aui-command-hint">Specialized role focus</div>
						</div>

						<div className="canvas-roles-list aui-roles-row">
							{normalizedAgentTypes.map((item) => {
								const isSelected = (agentType || "").toLowerCase() === item.id.toLowerCase()
								return (
									<button
										key={item.id}
										type="button"
										className={`canvas-role-pill aui-role-tag ${isSelected ? "canvas-role-pill--active aui-role-tag--active" : ""}`}
										onClick={() => !disabled && onAgentTypeChange && onAgentTypeChange(item.id)}
										disabled={disabled}
										title={item.description || item.label}
									>
										<span className="canvas-role-pill-icon">
											{item.id === "workspace"
												? "🌐"
												: item.id === "coder"
													? "💻"
													: item.id === "architect"
														? "📐"
														: item.id === "reviewer"
															? "🔍"
															: "🤖"}
										</span>
										<span className="canvas-role-pill-label">
											{extractAgentName(item.label || item.id)}
										</span>
										{isSelected && <span className="canvas-role-pill-check">✓</span>}
									</button>
								)
							})}
						</div>
					</div>
				)}
			</div>

			{/* Section 4: Quick Starter Prompts */}
			{onSelectStarter && (
				<div className="canvas-section aui-starters-section" data-testid="canvas-starters-section">
					<div className="canvas-section-header">
						<div className="canvas-section-title-wrap">
							<span className="canvas-section-icon text-amber-400">✨</span>
							<div>
								<h2 className="canvas-section-title">Get Started</h2>
								<p className="canvas-section-desc">
									Click a quick starter to populate your prompt and begin.
								</p>
							</div>
						</div>
					</div>

					<div className="canvas-starters-grid aui-starters-grid">
						{defaultStarters.map((starter, idx) => (
							<button
								key={idx}
								type="button"
								className="canvas-starter-card aui-starter-card"
								onClick={() => onSelectStarter(starter.prompt)}
								title={starter.prompt}
							>
								<div className="canvas-starter-icon">{starter.icon}</div>
								<div className="canvas-starter-info">
									<div className="canvas-starter-title">{starter.title}</div>
									<div className="canvas-starter-desc">{starter.desc}</div>
								</div>
								<span className="canvas-starter-arrow">→</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
