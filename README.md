# Botamus Prime (Rust + AHP + `@assistant-ui/react`)

A mobile-first AI messaging & **Agent Host Protocol (AHP)** web application written in **Rust** (`axum`, `tokio`, `sqlx`, `ahp`, `ahp-types`, `ahp-ws`) on the backend and **React 19 + `@assistant-ui/react`** on the frontend.

The AHP bot integration acts as a bidirectional proxy (`aims-proxy`) for a local AHP server on its host machine, delivering full **VS Code Agents Window** parity in a mobile-first web UI — including creating new sessions with workspace directory, git branch, isolated git worktree, execution mode (`Interactive`, `Plan`, `Autopilot`), and agent role selection, plus instant mobile clipboard image paste and on-the-fly photo attachments.

### Session and chat identity

AHP sessions are containers: each chat is one AIMS conversation, not an additional
conversation alongside its parent session. The host's explicit `defaultChat`
designates the session alias; neither matching titles nor catalog order determine
identity. Separate chats (including same-title chats) keep their own history and
status. Commands address the selected chat, while configuration changes address
its parent session. Snapshots, live events, and manual resync use the same chat IDs.

New AHP sessions receive a unique, persisted host ID. AIMS displays creation as
pending until the proxy creates the host session and subscribes to its default
chat; it does not create an additional chat. The selected project directory is
passed to the local host as a file URI. Agent roles are configuration, not host
provider IDs, unless they match a provider advertised by the host.
Creating a session does not start agent work: send a prompt after it is ready.
Offline proxies and host creation failures are shown explicitly rather than
appearing as successful idle sessions. Failed or pending sessions cannot accept
prompts. Deploy both server/frontend and proxy for this behavior. Old sessions
created without a host ID cannot be dispatched safely; create a new session and
resubmit the prompt (old history is retained and never replayed automatically).

On synchronization, an existing parent-only placeholder is rekeyed to its default
chat. If both rows already exist, reconciliation transactionally moves all parent
messages into the chat, retaining message IDs and metadata; the old parent row
becomes an archived redirect excluded from conversation lists. No history is
deleted. This is scoped to the connected bot and requires an explicit default-chat
relationship. Changing `defaultChat` does not merge separate chats. Update both
server and proxy; no database reset is needed.

---

## Architecture Overview

The sidebar lists main chats only, including in search and project counts.
Sessions identified as subagents by parent/child relationships, nested flags, or
subagent identifiers are excluded from that list, not deleted. Retained child
sessions remain accessible through their parent's Subagents panel.
Selecting Git Worktree configures the next prompt; it does not immediately create
a worktree. The UI shows the selection without claiming the worktree is active.

