# API & Integration Guide

> [!NOTE]
> The primary API and protocol reference is located at [`integrate.md`](./integrate.md).
> Please see [`integrate.md`](./integrate.md) for exhaustive JSON schemas, REST endpoints, WebSocket event payloads, and bridge client code samples.

## Overview & Integration Modes

The AI Messaging Service provides an authoritative, real-time messaging platform supporting two primary integration protocols:

1. **Standard Chat Protocol (`bot_type: "chat"`)**:
   - Designed for conversational LLMs and general assistant bots (OpenAI, Anthropic, Gemini, Ollama, local models).
   - Dynamic model discovery with configurable token context window sizes (`context_sizes`).
   - Markdown rendering, syntax-highlighted code snippets, image/file uploads, and one-click suggestion chips.
   - REST endpoints & real-time bidirectional WebSocket channels on `bot:<CHANNEL_CODE>`.

2. **Agent Host Protocol (`bot_type: "ahp"`)**:
   - Designed for autonomous programming and coding agents (Claude Code, GitHub Copilot, Devin, Roo Code, custom harnesses).
   - Built around the open, state-first **Agent Host Protocol (AHP)** specification.
   - Decoupled host-authoritative runtime allowing persistent, multi-client synchronized coding sessions.

---

## Agent Host Protocol (AHP) Core Capabilities

### 1. Host-Authoritative & Multi-Client State Synchronization
- **Decoupled Lifecycle**: The agent host owns session execution. Long-running coding tasks continue uninterrupted when client windows close, disconnect, or switch between desktop, mobile, or remote dev environments.
- **State-First Action Model**: State updates follow immutable, sequenced action envelopes with write-ahead reconciliation.
- **Replay & Resynchronization**: Clients reconnecting or requesting sync (`request_session_sync`) receive state snapshots and replay missed actions seamlessly.

### 2. URI-Addressed Channel Architecture
AHP organizes state and interactions into structured URI namespaces:
- **`ahp-root://`**: Host capability negotiation, workspace initialization, and global configuration.
- **`ahp-session:/<uuid>`**: Session lifecycle, workspace context, participants, and status coordination.
- **`ahp-chat:/<uuid>`**: Turn-by-turn chat history, user prompts, streaming thoughts, and agent completions.
- **`ahp-terminal:/<id>`**: Persistent terminal streams, executing commands, and live stdout/stderr logs.
- **`ahp-changeset:/<id>`**: File system modifications, working tree diffs, and staged file reviews.
- **`mcp://`**: Side-channel integration for Model Context Protocol tool servers and resource providers.

### 3. Multi-Session Hierarchies & Nested Sub-Agents
AHP natively supports orchestrator agents delegating subtasks to child or sub-agent sessions:
- **Parent-Child Linkage**: Child sessions specify `parent_session_id` (or `parentSessionId`, `parent_id`, `nested: true`) referencing the orchestrator session ID.
- **Visual Hierarchy in Sidebar**:
  - `↳ Nested` badge pill and branch elbow icon (`↳`).
  - Hierarchical tree indentation with connecting lines (`└─`) placed directly under the parent session.
  - Hover tooltips displaying parent context (`Nested under: "<Parent Title>"`).
- **Active Sub-Session Topbar Badge**: When viewing a child session, the chat header displays a prominent `Nested Session` badge.
- **Project Context Inheritance**: Nested sessions automatically inherit project workspace metadata (`name`, `path`, `git_branch`, `repository`, `working_directories`).

### 4. Real-Time Session Statuses
AHP sub-chats report live execution states:
- **`idle`**: Agent is ready for new prompts. Any queued prompts in the prompt queue are automatically dispatched.
- **`running`**: Agent is actively executing tools, CLI commands, or background jobs.
- **`thinking`**: Agent is generating streaming reasoning tokens.
- **`waiting_for_input`** (or `needs_input`): Agent is paused waiting for human-in-the-loop approval or question response.
- **`archived`** (or `completed` / `done`): Session has concluded.

### 5. Reasoning Tokens & Execution Logs
- **Streaming Thinking Tokens (`ahp_event: "thinking"`)**: Real-time token streaming with collapsible thought drawers and VS Code indeterminate progress bars.
- **Terminal & Command Output (`ahp_event: "terminal"`, `"output"`, `"log"`)**: Live streaming of command stdout/stderr directly into the reasoning and execution view.
- **Tool Lifecycle & Step Progress (`ahp_event: "step"`, `"tool_call"`)**: Reports tool name, command line, arguments, and execution status (`started`, `executing`, `completed`, `failed`).
- **Milestone Plans (`ahp_event: "plan"`)**: Structured milestone plans and task checklists rendered in execution status chips.
- **Changeset Tracking (`ahp_event: "changeset"`)**: File modification lists and diff stats tracked in real-time.

### 6. Human-in-the-Loop Interactivity
- **Interactive Question / Approval Cards (`ahp_event: "question"` -> `answer_question`)**:
  - Interactive approval prompts with multiple-choice buttons, default actions, and optional comments.
  - Selecting an option dispatches `answer_question` back to the agent host over WebSocket, unblocking execution.
- **Mid-Turn Steering & Cancellation (`steer_agent`)**:
  - **Steer**: Inject mid-turn instructions to guide agent behavior without restarting the session.
  - **Stop**: Immediately interrupt and halt running tools or agent reasoning loops.
- **Automated Sequential Prompt Queuing (`execute_queued_prompt`)**:
  - Users can queue multiple follow-up tasks while the agent is busy.
  - Upon transitioning to `idle`, the next prompt in the queue is automatically dispatched to the agent.

### 7. Developer & Operator Experience
- **Protocol Badges**: Visual headers clearly distinguish `AHP Protocol` agents from standard `Chat Protocol` assistants.
- **In-App Bot Configuration Modal (⚙️)**:
  - Copy WebSocket connection URLs and channel codes.
  - One-click token regeneration (`POST /api/bot-tokens/:id/regenerate`) without tearing down existing sessions.
- **Context Window Negotiation**: Dynamic token context size selector (`context_sizes: [4096, 8192, 16384, 32768, 128000]`).

---

For complete request/response schemas, WebSocket event formats, and runnable client bridge scripts, see **[`integrate.md`](./integrate.md)**.
