# Botamus Prime (Rust + AHP + `@assistant-ui/react`)

A mobile-first AI messaging & **Agent Host Protocol (AHP)** web application written in **Rust** (`axum`, `tokio`, `sqlx`, `ahp`, `ahp-types`, `ahp-ws`) on the backend and **React 19 + `@assistant-ui/react`** on the frontend.

The AHP bot integration acts as a bidirectional proxy (`aims-proxy`) for a local AHP server on its host machine, delivering full **VS Code Agents Window** parity in a mobile-first web UI — including creating new sessions with workspace directory, git branch, isolated git worktree, execution mode (`Interactive`, `Plan`, `Autopilot`), and agent role selection, plus instant mobile clipboard image paste and on-the-fly photo attachments.

---

## Architecture Overview

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
