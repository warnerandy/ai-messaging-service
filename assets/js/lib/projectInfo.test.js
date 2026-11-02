import { test, expect } from "vitest"
import assert from "node:assert/strict"
import {
	formatProjectPath,
	getProjectInfo,
	getSessionProjectInfo,
	isUuidOrHash,
	formatSessionTitle,
	getProjectMetadataForGroup,
	getParentSessionId,
	isSessionNested,
	findParentSession,
	findChildSessions,
	getSessionSubagents,
	getSessionProcesses,
	orderSessionsHierarchically,
} from "./projectInfo.js"

test("formatProjectPath converts file URIs to paths", () => {
	assert.equal(formatProjectPath("file:///workspace/project"), "/workspace/project")
	assert.equal(formatProjectPath("file:///C:/repos/my-app"), "C:/repos/my-app")
	assert.equal(formatProjectPath("/home/dev/code"), "/home/dev/code")
	assert.equal(formatProjectPath(""), "")
	assert.equal(formatProjectPath(null), "")
})

test("getProjectInfo handles project object with name and uri", () => {
	const conv = {
		metadata: {
			project: {
				name: "botamus-prime-copilot",
				uri: "file:///workspace/botamus-prime",
				branch: "main",
			},
		},
	}
	const info = getProjectInfo(conv)
	assert.equal(info.hasProject, true)
	assert.equal(info.name, "botamus-prime-copilot")
	assert.equal(info.uri, "file:///workspace/botamus-prime")
	assert.equal(info.path, "/workspace/botamus-prime")
	assert.equal(info.branch, "main")
})

test("getProjectInfo handles string project", () => {
	const conv = {
		metadata: {
			project: "ai-messaging-service",
			git_branch: "master",
		},
	}
	const info = getProjectInfo(conv)
	assert.equal(info.hasProject, true)
	assert.equal(info.name, "ai-messaging-service")
	assert.equal(info.branch, "master")
})

test("getProjectInfo handles working_directories array", () => {
	const conv = {
		metadata: {
			working_directories: ["file:///c:/Users/warne/repos/cool-bot"],
		},
	}
	const info = getProjectInfo(conv)
	assert.equal(info.hasProject, true)
	assert.equal(info.name, "cool-bot")
	assert.equal(info.path, "c:/Users/warne/repos/cool-bot")
	assert.equal(info.workingDirectories.length, 1)
})

test("getProjectInfo merges live sessionMetadata over conversation metadata", () => {
	const conv = {
		metadata: {
			project: "old-name",
		},
	}
	const liveMeta = {
		project: {
			name: "updated-name",
			branch: "feat/header",
		},
	}
	const info = getProjectInfo(conv, liveMeta)
	assert.equal(info.name, "updated-name")
	assert.equal(info.branch, "feat/header")
})

test("getSessionProjectInfo backward-compatibility", () => {
	const conv = {
		metadata: {
			project: { name: "botamus-prime-copilot", uri: "file:///workspace" },
		},
	}
	const res = getSessionProjectInfo(conv)
	assert.deepEqual(res.name, "botamus-prime-copilot")
	assert.deepEqual(res.uri, "file:///workspace")

	assert.equal(getSessionProjectInfo(null), null)
	assert.equal(getSessionProjectInfo({}), null)
	assert.equal(getSessionProjectInfo({ metadata: {} }), null)
})

test("isUuidOrHash identifies UUIDs, internal hashes, and AHP URIs", () => {
	assert.equal(isUuidOrHash("4a232034-1e05-4a0f-9fa3-31f04a34f574"), true)
	assert.equal(isUuidOrHash("05e927fa-e4aa-49fa-9860-2ff586202ba3"), true)
	assert.equal(isUuidOrHash("ahp:copilotUri/123"), true)
	assert.equal(isUuidOrHash("ahp-chat-session-xyz"), true)
	assert.equal(isUuidOrHash("workspaceStorage/05e927fa"), true)
	assert.equal(isUuidOrHash("671569421876401928374619"), true)

	assert.equal(isUuidOrHash("ai-messaging-service"), false)
	assert.equal(isUuidOrHash("my-cool-project"), false)
	assert.equal(isUuidOrHash("Backend Task"), false)
	assert.equal(isUuidOrHash(""), false)
	assert.equal(isUuidOrHash(null), false)
})

