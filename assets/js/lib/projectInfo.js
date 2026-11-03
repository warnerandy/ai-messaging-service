/**
 * Utility functions for extracting and formatting project and workspace metadata
 * from conversation models and live Phoenix Channel session payloads.
 */

/**
 * Checks whether a string looks like a raw UUID, internal hash, or AHP URI
 * rather than a human-readable name or label.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isUuidOrHash(str) {
	if (!str || typeof str !== "string") return false
	const s = str.trim()
	if (!s) return false

	if (
		/^ahp[-a-z0-9_]*:/i.test(s) ||
		s.includes("ahp-chat") ||
		s.includes("copilotUri") ||
		s.includes("workspaceStorage")
	) {
		return true
	}

	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
		return true
	}

	if (
		/^[a-z0-9_-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[a-z0-9_-]*$/i.test(s)
	) {
		return true
	}

	if (/^[0-9a-f]{24,}$/i.test(s)) {
		return true
	}

	return false
}

/**
 * Normalizes a raw URI or filesystem path into a human-readable local path string.
 * Handles `file:///` prefixes, URL encodings, and Windows drive letters.
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatProjectPath(raw) {
	if (!raw || typeof raw !== "string") return ""
	let path = raw.trim()

	if (path.startsWith("file://")) {
		path = decodeURIComponent(path.replace(/^file:\/\/\/?/, "/"))
		// Fix Windows drive letter: /c:/Users -> c:/Users
		if (/^\/[a-zA-Z]:/.test(path)) {
			path = path.slice(1)
		}
	}

	return path
}

/**
 * Extracts comprehensive project information from a conversation object and/or live session metadata.
 *
 * Checks:
 * - meta.project (object or string)
 * - meta.working_directories (array of paths/URIs)
 * - meta.working_directory / meta.workspace / meta.cwd
 * - meta.branch / meta.git_branch
 * - meta.repository / meta.repo
 *
 * @param {object} [conv] - The conversation object
 * @param {object} [sessionMetadata] - Live session metadata from channel events
 * @returns {{
 *   hasProject: boolean,
 *   name: string,
 *   uri: string,
 *   path: string,
 *   branch: string,
 *   repository: string,
 *   workingDirectories: string[],
 * }}
 */
export function getProjectInfo(conv, sessionMetadata = {}) {
	const meta = {
		...(conv?.metadata || {}),
		...(sessionMetadata || {}),
	}

	const project = meta.project
	let name = ""
	let uri = ""
	let path = ""
	let branch = meta.branch || meta.git_branch || ""
	let repository = meta.repository || meta.repo || ""
	let workingDirectories = []

	if (Array.isArray(meta.working_directories)) {
		workingDirectories = meta.working_directories.map(String).filter(Boolean)
	}

	if (typeof project === "object" && project !== null) {
		if (project.name) name = String(project.name).trim()
		if (project.uri) uri = String(project.uri).trim()
		if (project.path) path = String(project.path).trim()
		if (project.branch && !branch) branch = String(project.branch).trim()
		if (project.repository && !repository) repository = String(project.repository).trim()
		if (Array.isArray(project.working_directories) && workingDirectories.length === 0) {
			workingDirectories = project.working_directories.map(String).filter(Boolean)
		}
	} else if (typeof project === "string" && project.trim() !== "") {
		name = project.trim()
	}

	if (!uri) {
		if (workingDirectories.length > 0) {
			uri = workingDirectories[0]
		} else if (meta.working_directory) {
			uri = String(meta.working_directory).trim()
		} else if (meta.workspace) {
			uri = String(meta.workspace).trim()
		} else if (meta.cwd) {
			uri = String(meta.cwd).trim()
		}
	}

	if (!path && uri) {
		path = formatProjectPath(uri)
	}

	if (!name) {
		const raw = path || uri
		const isInternalStorage =
			raw &&
			(raw.includes("workspaceStorage") ||
				raw.includes("workspace-storage") ||
				raw.includes("AppData/Roaming/Code"))

		if (raw && !isInternalStorage) {
			const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean)
			while (parts.length > 0) {
				const candidate = parts.pop()
				if (!candidate) continue
				const lower = candidate.toLowerCase()
				if (
					isUuidOrHash(candidate) ||
					lower === "workspacestorage" ||
					lower === ".vscode" ||
					lower === "code" ||
					lower === "user" ||
					lower === "appdata" ||
					lower === "roaming"
				) {
					continue
				}
				name = candidate
				break
			}
		} else if (typeof meta.workspace === "string" && meta.workspace.trim()) {
			const candidate = meta.workspace.trim()
			if (!isUuidOrHash(candidate)) {
				name = candidate
			}
		}
	}

	if (isUuidOrHash(name)) {
		name = ""
	}

	const hasProject = Boolean(
		name || uri || path || branch || repository || workingDirectories.length > 0,
	)

	return {
		hasProject,
		name: name || "",
		uri: uri || "",
		path: path || uri || "",
		branch: branch || "",
		repository: repository || "",
		workingDirectories,
	}
}

/**
 * Backward-compatible helper for Sidebar.jsx.
 * Returns null if no project info is present, or an object with name, uri, path, branch, etc.
 *
 * @param {object} conv
 * @returns {object|null}
 */
export function getSessionProjectInfo(conv) {
	if (!conv || !conv.metadata) return null
	const info = getProjectInfo(conv)
	if (!info.hasProject) return null
	return {
		name: info.name,
		uri: info.uri,
		path: info.path,
		branch: info.branch,
		repository: info.repository,
		workingDirectories: info.workingDirectories,
	}
}

/**
 * Formats a raw or internal session title, preventing raw UUIDs, AHP URIs,
 * or verbose "Session <uuid>" strings from polluting the UI.
 *
 * @param {string} [title]
 * @returns {string}
 */
