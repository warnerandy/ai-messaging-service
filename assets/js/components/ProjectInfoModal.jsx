import React, { useState, useEffect } from "react"

export default function ProjectInfoModal({
	isOpen,
	onClose,
	projectInfo,
	activeConv,
	bot,
	sessionStatus = "idle",
	useWorktree = false,
	baseBranch = "",
	worktreeSupported = true,
}) {
	const [copiedField, setCopiedField] = useState(null)

	useEffect(() => {
		if (!isOpen) return
		const handleKeyDown = (e) => {
			if (e.key === "Escape") onClose && onClose()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [isOpen, onClose])

	if (!isOpen) return null

	const copyText = (text, fieldKey) => {
		if (!text) return
		navigator.clipboard.writeText(text)
		setCopiedField(fieldKey)
		setTimeout(() => setCopiedField(null), 2000)
	}

	const hasProject = projectInfo?.hasProject
	const projectName = projectInfo?.name || "No Project"
	const projectPath = projectInfo?.path || ""
	const projectUri = projectInfo?.uri || ""
	const projectBranch = projectInfo?.branch || ""
	const projectRepo = projectInfo?.repository || ""
	const workingDirs = projectInfo?.workingDirectories || []
	const botType = bot?.bot_type === "ahp" ? "AHP Protocol" : "Chat Protocol"

	const effectiveBaseBranch =
		baseBranch ||
		activeConv?.metadata?.base_branch ||
		activeConv?.metadata?.branch ||
		projectBranch ||
		"main"
	const isWorktree = Boolean(useWorktree) || Boolean(activeConv?.metadata?.use_worktree)

	const stepText = activeConv?.metadata?.step || activeConv?.metadata?.current_step || ""
	const toolText = activeConv?.metadata?.tool || ""

	const handleCopyAll = () => {
		const lines = [
			`Project: ${projectName}`,
			`Base Branch: ${effectiveBaseBranch}`,
			`Working Copy: ${isWorktree ? "Isolated Git Worktree" : "Direct Branch"}`,
			projectBranch && projectBranch !== effectiveBaseBranch ? `Branch: ${projectBranch}` : null,
			projectRepo ? `Repository: ${projectRepo}` : null,
			projectPath ? `Working Directory: ${projectPath}` : null,
			projectUri && projectUri !== projectPath ? `URI: ${projectUri}` : null,
			activeConv?.id ? `Session ID: ${activeConv.id}` : null,
			activeConv?.title ? `Session Title: ${activeConv.title}` : null,
			bot?.name ? `Bot: ${bot.name} (${botType})` : null,
			`Status: ${sessionStatus}`,
		].filter(Boolean)

		copyText(lines.join("\n"), "all")
	}

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="project-modal-title"
		>
			<div className="modal-card modal-card--project" onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="modal-header">
					<div className="modal-title-row">
						<span className="project-modal-icon-badge" aria-hidden="true">
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
							</svg>
						</span>
						<div>
							<h3 id="project-modal-title" className="modal-title">
								Project & Workspace Info
							</h3>
							<p className="modal-subtitle">
								Details about the current chat's project and workspace
							</p>
						</div>
					</div>
					<button
						type="button"
						className="modal-close-btn"
						onClick={onClose}
						aria-label="Close project info modal"
					>
						✕
					</button>
				</div>

				{/* Body */}
				<div className="modal-body project-modal-body">
					{/* Project Hero Card */}
					<div className="project-hero-card">
						<div className="project-hero-header">
							<div className="project-hero-title-group">
								<span className="project-hero-name" title={projectName}>
									{projectName}
								</span>
								{projectBranch && (
									<span className="project-branch-tag" title={`Git branch: ${projectBranch}`}>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="6" y1="3" x2="6" y2="15" />
											<circle cx="18" cy="6" r="3" />
											<circle cx="6" cy="18" r="3" />
											<path d="M18 9a9 9 0 0 1-9 9" />
										</svg>
										<span>{projectBranch}</span>
									</span>
								)}
							</div>

							<div className="project-hero-badges">
								<span
									className={`bot-protocol-badge bot-protocol-badge--${bot?.bot_type === "ahp" ? "ahp" : "chat"}`}
								>
									{botType}
								</span>
								<span className="project-status-pill">
									<span className={`conv-status-dot conv-status-dot--${sessionStatus}`} />
									<span className="capitalize">{sessionStatus}</span>
								</span>
							</div>
						</div>

						{projectRepo && (
							<div className="project-hero-repo">
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<circle cx="12" cy="12" r="10" />
									<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
									<path d="M2 12h20" />
								</svg>
								<span className="project-hero-repo-text">{projectRepo}</span>
								<button
									type="button"
									className="project-copy-inline-btn"
									onClick={() => copyText(projectRepo, "repo")}
									title="Copy repository link"
								>
									{copiedField === "repo" ? "✓ Copied" : "Copy"}
								</button>
							</div>
						)}
					</div>

					{/* Git Working Copy & Base Branch Section */}
					<div className="project-section" data-testid="project-git-section">
						<span className="project-section-label">Git Working Copy & Base Branch</span>
						<div className="project-info-grid">
							<div className="project-info-cell">
								<span className="project-cell-label">Base Branch</span>
								<div className="project-cell-value-group">
									<span
										className="project-branch-tag"
										title={`Base branch: ${effectiveBaseBranch}`}
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="6" y1="3" x2="6" y2="15" />
											<circle cx="18" cy="6" r="3" />
											<circle cx="6" cy="18" r="3" />
											<path d="M18 9a9 9 0 0 1-9 9" />
										</svg>
										<strong className="text-emerald-300 font-mono text-xs">
											{effectiveBaseBranch}
										</strong>
									</span>
									<button
										type="button"
										className="project-copy-inline-btn"
										onClick={() => copyText(effectiveBaseBranch, "base-branch")}
										title="Copy Base Branch"
									>
										{copiedField === "base-branch" ? "✓" : "Copy"}
									</button>
								</div>
							</div>

							<div className="project-info-cell">
								<span className="project-cell-label">Working Copy Type</span>
								<div className="project-cell-value-group">
									<span
										className={`chat-target-badge ${isWorktree ? "chat-target-badge--worktree" : "chat-target-badge--branch"}`}
									>
										{isWorktree ? (
											<span className="text-amber-400">⚡ Isolated Worktree</span>
										) : (
											<span className="text-emerald-400">🌿 Direct Branch</span>
										)}
									</span>
								</div>
								<p className="text-xs text-zinc-400 mt-1">
									{isWorktree
										? `Working in isolated git worktree against base branch "${effectiveBaseBranch}". Protects active branch and uncommitted files.`
										: `Working directly on branch "${effectiveBaseBranch}". Changes are written directly into your local working tree.`}
								</p>
							</div>
						</div>
					</div>

					{/* Working Directory / Path Section */}
					<div className="project-section">
						<div className="project-section-header">
							<span className="project-section-label">Working Directory</span>
							{projectPath && (
								<button
									type="button"
									className="project-copy-action-btn"
									onClick={() => copyText(projectPath, "path")}
									title="Copy full directory path"
								>
									{copiedField === "path" ? (
										<>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.5"
											>
												<polyline points="20 6 9 17 4 12" />
											</svg>
											<span>Copied!</span>
										</>
									) : (
										<>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
											>
												<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
												<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
											</svg>
											<span>Copy Path</span>
										</>
									)}
								</button>
							)}
						</div>

						{projectPath ? (
							<div className="project-path-box">
								<code className="project-path-code">{projectPath}</code>
							</div>
						) : (
							<div className="project-empty-notice">
								No working directory path has been assigned to this chat.
							</div>
						)}

						{/* Multiple working directories */}
						{workingDirs.length > 1 && (
							<div className="project-additional-dirs">
								<span className="project-sublabel">
									All Configured Directories ({workingDirs.length})
								</span>
								<ul className="project-dirs-list">
									{workingDirs.map((dir, idx) => (
										<li key={idx} className="project-dir-item">
											<code className="project-path-code text-xs">{dir}</code>
											<button
												type="button"
												className="project-copy-inline-btn"
												onClick={() => copyText(dir, `dir-${idx}`)}
												title="Copy path"
											>
												{copiedField === `dir-${idx}` ? "✓" : "Copy"}
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>

					{/* Session Context Section */}
					<div className="project-section">
						<span className="project-section-label">Active Session Context</span>
						<div className="project-info-grid">
							<div className="project-info-cell">
								<span className="project-cell-label">Session ID</span>
								<div className="project-cell-value-group">
									<code className="project-cell-code">
										{activeConv?.id ? String(activeConv.id).slice(0, 18) : "None"}
									</code>
									{activeConv?.id && (
										<button
											type="button"
											className="project-copy-inline-btn"
											onClick={() => copyText(String(activeConv.id), "session-id")}
											title="Copy Session ID"
										>
											{copiedField === "session-id" ? "✓" : "Copy"}
										</button>
									)}
								</div>
							</div>

							<div className="project-info-cell">
								<span className="project-cell-label">Session Title</span>
								<span className="project-cell-text" title={activeConv?.title || "Untitled"}>
									{activeConv?.title || "Untitled"}
								</span>
							</div>

							<div className="project-info-cell">
								<span className="project-cell-label">Assigned Bot</span>
								<span className="project-cell-text">{bot?.name || "None"}</span>
							</div>

							{(stepText || toolText) && (
								<div className="project-info-cell project-info-cell--full">
									<span className="project-cell-label">Active Step / Tool</span>
									<span className="project-cell-text font-mono text-xs text-blue-300">
										{stepText || toolText}
									</span>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="modal-actions project-modal-actions">
					<button type="button" className="modal-btn modal-btn--cancel" onClick={handleCopyAll}>
						{copiedField === "all" ? "✓ Copied All Info!" : "Copy All Info"}
					</button>
					<button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>
						Done
					</button>
				</div>
			</div>
		</div>
	)
}