test("formatSessionTitle formats raw UUIDs and preserves human-readable titles", () => {
	assert.equal(formatSessionTitle("4a232034-1e05-4a0f-9fa3-31f04a34f574"), "Session (4a232034)")
	assert.equal(
		formatSessionTitle("Session 4a232034-1e05-4a0f-9fa3-31f04a34f574"),
		"Session (4a232034)",
	)
	assert.equal(
		formatSessionTitle("Session: 4a232034-1e05-4a0f-9fa3-31f04a34f574"),
		"Session (4a232034)",
	)
	assert.equal(formatSessionTitle("Database Migration"), "Database Migration")
	assert.equal(formatSessionTitle("Fix login bug"), "Fix login bug")
	assert.equal(formatSessionTitle(""), "Session")
	assert.equal(formatSessionTitle(null), "Session")
})

test("getProjectInfo ignores raw UUIDs as project name and traverses folder paths", () => {
	const conv = {
		metadata: {
			workspace: "4a232034-1e05-4a0f-9fa3-31f04a34f574",
			working_directory:
				"file:///c:/Users/dev/AppData/Roaming/Code/User/workspaceStorage/4a232034-1e05-4a0f-9fa3-31f04a34f574",
		},
	}
	const info = getProjectInfo(conv)
	// Should not accept the UUID as name
	assert.equal(info.name, "")
})

test("getProjectMetadataForGroup extracts metadata from group and its sample conversation", () => {
	const group = {
		name: "backend-api",
		hasProject: true,
		path: "file:///workspace/backend",
		branch: "feature/auth",
		repository: "https://github.com/example/backend",
		conversations: [
			{
				id: 1,
				metadata: {
					project: {
						name: "backend-api",
						uri: "file:///workspace/backend",
						path: "/workspace/backend",
					},
					working_directories: ["file:///workspace/backend"],
					git_branch: "feature/auth",
				},
			},
		],
	}

	const meta = getProjectMetadataForGroup(group)
	assert.equal(meta.project.name, "backend-api")
	assert.equal(meta.project.uri, "file:///workspace/backend")
	assert.deepEqual(meta.working_directories, ["file:///workspace/backend"])
	assert.equal(meta.git_branch, "feature/auth")

	// Group with no conversations but hasProject info
	const emptyGroup = {
		name: "frontend-ui",
		hasProject: true,
		path: "/repos/frontend",
		branch: "main",
		repository: "https://github.com/example/frontend",
		conversations: [],
	}
	const emptyMeta = getProjectMetadataForGroup(emptyGroup)
	assert.equal(emptyMeta.project.name, "frontend-ui")
	assert.equal(emptyMeta.project.path, "/repos/frontend")
	assert.equal(emptyMeta.git_branch, "main")
	assert.equal(emptyMeta.repository, "https://github.com/example/frontend")

	// No Project or empty group
	assert.deepEqual(getProjectMetadataForGroup(null), {})
	assert.deepEqual(getProjectMetadataForGroup({ hasProject: false, name: "No Project" }), {})
})

test("getParentSessionId detects parent session IDs across root and metadata keys", () => {
	assert.equal(getParentSessionId(null), null)
	assert.equal(getParentSessionId({}), null)
	assert.equal(getParentSessionId({ parent_session_id: "root-parent-1" }), "root-parent-1")
	assert.equal(getParentSessionId({ parentSessionId: "root-parent-2" }), "root-parent-2")
	assert.equal(getParentSessionId({ parent_id: 42 }), "42")
	assert.equal(
		getParentSessionId({ metadata: { parent_session_id: "meta-parent-1" } }),
		"meta-parent-1",
	)
	assert.equal(
		getParentSessionId({ metadata: { parentSessionId: "meta-parent-2" } }),
		"meta-parent-2",
	)
	assert.equal(getParentSessionId({ metadata: { parent_id: "meta-parent-3" } }), "meta-parent-3")
	assert.equal(
		getParentSessionId({ metadata: { parent: { session_id: "obj-parent-1" } } }),
		"obj-parent-1",
	)
	assert.equal(getParentSessionId({ metadata: { parent: "string-parent-1" } }), "string-parent-1")
})

test("isSessionNested accurately identifies nested sessions", () => {
	assert.equal(isSessionNested(null), false)
	assert.equal(isSessionNested({}), false)
	assert.equal(isSessionNested({ parent_session_id: "parent-123" }), true)
	assert.equal(isSessionNested({ nested: true }), true)
	assert.equal(isSessionNested({ is_nested: true }), true)
	assert.equal(isSessionNested({ metadata: { nested: true } }), true)
	assert.equal(isSessionNested({ metadata: { is_nested: true } }), true)
	assert.equal(isSessionNested({ metadata: { parent_session_id: "p-456" } }), true)

	// Reverse check via parent's child_session_ids
	const childConv = { id: 10, external_session_id: "child-session-1" }
	const parentConv = {
		id: 1,
		external_session_id: "parent-session-1",
		metadata: { child_session_ids: ["child-session-1"] },
	}
	assert.equal(isSessionNested(childConv, [parentConv, childConv]), true)
})

test("findParentSession resolves the parent conversation object", () => {
	const parentConv = { id: 1, external_session_id: "sess-root", title: "Root Architecture" }
	const childConv = {
		id: 2,
		external_session_id: "sess-child-1",
		parent_session_id: "sess-root",
		title: "Sub-task Child",
	}
	const otherConv = { id: 3, external_session_id: "sess-other", title: "Unrelated Task" }
	const all = [parentConv, childConv, otherConv]

	assert.equal(findParentSession(childConv, all), parentConv)
	assert.equal(findParentSession(parentConv, all), null)
	assert.equal(findParentSession(otherConv, all), null)
})

test("orderSessionsHierarchically places child sessions directly under their parent", () => {
	const parentA = { id: 1, external_session_id: "parent-A", title: "Parent A" }
	const parentB = { id: 2, external_session_id: "parent-B", title: "Parent B" }
	const childA1 = {
		id: 3,
		external_session_id: "child-A1",
		parent_session_id: "parent-A",
		title: "Child A1",
	}
	const childA2 = {
		id: 4,
		external_session_id: "child-A2",
		parent_session_id: "parent-A",
		title: "Child A2",
	}
	const childB1 = {
		id: 5,
		external_session_id: "child-B1",
		parent_session_id: "parent-B",
		title: "Child B1",
	}
	const independent = { id: 6, external_session_id: "indep", title: "Independent" }

	// Shuffled input order
	const shuffled = [childA2, parentB, childB1, independent, parentA, childA1]
	const ordered = orderSessionsHierarchically(shuffled)

	// parentA should be followed by its children childA2, childA1
	const aIndex = ordered.indexOf(parentA)
	const a1Index = ordered.indexOf(childA1)
	const a2Index = ordered.indexOf(childA2)
	assert.ok(aIndex !== -1)
	assert.ok(a1Index > aIndex && a2Index > aIndex)

	// parentB should be followed by its child childB1
	const bIndex = ordered.indexOf(parentB)
	const b1Index = ordered.indexOf(childB1)
	assert.ok(bIndex !== -1)
	assert.ok(b1Index > bIndex)

	// Check total count preserved
	assert.equal(ordered.length, shuffled.length)
})

test("findChildSessions returns child sessions linked by parent_session_id or parent child_session_ids", () => {
	const parent = {
		id: 10,
		external_session_id: "parent-root",
		metadata: { child_session_ids: ["child-via-parent-list"] },
	}
	const child1 = {
		id: 11,
		external_session_id: "child-1",
		parent_session_id: "parent-root",
		title: "Code Researcher",
	}
	const child2 = {
		id: 12,
		external_session_id: "child-via-parent-list",
		title: "Test Runner",
	}
	const unrelated = {
		id: 13,
		external_session_id: "other-session",
		title: "Unrelated",
	}

	const children = findChildSessions(parent, [parent, child1, child2, unrelated])
	assert.equal(children.length, 2)
	assert.ok(children.includes(child1))
	assert.ok(children.includes(child2))
})

