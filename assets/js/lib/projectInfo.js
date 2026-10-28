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
				cMeta.sub_sessions

			if (Array.isArray(children)) {
				const isMatch = children.some((child) => {
					if (!child) return false
					const childStr =
						typeof child === "object" ? String(child.session_id || child.id || "") : String(child)
					return (convId && childStr === convId) || (convExtId && childStr === convExtId)
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
				cMeta.sub_sessions

			if (Array.isArray(children)) {
				const isMatch = children.some((child) => {
					if (!child) return false
					const childStr =
						typeof child === "object" ? String(child.session_id || child.id || "") : String(child)
					return (convId && childStr === convId) || (convExtId && childStr === convExtId)
				})
				if (isMatch) return c
			}
		}
	}

	return null
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

	const conversationSet = new Set(conversations)
	const childrenByParent = new Map()
	const topLevel = []

	for (const conv of conversations) {
		if (!conv) continue
		const parent = findParentSession(conv, conversations)
		if (parent && conversationSet.has(parent)) {
			const parentKey = parent.id ?? parent.external_session_id
			if (!childrenByParent.has(parentKey)) {
				childrenByParent.set(parentKey, [])
			}
			childrenByParent.get(parentKey).push(conv)
		} else {
			topLevel.push(conv)
		}
	}

	const result = []
	const visited = new Set()

	function appendItem(item) {
		if (visited.has(item)) return
		visited.add(item)
		result.push(item)

		const itemKey = item.id ?? item.external_session_id
		const children = childrenByParent.get(itemKey)
		if (children && children.length > 0) {
			for (const child of children) {
				appendItem(child)
			}
		}
	}

	for (const item of topLevel) {
		appendItem(item)
	}

	// Safety fallback: append any orphaned items that weren't visited
	for (const item of conversations) {
		if (!visited.has(item)) {
			result.push(item)
		}
	}

	return result
}
