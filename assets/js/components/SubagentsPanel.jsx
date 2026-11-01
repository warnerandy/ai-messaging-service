import React, { useState, useEffect } from "react"
import { VSCodeWorkingStateIcon, VSCodeGearIcon } from "./VSCodeWorkingIcons.jsx"
import {
	formatSessionTitle,
	getSessionSubagents,
	getSessionProcesses,
	findParentSession,
	getParentSessionId,
	isSessionNested,
} from "../lib/projectInfo.js"
import { getConversation } from "../lib/data.js"

export default function SubagentsPanel({
	token,
	bot,
	activeConv,
	conversations = [],
	sessionStatus = "idle",
	sessionMetadata = {},
	thinkingText = "",
	toolCalls = [],
	onSelectConversation,
	isOpen,
	onClose,
	onOpen,
	defaultOpen,
}) {
	const [internalOpen, setInternalOpen] = useState(
		defaultOpen !== undefined ? defaultOpen : isOpen === undefined ? true : false,
	)
	const isPanelOpen = isOpen !== undefined ? isOpen : internalOpen

	const [activeTab, setActiveTab] = useState("running") // "running" | "processes" | "all"
	const [selectedSubagentId, setSelectedSubagentId] = useState(null)
	const [inspectedData, setInspectedData] = useState(null)
	const [loadingInspector, setLoadingInspector] = useState(false)
	const [selectedProcessId, setSelectedProcessId] = useState(null)
	const [subagentsExpanded, setSubagentsExpanded] = useState(true)
	const [processesExpanded, setProcessesExpanded] = useState(true)
	const [completedExpanded, setCompletedExpanded] = useState(false)

	const isAhp = bot?.bot_type === "ahp"
	const subagents = getSessionSubagents(activeConv, conversations, sessionMetadata, toolCalls)
	const processes = getSessionProcesses(activeConv, sessionMetadata, toolCalls, sessionStatus)
	const runningSubagents = subagents.filter((s) => s.isRunning)
	const completedSubagents = subagents.filter((s) => !s.isRunning)
	const runningProcesses = processes.filter((p) => p.isRunning)

	const isNested = isSessionNested(activeConv, conversations)
	const parentSession = isNested ? findParentSession(activeConv, conversations) : null
	const parentSessionId = isNested ? getParentSessionId(activeConv) : null

	const selectedSubagent = subagents.find((s) => s.id === selectedSubagentId) || null
	const selectedProcess = processes.find((p) => p.id === selectedProcessId) || null

	const handleClose = () => {
		setInternalOpen(false)
		if (onClose) onClose()
	}

	const handleOpen = () => {
		setInternalOpen(true)
		if (onOpen) onOpen()
	}

	// Escape key to close panel
	useEffect(() => {
		if (!isPanelOpen) return
		const handleKeyDown = (e) => {
			if (e.key === "Escape") {
				handleClose()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [isPanelOpen])

	// Reset inspector selection when switching conversations
	useEffect(() => {
		setSelectedSubagentId(null)
		setInspectedData(null)
		setSelectedProcessId(null)
	}, [activeConv?.id])

	// Fetch live conversation details when a subagent with a conversationId is clicked
	useEffect(() => {
		if (!selectedSubagent || !selectedSubagent.conversationId || !token) {
			setInspectedData(null)
			setLoadingInspector(false)
			return
		}

		let cancelled = false
		setLoadingInspector(true)

		async function fetchSubagentDetails() {
			try {
				const res = await getConversation(token, selectedSubagent.conversationId, { limit: 20 })
				if (!cancelled && res) {
					setInspectedData(res)
				}
			} catch {
				// Ignore fetch errors in inspector preview
			} finally {
				if (!cancelled) {
					setLoadingInspector(false)
				}
			}
		}

		fetchSubagentDetails()
		return () => {
			cancelled = true
		}
	}, [selectedSubagent?.conversationId, selectedSubagent?.status, selectedSubagent?.step, token])

	if (!isAhp) return null

	const hasSubagents = subagents.length > 0
	const hasProcesses = processes.length > 0

	if (!hasSubagents && !hasProcesses && !isNested) {
		return null
	}

	const formatStatusLabel = (st) => {
		if (!st) return "Idle"
		if (st === "thinking") return "Thinking"
		if (st === "running") return "Running"
		if (st === "waiting_for_input" || st === "needs_input") return "Waiting for Input"
		if (st === "completed" || st === "done") return "Completed"
		return String(st).replace(/_/g, " ")
	}

	const inspectedConv = inspectedData?.conversation || selectedSubagent?.conversation
	const inspectedMeta = {
		...(selectedSubagent?.conversation?.metadata || {}),
		...(inspectedConv?.metadata || {}),
	}
	const inspectedMessages = Array.isArray(inspectedData?.messages) ? inspectedData.messages : []
	const inspectedThinking =
		selectedSubagent?.thinking || inspectedMeta.thinking || inspectedMeta.thought || ""
	const inspectedTools =
		selectedSubagent?.toolCalls?.length > 0
			? selectedSubagent.toolCalls
			: Array.isArray(inspectedMeta.tool_calls)
				? inspectedMeta.tool_calls
				: []
	const inspectedStep =
		selectedSubagent?.step ||
		inspectedMeta.step ||
		inspectedMeta.current_step ||
		inspectedMeta.action ||
		""

	// Filter subagents based on current tab: "running" shows only running; "all" shows all
	const displayedSubagents = activeTab === "all" ? subagents : runningSubagents
	const displayedProcesses = activeTab === "all" ? processes : runningProcesses

	const shouldShowSubagents = activeTab === "running" || activeTab === "all"
	const shouldShowProcesses =
		activeTab === "processes" ||
		(activeTab === "running" && (runningProcesses.length > 0 || runningSubagents.length === 0)) ||
		activeTab === "all"

	const renderSubagentCard = (sub) => {
		const isSelected = selectedSubagentId === sub.id
		return (
			<button
				key={sub.id}
				type="button"
				role="listitem"
				data-testid={`subagent-card-${sub.id}`}
				className={[
					"subagent-card",
					sub.isRunning ? "subagent-card--running" : "subagent-card--idle",
					isSelected ? "subagent-card--selected" : "",
				]
					.filter(Boolean)
					.join(" ")}
				onClick={() => setSelectedSubagentId((prev) => (prev === sub.id ? null : sub.id))}
				aria-pressed={isSelected}
				title={`Click to inspect ${sub.title}`}
			>
				<div className="subagent-card__top">
					<span className="subagent-card__icon">
						<VSCodeWorkingStateIcon
							status={sub.status || "idle"}
							size={14}
							className="inline-flex"
						/>
					</span>
					<span className="subagent-card__title">{sub.title}</span>
					<span className={`subagent-card__status subagent-card__status--${sub.status || "idle"}`}>
						{formatStatusLabel(sub.status)}
					</span>
				</div>

				{(sub.step || sub.tool || sub.prompt) && (
					<div className="subagent-card__activity">
						{sub.tool && (
							<span className="subagent-card__tool-chip">
								<VSCodeGearIcon size={10} spin={sub.isRunning} className="inline mr-1" />
								{sub.tool}
							</span>
						)}
						<span className="subagent-card__step">{sub.step || sub.prompt || "Working..."}</span>
					</div>
				)}
			</button>
		)
	}

	return (
		<>
			{/* Parent Session Breadcrumb bar when viewing a subagent session (always visible inline) */}
			{isNested && (
				<div className="subagent-parent-bar" data-testid="subagent-parent-bar">
					<div className="subagent-parent-bar__info">
						<span className="subagent-parent-bar__icon" aria-hidden="true">
							↳
						</span>
						<span className="subagent-parent-bar__label">Subagent Session</span>
						{(parentSession || parentSessionId) && (
							<span className="subagent-parent-bar__parent">
								of{" "}
								<strong>
									{parentSession
										? formatSessionTitle(parentSession.title || parentSession.external_session_id)
										: formatSessionTitle(parentSessionId)}
								</strong>
							</span>
						)}
					</div>
					<div className="subagent-parent-bar__actions">
						{(hasSubagents || hasProcesses) && (
							<button
								type="button"
								className="subagent-parent-bar__inspect-btn"
								onClick={handleOpen}
								data-testid="open-subagents-from-bar"
								title="Open running subagents panel"
							>
								⚡ Inspect Subagents{" "}
								{runningSubagents.length > 0 ? `(${runningSubagents.length})` : ""}
							</button>
						)}
						{parentSession && onSelectConversation && (
							<button
								type="button"
								className="subagent-parent-bar__back-btn"
								onClick={() => onSelectConversation(parentSession.id)}
								title="Return to parent session"
							>
								← Back to Parent Session
							</button>
						)}
					</div>
				</div>
			)}

			{/* Subagents & Processes Inspector Panel (Slide-over drawer) */}
			{isPanelOpen && (
				<div
					className="subagents-drawer-backdrop"
					onClick={handleClose}
					data-testid="subagents-drawer-backdrop"
				>
					<div
						className="subagents-drawer"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label="Running Subagents and Processes"
						data-testid="subagents-drawer"
					>
						{/* Drawer Header */}
						<div className="subagents-drawer__header">
							<div className="subagents-drawer__title-group">
								<span className="subagents-drawer__icon" aria-hidden="true">
									⚡
								</span>
								<div>
									<h3 className="subagents-drawer__title">Running Subagents & Processes</h3>
									<p className="subagents-drawer__subtitle">
										{runningSubagents.length} active running subagent
										{runningSubagents.length === 1 ? "" : "s"} • {runningProcesses.length} active
										process{runningProcesses.length === 1 ? "" : "es"}
									</p>
								</div>
							</div>
							<button
								type="button"
								className="subagents-drawer__close-btn"
								onClick={handleClose}
								aria-label="Close panel"
								data-testid="close-subagents-panel"
								title="Close panel (Esc)"
							>
								✕ Close
							</button>
						</div>

						{/* Segmented Filter Tabs */}
						<div
							className="subagents-drawer__tabs"
							role="tablist"
							aria-label="Filter subagents and processes"
						>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "running"}
								className={`subagents-tab ${activeTab === "running" ? "subagents-tab--active" : ""}`}
								onClick={() => {
									setActiveTab("running")
									setCompletedExpanded(false)
								}}
								data-testid="tab-running-subagents"
							>
								<span className="subagents-tab__icon">⚡</span>
								<span>Running ({runningSubagents.length})</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "processes"}
								className={`subagents-tab ${activeTab === "processes" ? "subagents-tab--active" : ""}`}
								onClick={() => setActiveTab("processes")}
								data-testid="tab-processes"
							>
								<span className="subagents-tab__icon">⚙️</span>
								<span>Processes ({processes.length})</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "all"}
								className={`subagents-tab ${activeTab === "all" ? "subagents-tab--active" : ""}`}
								onClick={() => {
									setActiveTab("all")
									setCompletedExpanded(true)
								}}
								data-testid="tab-all-subagents"
							>
								<span>All Subagents ({subagents.length})</span>
							</button>
						</div>

						{/* Drawer Scrollable Body */}
						<div className="subagents-drawer__body">
							{/* Subagents Section */}
							{hasSubagents && shouldShowSubagents && (
								<div className="subagents-section" data-testid="subagents-section">
									<div className="subagents-header">
										<button
											type="button"
											className="subagents-header__toggle"
											onClick={() => setSubagentsExpanded((prev) => !prev)}
											aria-expanded={subagentsExpanded}
											aria-label={subagentsExpanded ? "Collapse subagents" : "Expand subagents"}
										>
											<span className="subagents-header__chevron">
												{subagentsExpanded ? "▾" : "▸"}
											</span>
											<span className="subagents-header__title">
												{activeTab === "running" ? "Running Subagents" : "Subagents"}
											</span>
											{runningSubagents.length > 0 && (
												<span className="subagents-badge subagents-badge--running">
													<VSCodeWorkingStateIcon
														status="running"
														size={11}
														className="inline mr-1"
													/>
													{runningSubagents.length} running
												</span>
											)}
											<span className="subagents-badge subagents-badge--total">
												{subagents.length} total
											</span>
										</button>
									</div>

									{subagentsExpanded && (
										<>
											{/* Running subagents grid */}
											{runningSubagents.length > 0 && (
												<div
													className="subagents-grid"
													role="list"
													aria-label="Running subagents"
													data-testid="running-subagents-grid"
												>
													{runningSubagents.map(renderSubagentCard)}
												</div>
											)}

											{/* Notice when no subagents are currently running */}
											{runningSubagents.length === 0 && completedSubagents.length > 0 && (
												<div
													className="subagents-all-completed-banner"
													data-testid="subagents-all-completed-banner"
												>
													<span className="subagents-all-completed-banner__icon">✓</span>
													<span>No active subagents running.</span>
												</div>
											)}

											{/* Collapsible item for completed subagents */}
											{completedSubagents.length > 0 && (
												<div
													className="completed-subagents-group"
													data-testid="completed-subagents-group"
												>
													<button
														type="button"
														className="completed-subagents-toggle"
														data-testid="toggle-completed-subagents"
														onClick={() => setCompletedExpanded((prev) => !prev)}
														aria-expanded={completedExpanded}
														aria-label={
															completedExpanded
																? "Collapse completed subagents"
																: "Expand completed subagents"
														}
													>
														<div className="completed-subagents-toggle__left">
															<span className="completed-subagents-toggle__chevron">
																{completedExpanded ? "▾" : "▸"}
															</span>
															<span className="completed-subagents-toggle__icon">✓</span>
															<span className="completed-subagents-toggle__title">
																Completed Subagents
															</span>
															<span className="completed-subagents-toggle__count">
																({completedSubagents.length})
															</span>
														</div>
														<span className="completed-subagents-toggle__action">
															{completedExpanded ? "Collapse" : "Expand"}
														</span>
													</button>

													{completedExpanded && (
														<div
															className="subagents-grid completed-subagents-grid"
															role="list"
															aria-label="Completed subagents"
															data-testid="completed-subagents-list"
														>
															{completedSubagents.map(renderSubagentCard)}
														</div>
													)}
												</div>
											)}

											{/* Empty state when no subagents exist in session */}
											{subagents.length === 0 && (
												<div className="subagents-empty-state" data-testid="subagents-empty-state">
													<span className="subagents-empty-state__icon">ℹ️</span>
													<p className="subagents-empty-state__title">No subagents</p>
													<p className="subagents-empty-state__desc">
														No subagents have been launched in this session.
													</p>
												</div>
											)}
										</>
									)}

									{/* Clicked Subagent Live Activity Inspector */}
									{selectedSubagent && (
										<div
											className="subagent-inspector"
											data-testid="subagent-inspector"
											role="region"
											aria-label={`Subagent inspector: ${selectedSubagent.title}`}
										>
											<div className="subagent-inspector__header">
												<div className="subagent-inspector__title-row">
													<VSCodeWorkingStateIcon
														status={selectedSubagent.status || "idle"}
														size={16}
													/>
													<div className="subagent-inspector__titles">
														<span className="subagent-inspector__title">
															{selectedSubagent.title}
														</span>
														{selectedSubagent.role && (
															<span className="subagent-inspector__role">
																Role: {selectedSubagent.role}
															</span>
														)}
													</div>
													<span
														className={`subagent-inspector__badge subagent-inspector__badge--${selectedSubagent.status || "idle"}`}
													>
														{formatStatusLabel(selectedSubagent.status)}
													</span>
												</div>
												<div className="subagent-inspector__header-actions">
													{selectedSubagent.conversationId && onSelectConversation && (
														<button
															type="button"
															className="subagent-inspector__open-btn"
															data-testid="open-subagent-session-btn"
															onClick={() => {
																handleClose()
																onSelectConversation(selectedSubagent.conversationId)
															}}
															title="Open full subagent session chat"
														>
															Open Subagent Session →
														</button>
													)}
													<button
														type="button"
														className="subagent-inspector__close-btn"
														onClick={() => setSelectedSubagentId(null)}
														title="Close inspector"
														aria-label="Close subagent inspector"
													>
														✕
													</button>
												</div>
											</div>

											<div className="subagent-inspector__content">
												{inspectedStep && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">Current Action</span>
														<p className="subagent-inspector__step">{inspectedStep}</p>
													</div>
												)}

												{selectedSubagent.prompt && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">Assigned Goal / Task</span>
														<p className="subagent-inspector__prompt">{selectedSubagent.prompt}</p>
													</div>
												)}

												{inspectedTools.length > 0 && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">Tool Execution</span>
														<div className="subagent-inspector__tools">
															{inspectedTools.map((tc, idx) => (
																<div key={idx} className="subagent-inspector__tool-item">
																	<VSCodeGearIcon
																		size={12}
																		spin={selectedSubagent.isRunning}
																		className="inline mr-1 text-emerald-400"
																	/>
																	<span className="font-mono text-xs">
																		{tc.name || tc.tool || "tool_call"}
																	</span>
																	{tc.step && (
																		<span className="text-xs opacity-75"> — {tc.step}</span>
																	)}
																</div>
															))}
														</div>
													</div>
												)}

												{inspectedThinking && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">
															Reasoning & Execution Stream
														</span>
														<pre className="subagent-inspector__thinking">{inspectedThinking}</pre>
													</div>
												)}

												{selectedSubagent.output && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">Result / Output</span>
														<pre className="subagent-inspector__thinking">
															{selectedSubagent.output}
														</pre>
													</div>
												)}

												{loadingInspector && (
													<div className="subagent-inspector__loading">
														Loading subagent activity log...
													</div>
												)}

												{inspectedMessages.length > 0 && (
													<div className="subagent-inspector__block">
														<span className="subagent-inspector__label">
															Recent Subagent Messages ({inspectedMessages.length})
														</span>
														<div className="subagent-inspector__messages">
															{inspectedMessages.slice(-4).map((m) => (
																<div
																	key={m.id}
																	className={`subagent-inspector__msg subagent-inspector__msg--${m.role}`}
																>
																	<span className="subagent-inspector__msg-role">
																		{m.role === "bot" ? "Subagent" : m.role}:
																	</span>
																	<span className="subagent-inspector__msg-body">{m.body}</span>
																</div>
															))}
														</div>
													</div>
												)}
											</div>
										</div>
									)}
								</div>
							)}

							{/* Running Processes Section */}
							{hasProcesses && shouldShowProcesses && (
								<div className="processes-section" data-testid="running-processes-section">
									<div className="processes-header">
										<button
											type="button"
											className="processes-header__toggle"
											onClick={() => setProcessesExpanded((prev) => !prev)}
											aria-expanded={processesExpanded}
											aria-label={processesExpanded ? "Collapse processes" : "Expand processes"}
										>
											<span className="subagents-header__chevron">
												{processesExpanded ? "▾" : "▸"}
											</span>
											<span className="processes-header__title">
												{activeTab === "running" ? "Active Processes" : "Running Processes"}
											</span>
											{runningProcesses.length > 0 ? (
												<span className="subagents-badge subagents-badge--running">
													<VSCodeGearIcon size={11} spin={true} className="inline mr-1" />
													{runningProcesses.length} active
												</span>
											) : (
												<span className="subagents-badge subagents-badge--total">
													{processes.length} executed
												</span>
											)}
										</button>
									</div>

									{processesExpanded && (
										<div className="processes-list" role="list" aria-label="Session processes">
											{displayedProcesses.slice(-12).map((proc) => {
												const isSelected = selectedProcessId === proc.id
												return (
													<div key={proc.id} className="process-item-wrapper" role="listitem">
														<button
															type="button"
															data-testid={`process-item-${proc.id}`}
															className={[
																"process-item",
																proc.isRunning
																	? "process-item--running"
																	: "process-item--completed",
																proc.isError ? "process-item--error" : "",
																isSelected ? "process-item--selected" : "",
															]
																.filter(Boolean)
																.join(" ")}
															onClick={() =>
																setSelectedProcessId((prev) => (prev === proc.id ? null : proc.id))
															}
															aria-expanded={isSelected}
														>
															<span className="process-item__icon">
																<VSCodeGearIcon
																	size={12}
																	spin={proc.isRunning}
																	className={proc.isRunning ? "text-emerald-400" : "opacity-70"}
																/>
															</span>
															<code className="process-item__name">{proc.name}</code>
															{proc.pid && (
																<span className="process-item__pid">PID {proc.pid}</span>
															)}
															{proc.step && proc.step !== proc.name && (
																<span className="process-item__step">{proc.step}</span>
															)}
															<span
																className={`process-item__status process-item__status--${proc.isRunning ? "running" : "completed"}`}
															>
																{proc.isRunning ? "Running" : proc.isError ? "Failed" : "Done"}
															</span>
														</button>

														{isSelected && selectedProcess && (
															<div
																className="process-item__details"
																data-testid={`process-details-${proc.id}`}
															>
																{selectedProcess.command && (
																	<div className="process-detail-row">
																		<span className="process-detail-label">Command:</span>
																		<code className="process-detail-code">
																			{selectedProcess.command}
																		</code>
																	</div>
																)}
																{selectedProcess.step && (
																	<div className="process-detail-row">
																		<span className="process-detail-label">Step:</span>
																		<span className="process-detail-text">
																			{selectedProcess.step}
																		</span>
																	</div>
																)}
																{selectedProcess.args &&
																	typeof selectedProcess.args === "object" &&
																	Object.keys(selectedProcess.args).length > 0 && (
																		<div className="process-detail-row">
																			<span className="process-detail-label">Arguments:</span>
																			<pre className="process-detail-pre">
																				{JSON.stringify(selectedProcess.args, null, 2)}
																			</pre>
																		</div>
																	)}
																{(selectedProcess.output ||
																	(selectedProcess.isRunning && thinkingText)) && (
																	<div className="process-detail-row">
																		<span className="process-detail-label">Process Output:</span>
																		<pre className="process-detail-pre">
																			{selectedProcess.output || thinkingText}
																		</pre>
																	</div>
																)}
															</div>
														)}
													</div>
												)
											})}
										</div>
									)}
								</div>
							)}
						</div>

						{/* Drawer Footer */}
						<div className="subagents-drawer__footer">
							<button
								type="button"
								className="subagents-drawer__return-btn"
								onClick={handleClose}
								title="Return to conversation"
							>
								← Return to Chat
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	)
}
