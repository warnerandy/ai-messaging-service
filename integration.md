# API & Integration Guide

> [!NOTE]
> The primary API and protocol reference is located at [`integrate.md`](./integrate.md).
> Please see [integrate.md](./integrate.md) for the complete documentation.

## Summary of Integration Modes

1. **Standard Chat Protocol (`bot_type: "chat"`)**:
   - Conversational AI assistants
   - Model switching and token context size configuration (`context_sizes`)
   - Markdown rendering, code snippets, file/image uploads, and suggestion actions
   - REST endpoints & real-time WebSocket messaging on `bot:<CHANNEL_CODE>`

2. **Agent Host Protocol (`bot_type: "ahp"`)**:
   - Autonomous coding and programming agents
   - Multi-session sub-chats synchronized via `sync_sessions`
   - Real-time session statuses (`idle`, `running`, `thinking`, `waiting_for_input`, `archived`) via `session_status`
   - Streaming reasoning and thinking tokens
   - Human-in-the-loop interactive approvals (`question` and `answer_question`)
   - Mid-turn steering and execution stops (`steer_agent`)
   - Prompt queuing with automated sequential dispatch (`execute_queued_prompt`)
   - Bot configuration modal (⚙️ gear icon) with instant key regeneration (`POST /api/bot-tokens/:id/regenerate`)
   - Protocol badges on chat views (`AHP Protocol` vs `Chat Protocol`)

For complete request/response schemas, WebSocket event formats, and runnable client scripts, see **[`integrate.md`](./integrate.md)**.
