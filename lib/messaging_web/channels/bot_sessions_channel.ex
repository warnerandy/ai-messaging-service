defmodule MessagingWeb.BotSessionsChannel do
  use MessagingWeb, :channel

  alias Messaging.{Bots, Chat}

  @impl true
  def join("bot_sessions:" <> bot_token_id, _payload, socket) do
    user = socket.assigns.current_user

    with {id, ""} <- Integer.parse(bot_token_id),
         bot_token when not is_nil(bot_token) <- Bots.get_bot_token!(id, user.id) do
      topic = "bot_sessions:#{bot_token.id}"
      Phoenix.PubSub.subscribe(Messaging.PubSub, topic)

      sessions = Chat.list_conversations_for_bot(bot_token.id)

      serialized =
        Enum.map(sessions, fn c ->
          %{
            id: c.id,
            external_session_id: c.external_session_id,
            title: c.title,
            status: c.status,
            metadata: c.metadata,
            parent_session_id:
              c.metadata &&
                (c.metadata["parent_session_id"] || c.metadata["parentSessionId"] ||
                   c.metadata["parent_id"] || c.metadata["parentId"]),
            last_user_input_time: c.last_user_input_time,
            last_modified_time: c.last_modified_time,
            last_message_at: c.last_message_at,
            inserted_at: c.inserted_at,
            updated_at: c.updated_at
          }
        end)

      bot_payload = %{
        id: bot_token.id,
        name: bot_token.name,
        bot_type: bot_token.bot_type,
        metadata: bot_token.metadata || %{},
        is_connected: bot_token.is_connected,
        is_working: bot_token.is_working
      }

      {:ok, %{bot_token_id: bot_token.id, sessions: serialized, bot: bot_payload},
       assign(socket, :bot_token_id, bot_token.id)}
    else
      _ -> {:error, %{reason: "unauthorized"}}
    end
  rescue
    Ecto.NoResultsError ->
      {:error, %{reason: "not_found"}}
  end

  @impl true
  def handle_info({:bot_sessions_updated, bot_id, sessions}, socket) do
    active_sessions = Enum.reject(sessions, &(&1.status == "archived"))

    push(socket, "bot_sessions_updated", %{
      bot_token_id: bot_id,
      sessions:
        Enum.map(active_sessions, fn c ->
          %{
            id: c.id,
            external_session_id: c.external_session_id,
            title: c.title,
            status: c.status,
            metadata: c.metadata,
            parent_session_id:
              c.metadata &&
                (c.metadata["parent_session_id"] || c.metadata["parentSessionId"] ||
                   c.metadata["parent_id"] || c.metadata["parentId"]),
            last_user_input_time: c.last_user_input_time,
            last_modified_time: c.last_modified_time,
            last_message_at: c.last_message_at,
            inserted_at: c.inserted_at,
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

  @impl true
  def handle_info({:conversation_created, conv}, socket) do
    push(socket, "conversation_created", %{
      conversation: %{
        id: conv.id,
        external_session_id: conv.external_session_id,
        title: conv.title,
        status: conv.status,
        metadata: conv.metadata,
        inserted_at: conv.inserted_at,
        updated_at: conv.updated_at
      }
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:session_message_created, conv_id, timestamp}, socket) do
    push(socket, "session_message_created", %{
      conversation_id: conv_id,
      updated_at: timestamp
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:bot_updated, updated_bot}, socket) do
    if updated_bot.id == socket.assigns[:bot_token_id] do
      push(socket, "bot_updated", %{
        bot: %{
          id: updated_bot.id,
          name: updated_bot.name,
          bot_type: updated_bot.bot_type,
          metadata: updated_bot.metadata || %{},
          is_connected: updated_bot.is_connected,
          is_working: updated_bot.is_working
        }
      })
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:bot_status_changed, updated_bot}, socket) do
    if updated_bot.id == socket.assigns[:bot_token_id] do
      push(socket, "bot_updated", %{
        bot: %{
          id: updated_bot.id,
          name: updated_bot.name,
          bot_type: updated_bot.bot_type,
          metadata: updated_bot.metadata || %{},
          is_connected: updated_bot.is_connected,
          is_working: updated_bot.is_working
        }
      })
    end

    {:noreply, socket}
  end
end