export function formatSessionTitle(title) {
	if (!title || typeof title !== "string") return "Session"
	const trimmed = title.trim()
	if (!trimmed) return "Session"

	if (isUuidOrHash(trimmed)) {
		const match = trimmed.match(/[0-9a-f]{8}/i)
		return match ? `Session (${match[0]})` : "Session"
	}

	const sessionUuidMatch = trimmed.match(
		/^Session[:\s]+(?:[a-z0-9_-]*)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
	)
	if (sessionUuidMatch) {
		return `Session (${sessionUuidMatch[1].slice(0, 8)})`
	}

	return trimmed
}

/**
 * Extracts project metadata suitable for creating a new session within an existing project group.
 * Copies the project configuration, working directories, and git repository/branch information
 * from the group or its existing conversations.
 *
 * @param {object} [group]
 * @returns {object}
 */
export function getProjectMetadataForGroup(group) {
	if (!group || !group.hasProject || !group.name || group.name === "No Project") {
		return {}
	}

	const sample = Array.isArray(group.conversations) ? group.conversations[0] : null
	const sampleMeta = sample?.metadata || {}

	const projectMeta = {}

	if (sampleMeta.project) {
		if (typeof sampleMeta.project === "object" && sampleMeta.project !== null) {
			projectMeta.project = { ...sampleMeta.project }
		} else {
			projectMeta.project = {
				name: group.name,
				...(group.path ? { path: group.path } : {}),
				...(group.repository ? { repository: group.repository } : {}),
				...(group.branch ? { branch: group.branch } : {}),
			}
		}
	} else {
		projectMeta.project = {
			name: group.name,
			...(group.path ? { path: group.path } : {}),
			...(group.repository ? { repository: group.repository } : {}),
			...(group.branch ? { branch: group.branch } : {}),
		}
	}

	if (Array.isArray(sampleMeta.working_directories) && sampleMeta.working_directories.length > 0) {
		projectMeta.working_directories = [...sampleMeta.working_directories]
	} else if (Array.isArray(group.workingDirectories) && group.workingDirectories.length > 0) {
		projectMeta.working_directories = [...group.workingDirectories]
	} else if (group.path) {
		projectMeta.working_directories = [group.path]
	}

	if (sampleMeta.working_directory) {
		projectMeta.working_directory = sampleMeta.working_directory
	} else if (group.path) {
		projectMeta.working_directory = group.path
	}

	if (sampleMeta.workspace && !isUuidOrHash(sampleMeta.workspace)) {
		projectMeta.workspace = sampleMeta.workspace
	}

	if (sampleMeta.cwd) {
		projectMeta.cwd = sampleMeta.cwd
	}

	if (sampleMeta.git_branch || sampleMeta.branch || group.branch) {
		projectMeta.git_branch = sampleMeta.git_branch || sampleMeta.branch || group.branch
	}

	if (sampleMeta.repository || sampleMeta.repo || group.repository) {
		projectMeta.repository = sampleMeta.repository || sampleMeta.repo || group.repository
	}

	return projectMeta
}

/**
 * Extracts the parent session ID from a conversation if present.
 * Inspects both top-level conversation fields and metadata keys
 * (parent_session_id, parentSessionId, parent_id, parentId, parent).
 *
 * @param {object} [conv]
 * @returns {string|null}
 */
export function getParentSessionId(conv) {
	if (!conv) return null
	const meta = conv.metadata || {}

	const rawParentId =
		conv.parent_session_id ??
		conv.parentSessionId ??
		conv.parent_id ??
		conv.parentId ??
		meta.parent_session_id ??
		meta.parentSessionId ??
		meta.parent_id ??
		meta.parentId ??
		(typeof meta.parent === "string" ? meta.parent : (meta.parent?.session_id ?? meta.parent?.id))

	if (rawParentId !== null && rawParentId !== undefined) {
		const str = String(rawParentId).trim()
		if (str !== "") return str
	}

	return null
}

/**
 * Determines whether a conversation is a nested child session.
 * Checks for parent session identifiers, nested flags (nested: true, is_nested: true),
 * or whether another conversation in allConversations references this session as a child.
 *
 * @param {object} [conv]
 * @param {object[]} [allConversations=[]]
 * @returns {boolean}
 */
export function isSessionNested(conv, allConversations = []) {
	if (!conv) return false

	if (getParentSessionId(conv)) {
		return true
	}

	const meta = conv.metadata || {}
	if (
		conv.nested === true ||
		conv.is_nested === true ||
		meta.nested === true ||
		meta.is_nested === true ||
		meta.isNested === true
	) {
		return true
	}

	const convId = conv.id !== undefined && conv.id !== null ? String(conv.id) : null
	const convExtId =
		conv.external_session_id !== undefined && conv.external_session_id !== null
			? String(conv.external_session_id)
			: null

	if (Array.isArray(allConversations) && (convId || convExtId)) {
		for (const c of allConversations) {
			if (!c || c === conv) continue
			const cMeta = c.metadata || {}
			const children =
				c.child_session_ids ||
				c.childSessionIds ||
				cMeta.child_session_ids ||
				cMeta.childSessionIds ||
				cMeta.subsessions ||
				cMeta.sub_sessions ||
				cMeta.subagents ||
				cMeta.sub_agents

			if (Array.isArray(children)) {
				const isMatch = children.some((child) => {
					if (!child) return false
					const childStr =
						typeof child === "object"
							? String(child.session_id || child.conversation_id || child.id || "")
							: String(child)
					const trimmedChild = childStr.trim()
					if (!trimmedChild) return false
					return (convId && trimmedChild === convId) || (convExtId && trimmedChild === convExtId)
				})
				if (isMatch) return true
			}
		}
	}

	return false
}

/**
 * Finds the parent conversation object of a given conversation from an array of conversations.
 *
 * @param {object} [conv]
 * @param {object[]} [allConversations=[]]
 * @returns {object|null}
 */
export function findParentSession(conv, allConversations = []) {
	if (!conv || !Array.isArray(allConversations)) return null
	const parentId = getParentSessionId(conv)

	if (parentId) {
		const match = allConversations.find(
			(c) =>
				c &&
				c !== conv &&
				(String(c.external_session_id) === parentId ||
					String(c.id) === parentId ||
					String(c.metadata?.session_id) === parentId),
		)
		if (match) return match
	}

	// Also check reverse child relationship
	const convId = conv.id !== undefined && conv.id !== null ? String(conv.id) : null
	const convExtId =
		conv.external_session_id !== undefined && conv.external_session_id !== null
			? String(conv.external_session_id)
			: null

	if (convId || convExtId) {
		for (const c of allConversations) {
			if (!c || c === conv) continue
			const cMeta = c.metadata || {}
			const children =
				c.child_session_ids ||
				c.childSessionIds ||
				cMeta.child_session_ids ||
				cMeta.childSessionIds ||
				cMeta.subsessions ||
				cMeta.sub_sessions ||
				cMeta.subagents ||
				cMeta.sub_agents

			if (Array.isArray(children)) {
				const isMatch = children.some((child) => {
					if (!child) return false
					const childStr =
						typeof child === "object"
							? String(child.session_id || child.conversation_id || child.id || "")
							: String(child)
					const trimmedChild = childStr.trim()
					if (!trimmedChild) return false
					return (convId && trimmedChild === convId) || (convExtId && trimmedChild === convExtId)
				})
				if (isMatch) return c
			}
		}
	}

	return null
}

/**
 * Finds all child/subagent sessions belonging to a parent conversation.
 *
 * @param {object} [parentConv]
 * @param {object[]} [allConversations=[]]
 * @returns {object[]}
 */
export function findChildSessions(parentConv, allConversations = []) {
	if (!parentConv || !Array.isArray(allConversations)) return []

	const parentId =
		parentConv.id !== undefined && parentConv.id !== null ? String(parentConv.id) : null
	const parentExtId =
		parentConv.external_session_id !== undefined && parentConv.external_session_id !== null
			? String(parentConv.external_session_id)
			: null
	const parentMetaId =
		parentConv.metadata?.session_id !== undefined && parentConv.metadata?.session_id !== null
			? String(parentConv.metadata.session_id)
			: null

	const pMeta = parentConv.metadata || {}
	const explicitChildRefs =
		parentConv.child_session_ids ||
		parentConv.childSessionIds ||
		pMeta.child_session_ids ||
		pMeta.childSessionIds ||
		pMeta.subsessions ||
		pMeta.sub_sessions ||
		[]

	const explicitRefSet = new Set()
	if (Array.isArray(explicitChildRefs)) {
		for (const ref of explicitChildRefs) {
			if (!ref) continue
			if (typeof ref === "object") {
				if (ref.session_id != null) explicitRefSet.add(String(ref.session_id))
				if (ref.sessionId != null) explicitRefSet.add(String(ref.sessionId))
				if (ref.conversation_id != null) explicitRefSet.add(String(ref.conversation_id))
				if (ref.conversationId != null) explicitRefSet.add(String(ref.conversationId))
				if (ref.external_session_id != null) explicitRefSet.add(String(ref.external_session_id))
			} else {
				explicitRefSet.add(String(ref))
			}
		}
	}

	const children = []
	for (const c of allConversations) {
		if (!c || c === parentConv) continue
		if (parentConv.bot_token_id && c.bot_token_id && parentConv.bot_token_id !== c.bot_token_id) {
			continue
		}

		const cParentId = getParentSessionId(c)
		const cId = c.id != null ? String(c.id) : null
		const cExtId = c.external_session_id != null ? String(c.external_session_id) : null
		const cMetaSid = c.metadata?.session_id != null ? String(c.metadata.session_id) : null

		// If c specifies an explicit parent that points to another session, it cannot belong to parentConv
		if (
			cParentId &&
			parentId &&
			cParentId !== parentId &&
			(!parentExtId || cParentId !== parentExtId) &&
			(!parentMetaId || cParentId !== parentMetaId)
		) {
			continue
		}

		const matchesParentId =
			cParentId &&
			((parentId && cParentId === parentId) ||
				(parentExtId && cParentId === parentExtId) ||
				(parentMetaId && cParentId === parentMetaId))

		const matchesExplicitChild =
			(cId && explicitRefSet.has(cId)) ||
			(cExtId && explicitRefSet.has(cExtId)) ||
			(cMetaSid && explicitRefSet.has(cMetaSid))

		if (matchesParentId || matchesExplicitChild) {
			children.push(c)
		}
	}

	return children
}

/**
 * Extracts and normalizes all subagents (child sessions, inline metadata subagents, and
 * subagent tool call invocations) associated with a conversation.
 *
 * @param {object} [parentConv]
 * @param {object[]} [allConversations=[]]
 * @param {object} [sessionMetadata={}]
 * @param {object[]} [toolCalls=[]]
 * @returns {object[]}
 */
