defmodule MessagingWeb.BotSessionsChannel do
  use MessagingWeb, :channel

  alias Messaging.Bots

  @impl true
  def join("bot_sessions:" <> bot_token_id, _payload, socket) do
    user = socket.assigns.current_user

    with {id, ""} <- Integer.parse(bot_token_id),
         bot_token when not is_nil(bot_token) <- Bots.get_bot_token!(id, user.id) do
      topic = "bot_sessions:#{bot_token.id}"
      Phoenix.PubSub.subscribe(Messaging.PubSub, topic)

      {:ok, %{bot_token_id: bot_token.id}, assign(socket, :bot_token_id, bot_token.id)}
    else
      _ -> {:error, %{reason: "unauthorized"}}
    end
  rescue
    Ecto.NoResultsError ->
      {:error, %{reason: "not_found"}}
  end

  @impl true
  def handle_info({:bot_sessions_updated, bot_id, sessions}, socket) do
    push(socket, "bot_sessions_updated", %{
      bot_token_id: bot_id,
      sessions:
        Enum.map(sessions, fn c ->
          %{
            id: c.id,
            external_session_id: c.external_session_id,
            title: c.title,
            status: c.status,
            metadata: c.metadata,
            updated_at: c.updated_at
          }
        end)
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:session_status_changed, conv_id, status, metadata}, socket) do
    push(socket, "session_status_changed", %{
      conversation_id: conv_id,
      status: status,
      metadata: metadata
    })

    {:noreply, socket}
  end
end