```
┌───────────────────────────────────────────────────────────┐
│  Mobile-First React PWA (Vite + Tailwind + @assistant-ui) │
│  assets/js/app.jsx                                        │
│  - AssistantRuntimeProvider + useExternalStoreRuntime     │
│  - AttachmentAdapter (mobile clipboard image paste)       │
│  - NewSessionCanvas (VS Code Agents session creation)     │
│  - AssistantChatComposer, LiveThinking, SubagentsPanel    │
└──────────────┬─────────────────────────────┬──────────────┘
               │ REST API                    │ WebSocket
               │ /api/*                      │ /socket/websocket
               ▼                             ▼
┌───────────────────────────────────────────────────────────┐
│  aims-server (Rust + Axum + Tokio + SQLx + ahp)           │
│  crates/aims-server                                       │
│  - BotAhpMirror (ahp::MultiHostStateMirror + reducers)    │
│  - User, Bot, Conversation, Message & Asset REST routes   │
│  - Real-time WebSocket pub/sub hub                        │
└──────────────┬─────────────────────────────┬──────────────┘
               │ PostgreSQL 16               │ WebSocket (/bot/websocket)
               ▼                             ▼
┌──────────────────────┐       ┌────────────────────────────┐
│  PostgreSQL Database │       │  aims-proxy (Rust Binary)  │
│  Auto-migrated       │       │  crates/aims-proxy         │
└──────────────────────┘       └─────────────┬──────────────┘
                                             │ ahp-ws (JSON-RPC 2.0)
                                             ▼
                               ┌────────────────────────────┐
                               │  Local AHP Server on Host  │
                               │  (ws://127.0.0.1:12345)    │
                               └────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Server | Rust (`axum 0.8`, `tokio`, `sqlx 0.8`, `tower-http`) |
| AHP Protocol | Official Rust AHP crates: `ahp 1.0`, `ahp-types 1.0`, `ahp-ws 1.0` |
| AHP Host Proxy | `aims-proxy` crate (`ahp::Client`, `ahp_ws::WebSocketTransport`, `ahp::MultiHostStateMirror`) |
| Database | PostgreSQL 16 (with automatic schema initialization in `crates/aims-server/src/db.rs`) |
| Frontend | React 19, `@assistant-ui/react`, Vite 8, Tailwind CSS 4 |
| Testing | Cargo test (`cargo test`), Vitest (`npm run test:unit`), Playwright (`npm test`) |

---

## Project Structure

```
├── Cargo.toml                      # Rust workspace manifest
├── crates/
│   ├── aims-server/                # Rust Web & WebSocket server
│   │   └── src/
│   │       ├── main.rs             # Server entrypoint
│   │       ├── lib.rs              # AppState & Axum router assembly
│   │       ├── ahp_mirror.rs       # AHP state mirror (ahp::MultiHostStateMirror + reducers)
│   │       ├── ws.rs               # User (/socket/websocket) & Bot (/bot/websocket) WS handlers
│   │       ├── routes.rs           # REST API & signed asset upload endpoints
│   │       ├── db.rs               # SQLx PostgreSQL queries & auto-migrations
│   │       └── auth.rs             # bcrypt passwords, session tokens, HMAC upload signatures
│   │
│   └── aims-proxy/                 # Rust AHP proxy agent binary & library
│       └── src/
│           ├── main.rs             # CLI binary (`aims-proxy`)
│           └── lib.rs              # Bridges local AHP server (`ahp-ws`) <-> `aims-server`
│
├── assets/                         # Mobile-first React + @assistant-ui/react frontend
│   ├── js/
│   │   ├── app.jsx                 # React entrypoint
│   │   ├── runtime/
│   │   │   └── ahpRuntime.js       # @assistant-ui runtime, AttachmentAdapter & clipboard paste
│   │   ├── components/
│   │   │   ├── ChatView.jsx        # ThreadPrimitive, NewSessionCanvas, Inspector dock
│   │   │   ├── NewSessionCanvas.jsx# VS Code Agents session setup (worktree, branch, dir, mode)
│   │   │   ├── AssistantChatComposer.jsx # ComposerPrimitive + mobile clipboard image paste
│   │   │   ├── LiveThinking.jsx    # Real-time AHP reasoning & tool call stream
│   │   │   ├── QuestionApprovalCard.jsx # AHP ChatInputRequested interactive approvals
│   │   │   └── SubagentsPanel.jsx  # Nested subagents & running terminal processes
│   │   └── lib/
│   │       └── phoenixSocket.js    # Zero-dependency WebSocket channel client
│   ├── css/
│   │   └── app.css                 # Tailwind v4 + mobile-first responsive styles
│   └── vite.config.js              # Vite + Vitest configuration
└── priv/
    └── static/                     # Built PWA assets, manifest.webmanifest, sw.js
```

---

## Running Locally

### 1. Build Frontend Assets & Run Unit Tests

```bash
npm install
npm run test:unit
npm run build
```

### 2. Run the Rust Server (`aims-server`)

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/messaging_dev"
export SECRET_KEY_BASE="your-64-byte-secret-key-base"
cargo run -p aims-server
```

### 3. Connect Your Local AHP Server via `aims-proxy`

Create an AHP bot in the Web UI to get a `<BOT_TOKEN>`, then run:

```bash
cargo run -p aims-proxy -- \
  --ahp-url ws://127.0.0.1:12345 \
  --server-url ws://127.0.0.1:4000/bot/websocket \
  --token <BOT_TOKEN> \
  --workdir /path/to/your/workspace
```

### Local Proxy Administration

Root `sessionAdded` and `sessionSummaryChanged` notifications publish session
catalog updates immediately, including newly created idle sessions. Summary
changes resolve the latest catalog entry without loading chat history, and
sessions becoming active are subscribed for streaming events. The 60-second
reconciliation remains a recovery mechanism for missed notifications.

Startup and periodic status reconciliation do not import unopened history:
`reconcile_sessions` only updates existing AIMS records. Active resources and
explicitly opened/resynced sessions use the normal import path. Deploy both
the proxy and server to enable update-only reconciliation; older servers
ignore reconciliation frames rather than creating historical rows.

The proxy serves a local dashboard at **http://127.0.0.1:4035**. It shows
connection health, session resources, completion evidence, and search/filter
controls. Select resources to resync their history into AIMS, or review and
confirm a batch of up to 100 completed resources to archive.

Archiving affects **AIMS only**, not VS Code, worktrees, or files. An idle
resource is not eligible unless its latest turn explicitly completed and no
turn is active. A completed turn is not proof that the overall task is finished;
review the selection before confirming. Archives are acknowledged by AIMS and
preserved through later proxy syncs and restarts.

Deploy the updated `aims-server` to enable dashboard archiving; older servers
still support viewing and resync, but the archive action stays disabled.
The dashboard binds only to IPv4 loopback, rejects foreign hosts and
cross-origin writes, and never exposes proxy credentials to the browser.

The dashboard identifies subagents from the AHP `ahp-chat://subagent/` resource
namespace or an explicit tool-spawned chat origin, never from their titles.
They remain visible under the dashboard's **Subagents** filter with their real
local status, but are synced as archived/hidden resources in AIMS. Their live
events and messages cannot reopen standalone AIMS rows. VS Code execution is
unchanged, and user-created forks and side chats remain ordinary sessions.