export function getSessionSubagents(
	parentConv,
	allConversations = [],
	sessionMetadata = {},
	toolCalls = [],
) {
	if (!parentConv && (!sessionMetadata || Object.keys(sessionMetadata).length === 0)) {
		return []
	}

	// Verify sessionMetadata corresponds to parentConv to prevent cross-session leakage
	const metaSid = sessionMetadata?.session_id || sessionMetadata?.external_session_id
	const convSid = parentConv?.external_session_id || (parentConv?.id ? String(parentConv.id) : null)
	const isMetaForDifferentSession = Boolean(
		metaSid &&
		convSid &&
		String(metaSid) !== String(convSid) &&
		String(metaSid) !== String(parentConv?.metadata?.session_id),
	)

	const effectiveSessionMeta = isMetaForDifferentSession ? {} : sessionMetadata || {}
	const mergedMeta = {
		...(parentConv?.metadata || {}),
		...effectiveSessionMeta,
	}

	const subagentMap = new Map()

	function isStatusRunning(status) {
		const s = String(status || "idle").toLowerCase()
		return (
			s === "running" ||
			s === "thinking" ||
			s === "waiting_for_input" ||
			s === "needs_input" ||
			s === "active" ||
			s === "working" ||
			s === "in_progress"
		)
	}

	// 1. Child conversations from allConversations
	const childConvs = findChildSessions(parentConv, allConversations)
	for (const child of childConvs) {
		const cMeta = child.metadata || {}
		const status = child.status || cMeta.status || "idle"
		const key = String(child.external_session_id || child.id)
		const step =
			cMeta.step ||
			cMeta.current_step ||
			cMeta.action ||
			(cMeta.tool ? `Running ${cMeta.tool}` : "") ||
			""
		const rawTitle =
			cMeta.role ||
			cMeta.agent_name ||
			cMeta.subagent_name ||
			child.title ||
			child.external_session_id ||
			`Subagent #${child.id}`

		subagentMap.set(key, {
			id: key,
			conversationId: child.id,
			sessionId: child.external_session_id || cMeta.session_id || String(child.id),
			title: formatSessionTitle(rawTitle),
			role: cMeta.role || cMeta.agent_type || cMeta.type || "Subagent",
			status,
			isRunning: isStatusRunning(status),
			step,
			tool: cMeta.tool || cMeta.tool_name || "",
			thinking: cMeta.thinking || "",
			prompt: cMeta.prompt || cMeta.task || cMeta.description || "",
			toolCalls: Array.isArray(cMeta.tool_calls) ? cMeta.tool_calls : [],
			updatedAt: child.last_modified_time || child.updated_at || child.inserted_at || null,
			conversation: child,
		})
	}

	// 2. Inline subagent descriptors from metadata (subagents, sub_agents, subsessions)
	const inlineList =
		mergedMeta.subagents ||
		mergedMeta.sub_agents ||
		mergedMeta.subsessions ||
		mergedMeta.sub_sessions ||
		[]

	if (Array.isArray(inlineList)) {
		inlineList.forEach((item, idx) => {
			if (!item || typeof item !== "object") return
			const rawId =
				item.external_session_id ||
				item.session_id ||
				item.sessionId ||
				item.conversation_id ||
				item.conversationId ||
				item.id ||
				`inline-subagent-${idx}`
			const key = String(rawId)

			// Check if we already have a child conversation matching either external_session_id or conversationId
			let existingKey = subagentMap.has(key) ? key : null
			if (!existingKey) {
				for (const [k, v] of subagentMap.entries()) {
					if (
						(item.conversation_id != null &&
							String(v.conversationId) === String(item.conversation_id)) ||
						(item.id != null && String(v.conversationId) === String(item.id)) ||
						(item.session_id != null && String(v.sessionId) === String(item.session_id))
					) {
						existingKey = k
						break
					}
				}
			}

			// Also check if allConversations has a matching conversation by id or external_session_id
			const matchedConv = Array.isArray(allConversations)
				? allConversations.find(
						(c) =>
							c &&
							c !== parentConv &&
							(String(c.id) === key ||
								String(c.external_session_id) === key ||
								(item.conversation_id != null && String(c.id) === String(item.conversation_id)) ||
								(item.session_id != null &&
									String(c.external_session_id) === String(item.session_id))),
					)
				: null

			const status = item.status || matchedConv?.status || "running"
			const step =
				item.step ||
				item.current_step ||
				item.action ||
				(item.tool ? `Running ${item.tool}` : "") ||
				""
			const rawTitle =
				item.title ||
				item.name ||
				item.role ||
				item.agent_name ||
				matchedConv?.title ||
				`Subagent ${idx + 1}`

			if (existingKey) {
				const prev = subagentMap.get(existingKey)
				const nextStatus = item.status || prev.status
				subagentMap.set(existingKey, {
					...prev,
					title: item.title || item.name || item.role ? formatSessionTitle(rawTitle) : prev.title,
					role: item.role || item.agent_type || item.type || prev.role,
					status: nextStatus,
					isRunning: isStatusRunning(nextStatus),
					step: step || prev.step,
					tool: item.tool || item.tool_name || prev.tool,
					thinking: item.thinking || item.thought || prev.thinking,
					prompt: item.prompt || item.task || item.description || prev.prompt,
					toolCalls: Array.isArray(item.tool_calls) ? item.tool_calls : prev.toolCalls,
					output: item.output || item.result || prev.output || "",
				})
			} else {
				subagentMap.set(key, {
					id: key,
					conversationId: matchedConv?.id ?? item.conversation_id ?? item.conversationId ?? null,
					sessionId: item.session_id || item.sessionId || matchedConv?.external_session_id || key,
					title: formatSessionTitle(rawTitle),
					role: item.role || item.agent_type || item.type || "Subagent",
					status,
					isRunning: isStatusRunning(status),
					step,
					tool: item.tool || item.tool_name || "",
					thinking: item.thinking || item.thought || "",
					prompt: item.prompt || item.task || item.description || "",
					toolCalls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
					output: item.output || item.result || "",
					updatedAt: item.updated_at || item.started_at || matchedConv?.updated_at || null,
					conversation: matchedConv || null,
				})
			}
		})
	}

	// 3. Subagent invocations inside toolCalls
	const allToolCalls =
		Array.isArray(toolCalls) && toolCalls.length > 0
			? toolCalls
			: Array.isArray(mergedMeta.tool_calls)
				? mergedMeta.tool_calls
				: []

	allToolCalls.forEach((tc, idx) => {
		if (!tc || typeof tc !== "object") return
		const name = String(tc.name || tc.tool || tc.tool_name || "").toLowerCase()
		const isSubagentCall =
			name.includes("subagent") ||
			name === "spawn_agent" ||
			name === "delegate_task" ||
			name === "invoke_agent" ||
			tc.type === "subagent" ||
			Boolean(tc.subagent_id || tc.child_session_id)

		if (!isSubagentCall) return

		const args = tc.args || tc.arguments || tc.input || {}
		const rawId =
			tc.subagent_id ||
			tc.child_session_id ||
			tc.session_id ||
			args.session_id ||
			args.conversation_id ||
			tc.id ||
			`tool-subagent-${idx}`
		const key = String(rawId)

		if (!subagentMap.has(key)) {
			const role =
				tc.role ||
				args.Role ||
				args.role ||
				args.TypeName ||
				args.agent ||
				tc.name ||
				tc.tool ||
				"Subagent"
			const prompt =
				tc.prompt || args.Prompt || args.prompt || args.task || tc.step || tc.description || ""
			const status =
				tc.status || tc.tool_status || (tc.result || tc.output ? "completed" : "running")

			subagentMap.set(key, {
				id: key,
				conversationId: tc.conversation_id || args.conversation_id || null,
				sessionId: key,
				title: formatSessionTitle(role),
				role,
				status,
				isRunning: isStatusRunning(status),
				step: tc.step || prompt || `Invoked via ${tc.name || tc.tool || "subagent"}`,
				tool: tc.name || tc.tool || "invoke_subagent",
				thinking: tc.thinking || "",
				prompt,
				toolCalls: [],
				output:
					typeof (tc.result || tc.output) === "string"
						? tc.result || tc.output
						: tc.result || tc.output
							? JSON.stringify(tc.result || tc.output, null, 2)
							: "",
				updatedAt: tc.timestamp || null,
				conversation: null,
			})
		}
	})

	const list = Array.from(subagentMap.values())
	list.sort((a, b) => {
		if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1
		return 0
	})

	return list
}

