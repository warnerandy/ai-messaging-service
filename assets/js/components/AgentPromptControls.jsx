import React, { useState, useRef, useEffect } from "react"
import {
	DEFAULT_AGENT_MODES,
	DEFAULT_AGENT_TYPES,
	formatAgentType,
	formatModeLabel,
	extractAgentName,
} from "../lib/projectInfo.js"

/**
 * VS Code Agent Mode, Worktree, Base Branch, and Agent Type Prompt Controls
 *
 * Implements full bidirectional synchronization from the connected integration:
 * - Agent Modes: dynamic modes synced from integration (defaults: interactive, plan, autopilot, or custom modes)
 * - Working Copy: Worktree (isolated git worktree) vs Direct Branch (checked-out branch)
 * - Base Branch: Configurable base branch with quick-pick from repository branches
 * - Agent Type: Active agent participant / role synced from integration (@workspace, coder, architect, etc.)
 */
export default function AgentPromptControls({
	modes = DEFAULT_AGENT_MODES,
	mode = "interactive",
	onModeChange,
	worktreeSupported = true,
	useWorktree = false,
	onWorktreeChange,
	baseBranch = "main",
	availableBranches = [],
	onBaseBranchChange,
	agentType = "workspace",
	onAgentTypeChange,
	agentTypes = ["workspace", "coder", "architect", "reviewer"],
	disabled = false,
	isAHP = true,
	syncStatus = "synced",
}) {
	const [showBranchModal, setShowBranchModal] = useState(false)
	const [branchInputValue, setBranchInputValue] = useState(baseBranch)
	const [showAgentTypeDropdown, setShowAgentTypeDropdown] = useState(false)
	const branchDropdownRef = useRef(null)
	const agentTypeDropdownRef = useRef(null)
	const branchInputRef = useRef(null)

	useEffect(() => {
		setBranchInputValue(baseBranch)
	}, [baseBranch])

	// Close dropdowns on outside click
	useEffect(() => {
		function handleClickOutside(e) {
			if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target)) {
				setShowBranchModal(false)
			}
			if (agentTypeDropdownRef.current && !agentTypeDropdownRef.current.contains(e.target)) {
				setShowAgentTypeDropdown(false)
			}
		}

		if (showBranchModal || showAgentTypeDropdown) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showBranchModal, showAgentTypeDropdown])

	// Focus branch input when branch popover opens
	useEffect(() => {
		if (showBranchModal) {
			setTimeout(() => {
				branchInputRef.current?.focus()
				branchInputRef.current?.select()
			}, 50)
		}
	}, [showBranchModal])

	function handleModeClick(newMode) {
		if (disabled || mode === newMode) return
		if (onModeChange) onModeChange(newMode)
	}

	function handleBranchSubmit(e) {
		if (e) e.preventDefault()
		const trimmed = branchInputValue.trim()
		if (trimmed && onBaseBranchChange) {
			onBaseBranchChange(trimmed)
		}
		setShowBranchModal(false)
	}

	function handleSelectAgentType(type) {
		if (disabled) return
		if (onAgentTypeChange) onAgentTypeChange(type)
		setShowAgentTypeDropdown(false)
	}

	// Normalize modes from integration (strings or objects)
	const normalizedModes = (Array.isArray(modes) && modes.length > 0 ? modes : DEFAULT_AGENT_MODES)
		.map((m) => {
			if (typeof m === "object" && m !== null) {
				const id = m.id || m.mode || m.name
				return {
					id,
					label: m.label || m.title || formatModeLabel(id),
					icon: m.icon || id,
					description: m.description || "",
				}
			}
			const id = String(m).trim()
			return {
				id,
				label: formatModeLabel(id),
				icon: id,
				description: "",
			}
		})
		.filter((m) => Boolean(m.id))

	// Normalize agent types from integration (strings or objects)
	const normalizedAgentTypes = (
		Array.isArray(agentTypes) && agentTypes.length > 0 ? agentTypes : DEFAULT_AGENT_TYPES
	)
		.map((t) => {
			if (typeof t === "object" && t !== null) {
				const id = t.id || t.type || t.name
				const rawLabel = t.label || t.title || ""
				const label =
					rawLabel &&
					!rawLabel.startsWith("file:") &&
					!rawLabel.includes("/") &&
					!rawLabel.includes("\\")
						? rawLabel
						: extractAgentName(rawLabel || id)
				return {
					id,
					label,
					icon: t.icon || id,
					description: t.description || "",
				}
			}
			const id = String(t).trim()
			return {
				id,
				label: formatAgentType(id, agentTypes),
				icon: id,
				description: "",
			}
		})
		.filter((t) => Boolean(t.id))

	// Helper icons for modes
	const renderModeIcon = (iconName, modeId) => {
		const key = (iconName || modeId || "").toLowerCase()
		if (key === "plan" || key === "planning" || key === "checklist") {
			return (
				<svg
					className="agent-mode-icon"
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
					<rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
					<path d="m9 14 2 2 4-4" />
				</svg>
			)
		}
		if (key === "autopilot" || key === "auto" || key === "autonomous" || key === "star") {
			return (
				<svg
					className="agent-mode-icon"
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
				</svg>
			)
		}
		if (key === "code" || key === "coder") {
			return (
				<svg
					className="agent-mode-icon"
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
			)
		}
		if (key === "review" || key === "reviewer") {
			return (
				<svg
					className="agent-mode-icon"
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			)
		}
		// Default chat / interactive
		return (
			<svg
				className="agent-mode-icon"
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		)
	}

	// Helper icons for agent types
	const renderAgentTypeIcon = (type) => {
		const lower = (type || "").toLowerCase()
		if (lower === "architect") {
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<path d="M3 9h18M9 21V9" />
				</svg>
			)
		}
		if (lower === "coder" || lower === "code") {
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
			)
		}
		if (lower === "reviewer" || lower === "review") {
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			)
		}
		// Default workspace
		return (
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
			</svg>
		)
	}

	const activeAgentTypeObj = normalizedAgentTypes.find(
		(t) => t.id.toLowerCase() === (agentType || "").toLowerCase(),
	)
	const displayAgentTypeLabel = activeAgentTypeObj
		? activeAgentTypeObj.label &&
			!activeAgentTypeObj.label.startsWith("file:") &&
			!activeAgentTypeObj.label.includes("/") &&
			!activeAgentTypeObj.label.includes("\\")
			? activeAgentTypeObj.label
			: extractAgentName(activeAgentTypeObj.label || activeAgentTypeObj.id)
		: formatAgentType(agentType, agentTypes)

	return (
		<div className="agent-prompt-controls" data-testid="agent-prompt-controls">
			{/* Mode Selector Tabs Synced from Integration */}
			{normalizedModes.length > 0 && (
				<div className="agent-mode-tabs" role="tablist" aria-label="Agent Execution Mode">
					{normalizedModes.map((m) => {
						const isSelected = mode === m.id
						return (
							<button
								key={m.id}
								type="button"
								role="tab"
								aria-selected={isSelected}
								aria-label={`${m.label} mode`}
								disabled={disabled}
								className={`agent-mode-tab agent-mode-tab--${m.id} ${
									isSelected ? "agent-mode-tab--active" : ""
								}`}
								onClick={() => handleModeClick(m.id)}
								title={m.description || `${m.label} mode`}
							>
								{renderModeIcon(m.icon, m.id)}
								<span className="agent-mode-label">{m.label}</span>
							</button>
						)
					})}
				</div>
			)}

			{/* Divider */}
			{normalizedModes.length > 0 && <div className="agent-prompt-divider" />}

			{/* Working Copy (Direct Branch vs Isolated Worktree) & Base Branch Popover */}
			<div className="agent-worktree-container" ref={branchDropdownRef}>
				<button
					type="button"
					className={`agent-chip-btn ${useWorktree ? "agent-chip-btn--worktree" : "agent-chip-btn--branch"}`}
					onClick={() => setShowBranchModal((prev) => !prev)}
					disabled={disabled}
					title={
						useWorktree
							? `Working in isolated git worktree against base branch "${baseBranch}". Click to configure.`
							: `Working directly on branch "${baseBranch}". Click to configure or switch to worktree.`
					}
					aria-label="Configure working branch and worktree"
					aria-expanded={showBranchModal}
				>
					{useWorktree ? (
						<svg
							className="agent-chip-icon text-amber-400"
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
						</svg>
					) : (
						<svg
							className="agent-chip-icon text-emerald-400"
							width="13"
							height="13"
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
					)}
					<span className="agent-chip-text">
						{useWorktree ? "Worktree" : "Branch"}:{" "}
						<strong className="agent-chip-branch-name">{baseBranch}</strong>
					</span>
					<svg
						className="agent-chip-chevron"
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="6 9 12 15 18 9" />
					</svg>
				</button>

				{/* Worktree & Branch Dropdown Popover */}
				{showBranchModal && (
					<div
						className="agent-popover agent-worktree-popover"
						role="dialog"
						aria-label="Branch and Worktree Settings"
					>
						<div className="agent-popover-header">
							<span className="agent-popover-title">Working Target</span>
							<button
								type="button"
								className="agent-popover-close"
								onClick={() => setShowBranchModal(false)}
								aria-label="Close"
							>
								✕
							</button>
						</div>

						{/* Toggle Worktree vs Branch (if supported by integration) */}
						{worktreeSupported ? (
							<div className="agent-worktree-toggle-group">
								<button
									type="button"
									className={`agent-worktree-toggle-btn ${!useWorktree ? "agent-worktree-toggle-btn--active" : ""}`}
									onClick={() => {
										if (onWorktreeChange) onWorktreeChange(false)
									}}
								>
									<div className="agent-toggle-icon-wrap text-emerald-400">
										<svg
											width="14"
											height="14"
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
									<div className="agent-toggle-meta">
										<span className="agent-toggle-title">Direct Branch</span>
										<span className="agent-toggle-desc">Work directly on {baseBranch}</span>
									</div>
									{!useWorktree && <span className="agent-toggle-check">✓</span>}
								</button>

								<button
									type="button"
									className={`agent-worktree-toggle-btn ${useWorktree ? "agent-worktree-toggle-btn--active" : ""}`}
									onClick={() => {
										if (onWorktreeChange) onWorktreeChange(true)
									}}
								>
									<div className="agent-toggle-icon-wrap text-amber-400">
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.2"
										>
											<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
										</svg>
									</div>
									<div className="agent-toggle-meta">
										<span className="agent-toggle-title">Git Worktree</span>
										<span className="agent-toggle-desc">
											Isolated worktree to protect working tree
										</span>
									</div>
									{useWorktree && <span className="agent-toggle-check">✓</span>}
								</button>
							</div>
						) : (
							<div className="agent-toggle-desc mb-3 text-xs text-zinc-400">
								Worktree isolation is disabled or not supported by this agent.
							</div>
						)}

						{/* Editable Base Branch Form */}
						<form onSubmit={handleBranchSubmit} className="agent-branch-form">
							<label htmlFor="agent-base-branch-input" className="agent-branch-label">
								Base Branch:
							</label>
							<div className="agent-branch-input-wrap">
								<input
									id="agent-base-branch-input"
									ref={branchInputRef}
									type="text"
									className="agent-branch-input"
									value={branchInputValue}
									onChange={(e) => setBranchInputValue(e.target.value)}
									placeholder="main"
									aria-label="Base git branch"
								/>
								<button type="submit" className="agent-branch-apply-btn" title="Save Base Branch">
									Save
								</button>
							</div>
						</form>

						{/* Available Branches from Repository / Integration */}
						{availableBranches.length > 0 && (
							<div className="agent-branch-picker">
								<span className="agent-branch-picker-title">
									Repository Branches ({availableBranches.length})
								</span>
								<div className="agent-branch-list">
									{availableBranches.map((branchName) => {
										const isCurrent = branchName === baseBranch
										return (
											<button
												key={branchName}
												type="button"
												className={`agent-branch-item ${isCurrent ? "agent-branch-item--active" : ""}`}
												onClick={() => {
													if (onBaseBranchChange) onBaseBranchChange(branchName)
													setBranchInputValue(branchName)
													setShowBranchModal(false)
												}}
											>
												<svg
													width="12"
													height="12"
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
												<span className="agent-branch-item-name">{branchName}</span>
												{isCurrent && <span className="agent-branch-item-check">✓</span>}
											</button>
										)
									})}
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Agent Type Selector Synced from Integration */}
			{normalizedAgentTypes.length > 0 && (
				<div className="agent-type-container" ref={agentTypeDropdownRef}>
					<button
						type="button"
						className="agent-chip-btn agent-chip-btn--type"
						onClick={() => setShowAgentTypeDropdown((prev) => !prev)}
						disabled={disabled}
						title={`Active agent type: ${displayAgentTypeLabel}. Click to switch.`}
						aria-label="Select agent type"
						aria-expanded={showAgentTypeDropdown}
					>
						<span className="agent-type-icon-wrapper text-indigo-400">
							{renderAgentTypeIcon(agentType)}
						</span>
						<span className="agent-chip-text">{displayAgentTypeLabel}</span>
						<svg
							className="agent-chip-chevron"
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</button>

					{/* Agent Type Dropdown Popover */}
					{showAgentTypeDropdown && (
						<div
							className="agent-popover agent-type-popover"
							role="menu"
							aria-label="Available Agent Types"
						>
							<div className="agent-popover-header">
								<span className="agent-popover-title">Agent Type</span>
								<button
									type="button"
									className="agent-popover-close"
									onClick={() => setShowAgentTypeDropdown(false)}
									aria-label="Close"
								>
									✕
								</button>
							</div>
							<div className="agent-type-list">
								{normalizedAgentTypes.map((item) => {
									const isSelected = agentType.toLowerCase() === item.id.toLowerCase()
									return (
										<button
											key={item.id}
											type="button"
											role="menuitem"
											className={`agent-type-item ${isSelected ? "agent-type-item--active" : ""}`}
											onClick={() => handleSelectAgentType(item.id)}
										>
											<span className="agent-type-item-icon">
												{renderAgentTypeIcon(item.icon || item.id)}
											</span>
											<div className="agent-type-item-meta">
												<span className="agent-type-item-name">{item.label}</span>
												{item.description && (
													<span className="agent-type-item-desc">{item.description}</span>
												)}
											</div>
											{isSelected && <span className="agent-type-item-check">✓</span>}
										</button>
									)
								})}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Live Sync Status indicator */}
			{isAHP && (
				<div className="agent-sync-indicator" title="Synced with VS Code coding agent runtime">
					<span className="agent-sync-dot" />
					<span className="agent-sync-text">Synced</span>
				</div>
			)}
		</div>
	)
}
