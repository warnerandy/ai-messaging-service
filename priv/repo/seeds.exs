# priv/repo/seeds.exs
Application.ensure_all_started(:ssl)
Application.ensure_all_started(:bcrypt_elixir)
Application.ensure_all_started(:phoenix_pubsub)
Application.load(:messaging)

_ =
  case Phoenix.PubSub.Supervisor.start_link(name: Messaging.PubSub) do
    {:ok, pid} -> {:ok, pid}
    {:error, {:already_started, pid}} -> {:ok, pid}
  end

import Ecto.Query, warn: false
alias Messaging.Repo
alias Messaging.Accounts
alias Messaging.Accounts.User
alias Messaging.Bots
alias Messaging.Chat

Ecto.Migrator.with_repo(Messaging.Repo, fn _repo ->
  email = "tester@example.com"
  password = "TestPassword123!"

  IO.puts("--- Seeding Test Data for Live Browser Testing ---")

# 1. Clean up existing test user if present
if user = Accounts.get_user_by_email(email) do
  IO.puts("Cleaning up existing user: #{email}")
  Repo.delete!(user)
end

# 2. Register fresh test user
changeset =
  %User{}
  |> User.email_changeset(%{email: email})
  |> User.password_changeset(%{password: password})

{:ok, user} = Repo.insert(changeset)
IO.puts("✓ Created test user: #{user.email} (Password: #{password})")

# -------------------------------------------------------------
# BOT 1: AHP Autonomous Coding Agent (Agent Host Protocol)
# -------------------------------------------------------------
{:ok, ahp_bot} =
  Bots.create_bot_token(%{
    user_id: user.id,
    name: "Atlas Coding Agent",
    bot_type: "ahp",
    metadata: %{"version" => "2.4.0", "engine" => "claude-code-ahp"}
  })

{:ok, _} = Bots.mark_connected(ahp_bot)

{:ok, _} =
  Bots.set_bot_models(ahp_bot, [
    %{
      name: "claude-3-7-sonnet",
      input_cost_per_token: Decimal.new("0.000003"),
      output_cost_per_token: Decimal.new("0.000015"),
      context_sizes: [64_000, 128_000, 200_000]
    },
    %{
      name: "claude-3-5-haiku",
      input_cost_per_token: Decimal.new("0.000001"),
      output_cost_per_token: Decimal.new("0.000005"),
      context_sizes: [32_000, 64_000, 128_000]
    }
  ])

IO.puts("✓ Created AHP Bot: #{ahp_bot.name} (Online, AHP Protocol)")

# AHP Sub-Chat 1: Thinking / Running session
{:ok, session1} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: ahp_bot.id,
    title: "Fix token revocation in UserAuth",
    external_session_id: "session-auth-revocation",
    status: "thinking",
    metadata: %{
      "step" => "Analyzing UserAuth.require_authenticated/2 plug",
      "current_step" => "Analyzing UserAuth.require_authenticated/2 plug",
      "tool" => "view_file",
      "tool_name" => "view_file",
      "recent_tools" => ["view_file", "grep_search", "run_command"],
      "thinking" => "Inspecting token verification pipeline in lib/messaging_web/user_auth.ex...\nChecking session validation against user revocation timestamps.\nFound: Session token does not verify revoked_at.\nPatching query to include token_valid_after timestamp.\nRunning unit tests to verify behavior...",
      "tool_calls" => [
        %{"name" => "view_file", "path" => "lib/messaging_web/user_auth.ex"},
        %{"name" => "grep_search", "query" => "get_user_by_session_token"},
        %{"name" => "run_command", "cmd" => "mix test test/messaging_web/user_auth_test.exs"}
      ]
    }
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session1.id,
    role: "user",
    content_type: "text",
    body: "When users change their passwords, existing web sessions should be invalidated immediately.",
    model: "claude-3-7-sonnet",
    context_size: 128_000,
    acknowledged: true,
    acknowledged_at: DateTime.utc_now() |> DateTime.truncate(:second)
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session1.id,
    role: "bot",
    content_type: "text",
    body: "I've started investigating the authentication pipeline. I located the session validation logic in `lib/messaging_web/user_auth.ex` and I'm drafting a test case to reproduce the stale session issue.",
    model: "claude-3-7-sonnet"
  })

# AHP Sub-Chat 2: Waiting for Input / Approval card session
{:ok, session2} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: ahp_bot.id,
    title: "Database Migration for Bot Token Index",
    external_session_id: "session-db-migration",
    status: "waiting_for_input",
    metadata: %{
      "step" => "Awaiting human approval before running database migration",
      "current_step" => "Awaiting human approval before running database migration",
      "tool" => "run_command",
      "tool_name" => "run_command",
      "recent_tools" => ["run_command"],
      "question" => %{
        "id" => "q-migrate-idx-01",
        "title" => "Database Schema Modification Approval",
        "prompt" => "Apply migration 20261006180000 to production database? This creates a composite index on [:bot_token_id, :external_session_id].",
        "options" => ["Approve Migration", "Reject", "Run with CONCURRENTLY"]
      }
    }
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session2.id,
    role: "user",
    content_type: "text",
    body: "Optimize the session lookup query in ConversationChannel for active bots.",
    model: "claude-3-7-sonnet",
    context_size: 64_000,
    acknowledged: true,
    acknowledged_at: DateTime.utc_now() |> DateTime.truncate(:second)
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session2.id,
    role: "bot",
    content_type: "text",
    body: "I've generated the migration script to add a composite index on `[:bot_token_id, :external_session_id]`. Before I execute `mix ecto.migrate`, please approve this action via the approval card above.",
    model: "claude-3-7-sonnet"
  })

# AHP Sub-Chat 3: Idle session with prompt queue
{:ok, session3} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: ahp_bot.id,
    title: "Add AHP Protocol Badge to Chat UI",
    external_session_id: "session-protocol-badge",
    status: "idle",
    metadata: %{
      "step" => "Completed badge implementation",
      "current_step" => "Ready for next instruction",
      "prompt_queue" => [
        "Add tooltip with protocol specification link",
        "Support high contrast mode in CSS variables"
      ]
    }
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session3.id,
    role: "user",
    content_type: "text",
    body: "Can you add a badge to the chat header that clearly indicates whether the bot uses AHP or the standard Chat Protocol?",
    model: "claude-3-7-sonnet",
    context_size: 128_000,
    acknowledged: true,
    acknowledged_at: DateTime.utc_now() |> DateTime.truncate(:second)
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: session3.id,
    role: "bot",
    content_type: "text",
    body: "Done! I added the `.bot-protocol-badge` component to `ChatView.jsx` and styled it in `app.css`. It displays **AHP Protocol** (indigo pill) for AHP agents and **Chat Protocol** (emerald pill) for standard chat bots.",
    model: "claude-3-7-sonnet"
  })

IO.puts("✓ Created 3 AHP Sub-Chats: (1 Thinking, 1 Needs Input, 1 Idle with Prompt Queue)")

# -------------------------------------------------------------
# BOT 2: Standard AI Chat Bot (Chat Protocol)
# -------------------------------------------------------------
{:ok, chat_bot} =
  Bots.create_bot_token(%{
    user_id: user.id,
    name: "Claude 3.7 Sonnet",
    bot_type: "chat",
    metadata: %{"provider" => "Anthropic"}
  })

{:ok, _} = Bots.mark_connected(chat_bot)

{:ok, _} =
  Bots.set_bot_models(chat_bot, [
    %{
      name: "claude-3-7-sonnet",
      input_cost_per_token: Decimal.new("0.000003"),
      output_cost_per_token: Decimal.new("0.000015"),
      context_sizes: [64_000, 128_000, 200_000]
    },
    %{
      name: "claude-3-5-haiku",
      input_cost_per_token: Decimal.new("0.000001"),
      output_cost_per_token: Decimal.new("0.000005"),
      context_sizes: [32_000, 64_000, 128_000]
    }
  ])

IO.puts("✓ Created Chat Bot: #{chat_bot.name} (Online, Chat Protocol)")

# Chat Conversation 1: Modern Phoenix & LiveView
{:ok, conv1} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: chat_bot.id,
    title: "Phoenix 1.8 & LiveView Architecture"
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv1.id,
    role: "user",
    content_type: "text",
    body: "Can you explain how Phoenix 1.8 handles colocated hooks and LiveView streams?",
    model: "claude-3-7-sonnet",
    context_size: 128_000,
    acknowledged: true,
    acknowledged_at: DateTime.utc_now() |> DateTime.truncate(:second)
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv1.id,
    role: "bot",
    content_type: "text",
    body: """
Phoenix 1.8 brings major refinements to real-time interactive UI patterns:

### 1. Colocated JavaScript Hooks
Instead of defining hooks in external bundle files, colocated hooks live right alongside your HEEx templates:

```elixir
<input type="text" name="user[phone]" id="user-phone" phx-hook=".PhoneNumber" />
<script :type={Phoenix.LiveView.ColocatedHook} name=".PhoneNumber">
  export default {
    mounted() {
      this.el.addEventListener("input", e => {
        // inline formatting logic
      })
    }
  }
</script>
```

### 2. LiveView Streams
Streams eliminate large client/server memory overhead by holding zero items in server state:

- **Append**: `stream(socket, :messages, [new_msg])`
- **Prepend**: `stream(socket, :messages, [new_msg], at: -1)`
- **Reset**: `stream(socket, :messages, messages, reset: true)`

Would you like to see how to wire this up with Phoenix PubSub broadcasts?
""",
    model: "claude-3-7-sonnet"
  })

# Suggestions message
{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv1.id,
    role: "bot",
    content_type: "text",
    body: "Show me an example with Phoenix PubSub",
    is_suggestion: true
  })

# Chat Conversation 2: PostgreSQL Index Types
{:ok, conv2} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: chat_bot.id,
    title: "PostgreSQL Index Optimization"
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv2.id,
    role: "user",
    content_type: "text",
    body: "When should I use GiST or BRIN indexes over standard B-trees?",
    model: "claude-3-7-sonnet",
    context_size: 64_000,
    acknowledged: true,
    acknowledged_at: DateTime.utc_now() |> DateTime.truncate(:second)
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv2.id,
    role: "bot",
    content_type: "text",
    body: """
Here is a quick rule of thumb for PostgreSQL index selection:

| Index Type | Best For | Typical Use Cases |
| :--- | :--- | :--- |
| **B-Tree** | Equality (`=`) and range (`<`, `<=`, `>`, `>=`) queries | Primary keys, foreign keys, timestamps |
| **GiST** | Geometric / 2D / Nearest Neighbor / Range types | PostGIS geometry, temporal range exclusions (`tsrange`) |
| **BRIN** | Naturally ordered append-only sequential time-series | High-volume logs, sensor metric tables with millions of rows |

For time-series tables where rows are inserted sequentially by `inserted_at`, **BRIN** consumes less than 1% of the disk space of a B-tree while offering comparable range scan speeds.
""",
    model: "claude-3-7-sonnet"
  })

# -------------------------------------------------------------
# BOT 3: Offline Bot (to test offline indicator)
# -------------------------------------------------------------
{:ok, offline_bot} =
  Bots.create_bot_token(%{
    user_id: user.id,
    name: "Llama 3.3 Assistant (Offline)",
    bot_type: "chat",
    metadata: %{"model" => "llama-3.3-70b"}
  })

# Keep is_connected: false

{:ok, _} =
  Bots.set_bot_models(offline_bot, [
    %{
      name: "llama-3.3-70b",
      input_cost_per_token: Decimal.new("0.0000008"),
      output_cost_per_token: Decimal.new("0.000002"),
      context_sizes: [8192, 32_768, 128_000]
    }
  ])

{:ok, conv3} =
  Chat.create_conversation(%{
    user_id: user.id,
    bot_token_id: offline_bot.id,
    title: "General Q&A"
  })

{:ok, _} =
  Chat.create_message(%{
    conversation_id: conv3.id,
    role: "user",
    content_type: "text",
    body: "Hello! Are you available?",
    model: "llama-3.3-70b"
  })

IO.puts("✓ Created Offline Bot: #{offline_bot.name} (Offline)")

IO.puts("""
=============================================================
🎉 SEED DATA GENERATION COMPLETE!

You can log in to http://localhost:4002 with:
  Email:    #{email}
  Password: #{password}
=============================================================
""")
end)