/**
 * Extracts and normalizes running and recent processes / tool executions for a session.
 *
 * @param {object} [conv]
 * @param {object} [sessionMetadata={}]
 * @param {object[]} [toolCalls=[]]
 * @param {string} [sessionStatus="idle"]
 * @returns {object[]}
 */
export function getSessionProcesses(
	conv,
	sessionMetadata = {},
	toolCalls = [],
	sessionStatus = "idle",
) {
	const metaSid = sessionMetadata?.session_id || sessionMetadata?.external_session_id
	const convSid = conv?.external_session_id || (conv?.id ? String(conv.id) : null)
	const isMetaForDifferentSession = Boolean(
		metaSid &&
		convSid &&
		String(metaSid) !== String(convSid) &&
		String(metaSid) !== String(conv?.metadata?.session_id),
	)

	const effectiveSessionMeta = isMetaForDifferentSession ? {} : sessionMetadata || {}
	const mergedMeta = {
		...(conv?.metadata || {}),
		...effectiveSessionMeta,
	}

	const processes = []
	const seenIds = new Set()

	const isSessionBusy = sessionStatus === "running" || sessionStatus === "thinking"

	// 1. Explicit processes list from metadata
	if (Array.isArray(mergedMeta.processes)) {
		mergedMeta.processes.forEach((proc, idx) => {
			if (!proc) return
			if (typeof proc === "string") {
				const id = `proc-str-${idx}`
				seenIds.add(id)
				processes.push({
					id,
					name: proc,
					toolName: "process",
					command: proc,
					status: isSessionBusy ? "running" : "completed",
					isRunning: isSessionBusy,
					output: "",
					args: {},
				})
				return
			}
			const id = String(proc.id || proc.pid || `proc-${idx}`)
			seenIds.add(id)
			const status = proc.status || (isSessionBusy ? "running" : "completed")
			const isRunning =
				status === "running" ||
				status === "thinking" ||
				status === "active" ||
				status === "in_progress"
			processes.push({
				id,
				pid: proc.pid || null,
				name: proc.name || proc.command || proc.tool || `Process #${idx + 1}`,
				toolName: proc.tool || proc.name || "process",
				command: proc.command || proc.cmd || "",
				step: proc.step || proc.description || "",
				status,
				isRunning,
				output: proc.output || proc.stdout || proc.result || "",
				args: proc.args || proc.input || {},
				startedAt: proc.started_at || proc.timestamp || null,
			})
		})
	}

	// 2. Tool calls from live state or metadata
	const rawTools =
		Array.isArray(toolCalls) && toolCalls.length > 0
			? toolCalls
			: Array.isArray(mergedMeta.tool_calls)
				? mergedMeta.tool_calls
				: []

	rawTools.forEach((tc, idx) => {
		if (!tc) return
		const isLast = idx === rawTools.length - 1
		if (typeof tc === "string") {
			const id = `tc-${idx}-${tc}`
			if (seenIds.has(id)) return
			seenIds.add(id)
			const isRunning = isSessionBusy && isLast
			processes.push({
				id,
				name: tc,
				toolName: tc,
				command: "",
				step: `Executed ${tc}`,
				status: isRunning ? "running" : "completed",
				isRunning,
				output: "",
				args: {},
			})
			return
		}

		const id = String(tc.id || tc.toolCallId || tc.call_id || `tc-${idx}`)
		if (seenIds.has(id)) return
		seenIds.add(id)

		const toolName = tc.name || tc.tool || tc.tool_name || (tc.command ? "terminal" : "tool_call")
		const command = tc.command || tc.cmd || tc.args?.command || tc.args?.CommandLine || ""
		const step = tc.step || tc.description || (command ? `Running ${command}` : toolName)
		const hasResult = tc.result !== undefined || tc.output !== undefined
		const rawStatus = tc.status || tc.tool_status
		const status =
			rawStatus || (hasResult ? "completed" : isSessionBusy && isLast ? "running" : "completed")
		const isRunning =
			status === "running" ||
			status === "thinking" ||
			status === "in_progress" ||
			status === "active"

		processes.push({
			id,
			pid: tc.pid || null,
			name: toolName,
			toolName,
			command,
			step,
			status,
			isRunning,
			output:
				typeof (tc.output ?? tc.result) === "string"
					? (tc.output ?? tc.result)
					: (tc.output ?? tc.result) !== undefined
						? JSON.stringify(tc.output ?? tc.result, null, 2)
						: "",
			args: tc.args || tc.arguments || tc.input || {},
			isError: Boolean(tc.isError || tc.error || status === "error" || status === "failed"),
		})
	})

	// 3. Active tool / command from metadata if not already captured by the latest running item
	const currentTool = mergedMeta.tool || mergedMeta.tool_name || ""
	const currentCommand = mergedMeta.command || ""

	if (isSessionBusy && (currentTool || currentCommand)) {
		const alreadyHasActiveMatch = processes.some(
			(p) =>
				p.isRunning &&
				((currentTool && p.toolName === currentTool) ||
					(currentCommand && p.command === currentCommand)),
		)
		if (!alreadyHasActiveMatch) {
			processes.push({
				id: "active-step-process",
				name: currentTool || "terminal",
				toolName: currentTool || "terminal",
				command: currentCommand,
				step: currentCommand ? `Running ${currentCommand}` : "",
				status: sessionStatus,
				isRunning: true,
				output: "",
				args: mergedMeta.args || {},
			})
		}
	}

	return processes
}

