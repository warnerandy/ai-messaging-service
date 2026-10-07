# Botamus Prime

A real-time AI messaging PWA built with **Phoenix** (Elixir) on the backend and **React** on the frontend. Users create bot tokens, connect external AI bots via WebSockets, and chat with them through a polished mobile-first interface.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│  React PWA (Vite + Tailwind)                      │
│  assets/js/app.jsx                                │
│  - Auth, Sidebar, ChatView, MessageBubble         │
└────────────┬────────────────────────┬─────────────┘
             │ REST API               │ WebSocket
             │ /api/*                 │ /socket (UserSocket)
             ▼                        ▼
┌───────────────────────────────────────────────────┐
│  Phoenix Backend (Bandit)                         │
│  MessagingWeb.Router                              │
│  - Public, User, and Bot API pipelines            │
│  - ConversationChannel (real-time messages)       │
└────────────┬────────────────────────┬─────────────┘
             │                        │ WebSocket
             │ Postgres (Ecto)        │ /bot (BotSocket)
             ▼                        ▼
┌──────────────────┐    ┌─────────────────────────┐
│  Database        │    │  External AI Bot Client  │
│  (PostgreSQL 16) │    │  Connects via BotChannel │
└──────────────────┘    └─────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Elixir 1.17 / OTP 27 |
| Web Framework | Phoenix 1.8 |
| HTTP Server | Bandit |
| Database | PostgreSQL 16 |
| Real-time | Phoenix Channels (WebSockets) |
| Frontend | React 19, Vite 8, Tailwind CSS 4, HeroUI |
| Auth | bcrypt + session tokens (API-based, no cookies) |
| Deployment | Docker Compose |
| Testing | ExUnit, Playwright (E2E), Vitest (unit) |

---

## Project Structure

```
├── lib/
│   ├── messaging/                  # Business logic (contexts)
│   │   ├── accounts/               # User, UserToken, Scope
│   │   ├── accounts.ex             # Accounts context (register, login, tokens)
│   │   ├── bots/                   # BotToken, BotModel schemas
│   │   ├── bots.ex                 # Bots context (create, auth, models)
│   │   ├── chat/                   # Conversation, Message schemas
│   │   ├── chat.ex                 # Chat context (conversations, messages)
│   │   ├── rate_limiter.ex         # ETS-based rate limiter
│   │   └── application.ex          # OTP supervision tree
│   │
│   └── messaging_web/              # Web layer
│       ├── router.ex               # All routes (browser, user API, bot API)
│       ├── endpoint.ex             # Plug pipeline, socket mounts
│       ├── channels/
│       │   ├── user_socket.ex      # User WS auth (session token)
│       │   ├── bot_socket.ex       # Bot WS auth (bot token)
│       │   ├── conversation_channel.ex  # User ↔ frontend real-time
│       │   └── bot_channel.ex      # Bot ↔ server real-time
│       ├── controllers/
│       │   ├── api/                # User-facing REST endpoints
│       │   │   ├── auth_controller.ex
│       │   │   ├── bot_token_controller.ex
│       │   │   ├── bot_model_controller.ex
│       │   │   ├── conversation_controller.ex
│       │   │   ├── message_controller.ex
│       │   │   └── ping_controller.ex
│       │   ├── bot_api/            # Bot-facing REST endpoints
│       │   │   ├── message_controller.ex
│       │   │   ├── status_controller.ex
│       │   │   ├── model_controller.ex
│       │   │   └── channel_controller.ex
│       │   └── app_controller.ex   # Serves the PWA index.html
│       ├── api_auth.ex             # Plug: authenticate user API tokens
│       └── bot_auth.ex             # Plug: authenticate bot API tokens
│
├── assets/                         # Frontend source
│   ├── js/
│   │   ├── app.jsx                 # React entry point
│   │   ├── components/
│   │   │   ├── AuthPanel.jsx       # Login / Register forms
│   │   │   ├── Sidebar.jsx         # Bot list, create bot, logout
│   │   │   ├── ChatView.jsx        # Messages, input, model picker
│   │   │   ├── MessageBubble.jsx   # Individual message rendering
│   │   │   ├── TypingIndicator.jsx # Bot thinking animation
│   │   │   └── BotTokenReveal.jsx  # Copy-to-clipboard token display
│   │   ├── hooks/
│   │   │   └── useWorkspaceData.js # Main state/data hook
│   │   └── lib/
│   │       ├── api.js              # fetch wrapper with auth
│   │       ├── data.js             # API call functions
│   │       ├── notifications.js    # Push notification helpers
│   │       ├── renderMarkdown.js   # Markdown → HTML (marked + highlight.js)
│   │       └── thinkingConfig.js   # Thinking blurbs and timer formatting
│   ├── css/
│   │   └── app.css                 # Tailwind + custom styles
│   └── vite.config.js              # Vite build configuration
│
├── priv/
│   ├── static/
│   │   ├── index.html              # PWA shell (React mounts here)
│   │   ├── manifest.webmanifest    # PWA manifest
│   │   └── sw.js                   # Service worker
│   └── repo/
│       ├── migrations/             # Ecto database migrations
│       └── seeds.exs               # Seed data
│
├── config/
│   ├── config.exs                  # Shared config
│   ├── dev.exs                     # Dev environment
│   ├── test.exs                    # Test environment
│   ├── prod.exs                    # Prod compile-time config
│   └── runtime.exs                 # Prod runtime config (env vars)
│
├── test/
│   ├── messaging/                  # Context unit tests
│   ├── messaging_web/              # Controller/channel tests
│   ├── e2e/                        # Playwright browser tests
│   └── support/                    # Test fixtures & helpers
│
├── docker-compose.yml              # Postgres + app services
├── Dockerfile                      # Multi-stage production build
├── mix.exs                         # Elixir deps & project config
└── package.json                    # Node deps & scripts
```

---

## Key Concepts

### Authentication Flow

1. **User registers/logs in** via `POST /api/register` or `POST /api/login`
2. Server returns a **session token** (base64-encoded)
3. Frontend stores token in `localStorage` and sends it as `Authorization: Bearer <token>` on API calls
4. For WebSockets, the token is passed as a connect param to `UserSocket`

### Bot Integration

1. A user creates a **bot token** (`POST /api/bot-tokens`) — this returns a raw token (shown once)
2. An external bot client connects to `ws://<host>/bot?token=<raw_token>` (BotSocket)
3. The bot joins its channel (`bot:<channel_code>`) and receives `new_message` events when users send messages
4. The bot responds by pushing messages via the channel or `POST /api/bot/messages`
5. The bot can acknowledge messages (shows "thinking" animation) and update its status/models

### Real-time Messaging

- **ConversationChannel** (`/socket`, topic `conversation:<id>`): pushes `new_message`, `message_acknowledged`, and `bot_status_changed` to the user's browser
- **BotChannel** (`/bot`, topic `bot:<channel_code>`): pushes `new_message` to the bot client when a user sends a message
- PubSub bridges the two: when a bot posts a reply, it's broadcast to the conversation topic

---

## Getting Started

### Prerequisites

- Elixir 1.17+ / OTP 27+
- PostgreSQL 16+
- Node.js 20+ (for frontend build)
- Docker & Docker Compose (optional, for containerized deployment)

### Local Development

```bash
# Install Elixir and Node dependencies, create DB, run migrations
mix setup

# Start the Phoenix server (with interactive shell)
iex -S mix phx.server
```

The app is available at [http://localhost:4000](http://localhost:4000).

### Environment Variables (Dev)

The dev config auto-connects to a local Postgres. Override with:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USERNAME` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `DB_HOST` | `localhost` | Database host |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `messaging_dev` | Database name |

Or set `DATABASE_URL` as a single connection string.

### Docker Compose (Production-like)

```bash
# Build assets, then build & start containers
./scripts/rebuild_compose.sh
```

Set these env vars for production:

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY_BASE` | Yes | 64-byte secret (generate with `mix phx.gen.secret`) |
| `DATABASE_URL` | Yes | Full Postgres connection URL |
| `PHX_HOST` | Yes | Public hostname (e.g. `aims.example.com`) |
| `CHECK_ORIGIN` | Recommended | Comma-separated allowed origins for WebSocket |
| `PORT` | No (default 4000) | HTTP listen port |

---

## API Routes

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Get session token |

### User API (requires `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ping` | Health check / connection test |
| GET | `/api/bot-tokens` | List user's bots |
| POST | `/api/bot-tokens` | Create a new bot token |
| DELETE | `/api/bot-tokens/:id` | Revoke a bot token |
| GET | `/api/bot-tokens/:id/models` | List bot's registered models |
| POST | `/api/bot-tokens/:id/refresh-models` | Ask bot to refresh models |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create a conversation |
| GET | `/api/conversations/:id` | Get conversation with messages |
| GET | `/api/conversations/:id/channel` | Get channel topic for WS |
| POST | `/api/conversations/:id/messages` | Send a message |

### Bot API (requires bot token via `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/bot/messages` | Send a reply message |
| GET | `/api/bot/messages` | Get pending messages |
| PUT | `/api/bot/messages/:id/acknowledge` | Mark message as seen |
| PUT | `/api/bot/status` | Update bot online/working status |
| PUT | `/api/bot/models` | Register available models |
| GET | `/api/bot/channel` | Get bot's channel info |

---

## WebSocket Channels

### UserSocket (`/socket`)

Connect with: `{ token: "<base64_session_token>" }`

**ConversationChannel** (topic: `conversation:<id>`)
- Server → Client events: `new_message`, `message_acknowledged`, `bot_status_changed`

### BotSocket (`/bot`)

Connect with: `{ token: "<raw_bot_token>" }`

**BotChannel** (topic: `bot:<channel_code>`)
- Server → Bot events: `new_message`
- Bot → Server events: `bot_reply`, `acknowledge_message`, `status_update`

---

## Running Tests

```bash
# Elixir unit & integration tests
mix test

# Run only previously failed tests
mix test --failed

# Frontend unit tests (Vitest)
npm run test:unit

# E2E browser tests (Playwright — requires running server)
npm test
```

---

## Mix Aliases

| Command | Description |
|---------|-------------|
| `mix setup` | Install deps, create DB, migrate, build assets |
| `mix precommit` | Compile (warnings-as-errors), unlock unused deps, format, test |
| `mix ecto.reset` | Drop + recreate + migrate + seed database |
| `mix assets.build` | Build frontend via Vite |
| `mix assets.deploy` | Production frontend build + digest |

---

## Frontend Build

The frontend uses **Vite** (not esbuild/tailwind mix tasks) for bundling:

```bash
# Dev build
npx vite build --config assets/vite.config.js

# Production build (called by mix assets.deploy)
npx vite build --config assets/vite.config.js --mode production
```

Output goes to `priv/static/assets/`. The PWA shell at `priv/static/index.html` loads the bundled JS/CSS.

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix
