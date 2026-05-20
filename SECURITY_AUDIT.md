# Security Audit: Bot Access Control

## Critical Issues

### 1. Uploaded files are publicly accessible without authentication

**File:** `lib/messaging_web/endpoint.ex` (lines 9-12)

```elixir
plug Plug.Static,
  at: "/uploads",
  from: :messaging,
  gzip: false
```

The `/uploads` path serves all uploaded assets (images, PDFs, etc.) to **anyone** without authentication. An attacker who guesses or enumerates conversation IDs and filenames can access files from any user's conversations.

**Fix:** Serve uploads through an authenticated controller route instead of `Plug.Static`, or use signed/expiring URLs.

---

### 2. `get_bot_token!/1` fetches any bot token without ownership scoping

**File:** `lib/messaging/bots.ex` (line 18)

```elixir
def get_bot_token!(id), do: Repo.get!(BotToken, id)
```

This function fetches any bot token by ID regardless of who owns it. While the controllers *do* check `bot_token.user_id == user.id` after the fetch, the pattern is fragile — a missed ownership check in any new code path would be an immediate authorization bypass.

**Fix:** Create a scoped version: `get_bot_token!(id, user_id)` that includes `where(user_id: ^user_id)` in the query. Use it everywhere to enforce ownership at the data layer.

---

### 3. `get_conversation!/1` fetches any conversation without ownership scoping

**File:** `lib/messaging/chat.ex` (line 27)

```elixir
def get_conversation!(id), do: Repo.get!(Conversation, id) |> Repo.preload(:bot_token)
```

Same issue as above. Any code path that calls this without subsequently checking `conversation.user_id` or `conversation.bot_token_id` exposes cross-user data. This is already used in 5+ places across controllers and channels.

**Fix:** Create scoped variants: `get_conversation!(id, user_id:)` and `get_conversation!(id, bot_token_id:)`.

---

### 4. Enumerable integer IDs allow resource enumeration

**Files:** All schemas use auto-incrementing integer IDs.

An attacker with a valid session can probe sequential IDs (`/api/conversations/1`, `/api/conversations/2`, etc.) to discover resources. While the ownership checks return 403/forbidden, this still leaks information about what resources exist (403 vs 404 from `Repo.get!` raising `Ecto.NoResultsError`).

**Fix:** Use UUIDs for public-facing resource IDs, or catch `Ecto.NoResultsError` and consistently return 404 (not 403) to avoid leaking existence info.

---

### 5. Bot token shown in plaintext on creation response — no second chance to retrieve

**File:** `lib/messaging_web/controllers/api/bot_token_controller.ex` (line 32)

```elixir
json(%{id: bot_token.id, name: bot_token.name, token: bot_token.token})
```

This is acceptable as a one-time reveal, but the token is transmitted in the JSON response body. If the API is not served over HTTPS (e.g., in dev/staging), the token is exposed in transit.

**Fix:** Ensure HTTPS is enforced in all non-local environments. Consider adding `force_ssl` to the endpoint config.

---

### 6. No rate limiting on authentication endpoints

**File:** `lib/messaging_web/router.ex` (lines 23-28)

```elixir
scope "/api", MessagingWeb.API do
  pipe_through :api
  post "/register", AuthController, :register
  post "/login", AuthController, :login
end
```

No rate limiting is applied. An attacker can brute-force login credentials or spam registrations without throttling.

**Fix:** Add rate limiting (e.g., `plug Hammer` or similar) to the public auth endpoints.

---

### 7. No rate limiting on bot token authentication

**File:** `lib/messaging/bots.ex` (line 27)

The `authenticate_bot_token/1` function has no rate limiting. An attacker can brute-force bot tokens against the `/api/bot/*` endpoints or WebSocket connection.

**Fix:** Add rate limiting to bot auth attempts, potentially with exponential backoff or IP-based throttling.

---

### 8. `String.to_integer/1` without validation allows crash-based DoS

**Files:** `lib/messaging_web/controllers/bot_api/message_controller.ex` (line 83), `lib/messaging_web/channels/conversation_channel.ex` (line 8)

```elixir
conversation_id = String.to_integer(id)
```

Passing a non-numeric string will crash the process with an `ArgumentError`. While Phoenix/LiveView handles this gracefully (500 response), it's still unhandled input that could be used to generate noise in error logging.

**Fix:** Use `Integer.parse/1` with proper error handling, or let Ecto handle the casting.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | **HIGH** | Uploaded files publicly accessible without auth |
| 2 | **MEDIUM** | Unscoped `get_bot_token!/1` — fragile auth pattern |
| 3 | **MEDIUM** | Unscoped `get_conversation!/1` — fragile auth pattern |
| 4 | **LOW** | Integer ID enumeration leaks resource existence |
| 5 | **LOW** | Token visible in HTTP response (enforce HTTPS) |
| 6 | **MEDIUM** | No rate limiting on login/register |
| 7 | **MEDIUM** | No rate limiting on bot token auth |
| 8 | **LOW** | Unvalidated string-to-integer conversions |

The most impactful fix is #1 (uploaded files). Issues #2 and #3 are the most likely to cause an authorization bypass if new features are added without careful review.