/**
 * Orders a list of conversations hierarchically, placing child/nested sessions
 * directly after their parent session in the list.
 *
 * @param {object[]} [conversations=[]]
 * @returns {object[]}
 */
export function orderSessionsHierarchically(conversations = []) {
	if (!Array.isArray(conversations) || conversations.length <= 1) {
		return conversations
	}

	function getSessionLookupKeys(item) {
		if (!item) return []
		const keys = []
		if (item.id != null) keys.push(String(item.id))
		if (item.external_session_id != null && item.external_session_id !== "") {
			keys.push(String(item.external_session_id))
		}
		if (item.metadata?.session_id != null && item.metadata.session_id !== "") {
			keys.push(String(item.metadata.session_id))
		}
		return keys
	}

	const conversationSet = new Set(conversations)
	const childrenByParent = new Map()
	const topLevel = []

	for (const conv of conversations) {
		if (!conv) continue
		const parent = findParentSession(conv, conversations)
		if (parent && conversationSet.has(parent)) {
			const parentKeys = getSessionLookupKeys(parent)
			const primaryKey = parentKeys[0] || (parent.id ?? parent.external_session_id)
			if (!childrenByParent.has(primaryKey)) {
				childrenByParent.set(primaryKey, [])
			}
			childrenByParent.get(primaryKey).push(conv)
		} else {
			topLevel.push(conv)
		}
	}

	const result = []
	const visited = new Set()
	const visitedKeys = new Set()

	function appendItem(item) {
		if (!item) return
		const keys = getSessionLookupKeys(item)
		const alreadyVisited = visited.has(item) || keys.some((k) => visitedKeys.has(k))
		if (alreadyVisited) return

		visited.add(item)
		keys.forEach((k) => visitedKeys.add(k))
		result.push(item)

		for (const k of keys) {
			const children = childrenByParent.get(k)
			if (children && children.length > 0) {
				for (const child of children) {
					appendItem(child)
				}
			}
		}
	}

	for (const item of topLevel) {
		appendItem(item)
	}

	// Safety fallback: append any orphaned items that weren't visited
	for (const item of conversations) {
		if (!item) continue
		const keys = getSessionLookupKeys(item)
		const alreadyVisited = visited.has(item) || keys.some((k) => visitedKeys.has(k))
		if (!alreadyVisited) {
			visited.add(item)
			keys.forEach((k) => visitedKeys.add(k))
			result.push(item)
		}
	}

	return result
}

export const DEFAULT_AGENT_MODES = [
	{
		id: "interactive",
		label: "Interactive",
		icon: "interactive",
		description: "Interactive: Turn-by-turn conversational coding assistance",
	},
	{
		id: "plan",
		label: "Plan",
		icon: "plan",
		description: "Plan: Agent produces a structured milestone checklist before making code changes",
	},
	{
		id: "autopilot",
		label: "Autopilot",
		icon: "autopilot",
		description: "Autopilot: Autonomous multi-step execution until objective is achieved",
	},
]

export const DEFAULT_AGENT_TYPES = [
	{
		id: "workspace",
		label: "Workspace (@workspace)",
		icon: "workspace",
		description: "Full workspace context",
	},
	{ id: "coder", label: "Coder", icon: "code", description: "Code edits & implementation" },
	{
		id: "architect",
		label: "Architect",
		icon: "architecture",
		description: "System design & planning",
	},
	{
		id: "reviewer",
		label: "Reviewer",
		icon: "review",
		description: "Code review & quality checks",
	},
]