test("getSessionSubagents merges child sessions, inline metadata subagents, and subagent toolCalls", () => {
	const parent = {
		id: 100,
		external_session_id: "parent-100",
		title: "Main Session",
	}
	const childIdle = {
		id: 101,
		external_session_id: "sub-idle",
		parent_session_id: "parent-100",
		title: "Schema Analyzer",
		status: "idle",
		metadata: { step: "Finished analysis" },
	}
	const childRunning = {
		id: 102,
		external_session_id: "sub-running",
		parent_session_id: "parent-100",
		title: "Frontend Builder",
		status: "running",
		metadata: { tool: "edit_file", step: "Editing ChatView.jsx" },
	}

	const liveMeta = {
		subagents: [
			{
				session_id: "inline-sub-1",
				title: "Security Auditor",
				status: "thinking",
				step: "Checking auth plugs",
				thinking: "Inspecting router pipelines...",
			},
		],
	}

	const toolCalls = [
		{
			id: "tc-sub-1",
			name: "invoke_subagent",
			args: { Role: "DB Debugger", Prompt: "Check migrations" },
			status: "running",
		},
	]

	const subagents = getSessionSubagents(
		parent,
		[parent, childIdle, childRunning],
		liveMeta,
		toolCalls,
	)

	assert.equal(subagents.length, 4)
	// Running subagents should be sorted before idle subagents
	assert.equal(subagents[0].isRunning, true)
	assert.equal(subagents[subagents.length - 1].id, "sub-idle")
	assert.equal(subagents[subagents.length - 1].isRunning, false)
})

test("getSessionSubagents only shows subagents for current session and prevents cross-session leakage", () => {
	const sessionA = {
		id: 200,
		external_session_id: "sess-A",
		title: "Session A with Subagents",
		metadata: {
			subagents: [
				{ session_id: "sub-A1", title: "Subagent A1", status: "running" },
				{ session_id: "sub-A2", title: "Subagent A2", status: "completed" },
			],
		},
	}
	const childA = {
		id: 201,
		external_session_id: "child-A1",
		parent_session_id: "sess-A",
		title: "Child Session A",
		status: "running",
	}

	const sessionB = {
		id: 300,
		external_session_id: "sess-B",
		title: "Session B (Clean, no subagents)",
		metadata: {},
	}

	const allConvs = [sessionA, childA, sessionB]

	// Session A sees its subagents
	const subagentsA = getSessionSubagents(sessionA, allConvs, sessionA.metadata)
	assert.equal(subagentsA.length, 3)

	// Session B MUST NOT see Session A's subagents, even if stale sessionMetadata from Session A is provided
	const staleMetaFromA = {
		session_id: "sess-A",
		subagents: [{ session_id: "sub-A1", title: "Subagent A1" }],
	}
	const subagentsBWithStaleMeta = getSessionSubagents(sessionB, allConvs, staleMetaFromA)
	assert.equal(subagentsBWithStaleMeta.length, 0)

	// Session B with its own clean metadata sees 0 subagents
	const subagentsBClean = getSessionSubagents(sessionB, allConvs, sessionB.metadata)
	assert.equal(subagentsBClean.length, 0)
})

test("getSessionProcesses normalizes explicit processes, tool calls, and active tool/command", () => {
	const conv = {
		id: 1,
		metadata: {
			processes: [
				{
					id: "p1",
					pid: 4321,
					name: "mix phx.server",
					command: "mix phx.server",
					status: "running",
					output: "Listening on port 4000",
				},
			],
		},
	}

	const toolCalls = [
		{
			id: "tc1",
			name: "read_file",
			args: { Path: "lib/messaging/chat.ex" },
			result: "file contents",
		},
	]

	const procs = getSessionProcesses(
		conv,
		{ tool: "run_command", command: "npm test" },
		toolCalls,
		"running",
	)
	assert.equal(procs.length, 3)
	assert.equal(procs[0].pid, 4321)
	assert.equal(procs[0].isRunning, true)
	assert.equal(procs[1].name, "read_file")
	assert.equal(procs[1].isRunning, false)
	assert.equal(procs[2].name, "run_command")
	assert.equal(procs[2].isRunning, true)
})