export function formatModeLabel(mode) {
	if (!mode || typeof mode !== "string") return "Interactive"
	const m = mode.trim()
	const lower = m.toLowerCase()
	if (lower === "interactive" || lower === "chat") return "Interactive"
	if (lower === "plan" || lower === "planning") return "Plan"
	if (lower === "autopilot" || lower === "auto" || lower === "autonomous") return "Autopilot"
	return m.charAt(0).toUpperCase() + m.slice(1)
}

export function normalizeAgentModes(rawModes) {
	if (rawModes === null || rawModes === undefined) {
		return DEFAULT_AGENT_MODES.map((m) => ({ ...m }))
	}
	if (!Array.isArray(rawModes)) {
		return DEFAULT_AGENT_MODES.map((m) => ({ ...m }))
	}
	if (rawModes.length === 0) {
		return []
	}

	return rawModes
		.map((item) => {
			if (typeof item === "string") {
				const id = item.trim()
				if (!id) return null
				const known = DEFAULT_AGENT_MODES.find((d) => d.id === id.toLowerCase())
				if (known) return { ...known, id }
				return {
					id,
					label: formatModeLabel(id),
					icon: id.toLowerCase(),
					description: `${formatModeLabel(id)} mode`,
				}
			}
			if (typeof item === "object" && item !== null) {
				const id = String(item.id || item.mode || item.name || "").trim()
				if (!id) return null
				const label = item.label || item.title || formatModeLabel(id)
				const icon = item.icon || id.toLowerCase()
				const description = item.description || `${label} mode`
				return { ...item, id, label, icon, description }
			}
			return null
		})
		.filter(Boolean)
}

export function normalizeAgentMode(rawMode, customModes = []) {
	if (!rawMode || typeof rawMode !== "string") return "interactive"
	const m = rawMode.trim().toLowerCase()
	if (m === "plan" || m === "planning") return "plan"
	if (m === "autopilot" || m === "auto" || m === "autonomous") return "autopilot"
	if (
		Array.isArray(customModes) &&
		customModes.some(
			(mode) => (typeof mode === "object" ? mode.id : mode) === rawMode.trim(),
		)
	) {
		return rawMode.trim()
	}
	return "interactive"
}

export function normalizeWorktree(val) {
	if (val === true || val === "true" || val === 1 || val === "1" || val === "worktree") return true
	return false
}

export function isWorktreeSupported(meta = {}, bot = null, _projectInfo = null) {
	if (meta && meta.worktree_supported !== undefined) return Boolean(meta.worktree_supported)
	if (meta && meta.supports_worktree !== undefined) return Boolean(meta.supports_worktree)
	if (meta && meta.allow_worktree !== undefined) return Boolean(meta.allow_worktree)
	if (meta && meta.capabilities?.worktree_supported !== undefined) return Boolean(meta.capabilities.worktree_supported)

	if (bot?.metadata?.worktree_supported !== undefined) return Boolean(bot.metadata.worktree_supported)
	if (bot?.metadata?.supports_worktree !== undefined) return Boolean(bot.metadata.supports_worktree)
	if (bot?.metadata?.allow_worktree !== undefined) return Boolean(bot.metadata.allow_worktree)
	if (bot?.metadata?.capabilities?.worktree_supported !== undefined) return Boolean(bot.metadata.capabilities.worktree_supported)

	if (bot?.bot_type === "chat") return false
	return true
}

export function normalizeBranches(rawBranches) {
	if (!rawBranches) return []
	let list = []
	if (Array.isArray(rawBranches)) {
		list = rawBranches
	} else if (typeof rawBranches === "string") {
		list = rawBranches.includes(",")
			? rawBranches.split(",")
			: [rawBranches]
	}

	const seen = new Set()
	const result = []

	for (const item of list) {
		const name = (
			typeof item === "string"
				? item
				: item?.name || item?.branch || item?.git_branch || ""
		).trim()

		if (name && !seen.has(name)) {
			seen.add(name)
			result.push(name)
		}
	}

	return result
}

export function normalizeAgentTypes(rawTypes) {
	if (rawTypes === null || rawTypes === undefined) {
		return DEFAULT_AGENT_TYPES.map((t) => ({ ...t }))
	}
	let list = rawTypes
	if (!Array.isArray(rawTypes) && typeof rawTypes === "object") {
		if (Array.isArray(rawTypes.agent_roles)) {
			list = rawTypes.agent_roles
		} else if (Array.isArray(rawTypes.agentRoles)) {
			list = rawTypes.agentRoles
		} else if (Array.isArray(rawTypes.agent_types)) {
			list = rawTypes.agent_types
		} else if (Array.isArray(rawTypes.agentTypes)) {
			list = rawTypes.agentTypes
		} else if (Array.isArray(rawTypes.roles)) {
			list = rawTypes.roles
		} else {
			list = Object.entries(rawTypes).map(([key, val]) => {
				if (typeof val === "string") {
					return { id: key, label: val, description: val }
				}
				if (typeof val === "object" && val !== null) {
					return { id: key, ...val }
				}
				return { id: key }
			})
		}
	}
	if (!Array.isArray(list)) {
		return DEFAULT_AGENT_TYPES.map((t) => ({ ...t }))
	}
	if (list.length === 0) {
		return []
	}

	return list
		.map((item) => {
			if (typeof item === "string") {
				const id = item.trim()
				if (!id) return null
				const known = DEFAULT_AGENT_TYPES.find((d) => d.id === id.toLowerCase())
				if (known) return { ...known, id }
				return {
					id,
					label: id.startsWith("@") ? id : id.charAt(0).toUpperCase() + id.slice(1),
					icon: id.toLowerCase(),
					description: "",
				}
			}
			if (typeof item === "object" && item !== null) {
				const id = String(item.id || item.name || item.type || item.role || "").trim()
				if (!id) return null
				const label =
					item.label ||
					item.title ||
					(id.startsWith("@") ? id : id.charAt(0).toUpperCase() + id.slice(1))
				const icon = item.icon || id.toLowerCase()
				const description = item.description || ""
				return { ...item, id, label, icon, description }
			}
			return null
		})
		.filter(Boolean)
}

export function formatAgentType(type, agentTypes = []) {
	if (!type || typeof type !== "string") return "Workspace"
	const t = type.trim()
	if (t.startsWith("@")) return t

	if (Array.isArray(agentTypes) && agentTypes.length > 0) {
		const found = agentTypes.find((item) => {
			const itemId = typeof item === "object" ? item.id : item
			return itemId && String(itemId).toLowerCase() === t.toLowerCase()
		})
		if (found && typeof found === "object" && found.label) {
			return found.label
		}
	}

	const found = DEFAULT_AGENT_TYPES.find((d) => d.id === t.toLowerCase())
	if (found) return found.label
	return t.charAt(0).toUpperCase() + t.slice(1)
}

export function getAgentPromptConfig(
	sessionMetadata = {},
	conv = null,
	projectInfo = null,
	bot = null,
) {
	const meta = {
		...(conv?.metadata || {}),
		...(sessionMetadata || {}),
	}

	const rawModes =
		meta.agent_modes ||
		meta.modes ||
		meta.agentModes ||
		meta.supported_modes ||
		meta.capabilities?.modes ||
		meta.capabilities?.agent_modes ||
		bot?.metadata?.agent_modes ||
		bot?.metadata?.modes ||
		bot?.metadata?.agentModes ||
		bot?.metadata?.supported_modes ||
		bot?.metadata?.capabilities?.modes ||
		bot?.metadata?.capabilities?.agent_modes
	const modes = normalizeAgentModes(rawModes)
	const agentModes = modes.map((m) => m.id)

	const rawMode = meta.agent_mode || meta.agentMode || meta.mode
	let agentMode = normalizeAgentMode(rawMode)
	if (modes.length > 0 && !modes.some((m) => m.id === agentMode)) {
		agentMode = modes[0].id
	}

	const worktreeSupported = isWorktreeSupported(meta, bot, projectInfo)
	const rawWorktree =
		meta.use_worktree !== undefined
			? meta.use_worktree
			: meta.useWorktree !== undefined
				? meta.useWorktree
				: meta.worktree !== undefined
					? meta.worktree
					: meta.working_mode === "worktree"
	const useWorktree = worktreeSupported ? normalizeWorktree(rawWorktree) : false

	const rawBranches =
		meta.branches ||
		meta.available_branches ||
		meta.base_branches ||
		meta.git_branches ||
		meta.project?.branches ||
		meta.capabilities?.branches ||
		bot?.metadata?.branches ||
		bot?.metadata?.available_branches ||
		bot?.metadata?.base_branches ||
		bot?.metadata?.capabilities?.branches
	const availableBranches = normalizeBranches(rawBranches)

	const projectBranch =
		meta.base_branch ||
		meta.baseBranch ||
		meta.branch ||
		meta.git_branch ||
		conv?.metadata?.base_branch ||
		conv?.metadata?.baseBranch ||
		conv?.metadata?.branch ||
		projectInfo?.branch ||
		availableBranches[0] ||
		"main"
	const baseBranch = projectBranch

	if (baseBranch && !availableBranches.includes(baseBranch)) {
		availableBranches.unshift(baseBranch)
	}

	const rawAgentTypes =
		meta.agent_roles ||
		meta.agentRoles ||
		meta.agent_types ||
		meta.agentTypes ||
		meta.roles ||
		meta.subagents ||
		meta.capabilities?.agent_roles ||
		meta.capabilities?.agentRoles ||
		meta.capabilities?.agent_types ||
		meta.capabilities?.agentTypes ||
		meta.capabilities?.roles ||
		meta.capabilities?.subagents ||
		bot?.metadata?.agent_roles ||
		bot?.metadata?.agentRoles ||
		bot?.metadata?.agent_types ||
		bot?.metadata?.agentTypes ||
		bot?.metadata?.roles ||
		bot?.metadata?.subagents ||
		bot?.metadata?.capabilities?.agent_roles ||
		bot?.metadata?.capabilities?.agentRoles ||
		bot?.metadata?.capabilities?.agent_types ||
		bot?.metadata?.capabilities?.agentTypes ||
		bot?.metadata?.capabilities?.roles ||
		bot?.metadata?.capabilities?.subagents
	const agentTypeItems = normalizeAgentTypes(rawAgentTypes)
	const agentTypes =
		Array.isArray(rawAgentTypes) && rawAgentTypes.length > 0
			? typeof rawAgentTypes[0] === "object"
				? agentTypeItems
				: rawAgentTypes.map((t) => String(t).trim()).filter(Boolean)
			: agentTypeItems

	const defaultTypeId =
		agentTypeItems[0]?.id ||
		(typeof agentTypes[0] === "object" ? agentTypes[0].id : agentTypes[0]) ||
		"workspace"

	const rawAgentType =
		meta.agent_type ||
		meta.agentType ||
		conv?.metadata?.agent_type ||
		conv?.metadata?.agentType ||
		defaultTypeId
	const agentType =
		typeof rawAgentType === "string" && rawAgentType.trim()
			? rawAgentType.trim()
			: defaultTypeId

	return {
		modes,
		agentModes,
		agentMode,
		worktreeSupported,
		useWorktree,
		baseBranch,
		availableBranches,
		agentType,
		agentTypes,
		agentTypeItems,
	}
}
