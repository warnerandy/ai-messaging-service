defmodule MessagingWeb.BotChannel do
  use MessagingWeb, :channel
  require Logger

  alias Messaging.{Bots, Chat}

  @impl true
  def join("bot:" <> topic_key, _payload, socket) do
    bot_token = socket.assigns.bot_token
    # Allow joining by either raw token (preferred) or numeric token id.
    # Note: bot_token.token is a virtual field (nil after DB load), so we
    # compare against the raw_token stored in socket assigns at connect time.
    if authorized_topic?(topic_key, socket) do
      Logger.info(
        "[BotChannel] joined topic=bot:#{topic_key} bot_token_id=#{bot_token.id} name=\"#{bot_token.name}\""
      )

      send(self(), :after_join)
      {:ok, socket}
    else
      Logger.warning(
        "[BotChannel] unauthorized join attempt topic=bot:#{topic_key} bot_token_id=#{bot_token.id}"
      )

      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    bot_token = socket.assigns.bot_token
    pubsub_topic = "bot:#{bot_token.id}"
    Phoenix.PubSub.subscribe(Messaging.PubSub, pubsub_topic)

    Logger.info(
      "[BotChannel] subscribed to PubSub topic=#{pubsub_topic} bot_token_id=#{bot_token.id}"
    )

    {:noreply, socket}
  end

  @impl true
  def handle_info({:new_message, message, conversation}, socket) do
    bot_token = socket.assigns.bot_token

    Logger.info(
      "[BotChannel] pushing new_message message_id=#{message.id} conversation_id=#{conversation.id} bot_token_id=#{bot_token.id}"
    )

    push(socket, "new_message", %{
      conversation_id: conversation.id,
      message: %{
        id: message.id,
        role: message.role,
        content_type: message.content_type,
        body: message.body,
        metadata: message.metadata,
        model: message.model,
        context_size: message.context_size,
        acknowledged_at: message.acknowledged_at,
        is_suggestion: message.is_suggestion,
        inserted_at: message.inserted_at
      }
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info(:refresh_models, socket) do
    Logger.info("[BotChannel] pushing refresh_models bot_token_id=#{socket.assigns.bot_token.id}")
    push(socket, "refresh_models", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:answer_question, payload}, socket) do
    Logger.info("[BotChannel] pushing answer_question bot_token_id=#{socket.assigns.bot_token.id}")
    push(socket, "answer_question", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:steer_agent, payload}, socket) do
    Logger.info("[BotChannel] pushing steer_agent bot_token_id=#{socket.assigns.bot_token.id}")
    push(socket, "steer_agent", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:execute_queued_prompt, payload}, socket) do
    Logger.info(
      "[BotChannel] pushing execute_queued_prompt bot_token_id=#{socket.assigns.bot_token.id}"
    )

    push(socket, "execute_queued_prompt", payload)
    {:noreply, socket}
  end

  # Bot sends a message reply
  @impl true
  def handle_in("send_message", payload, socket) do
    bot_token = socket.assigns.bot_token

    Logger.info(
      "[BotChannel] received send_message conversation_id=#{payload["conversation_id"]} bot_token_id=#{bot_token.id}"
    )

    attrs = %{
      role: "bot",
      content_type: payload["content_type"] || "text",
      body: payload["body"],
      metadata: payload["metadata"] || %{},
      is_suggestion: payload["is_suggestion"] || false,
      conversation_id: payload["conversation_id"]
    }

    conversation = Chat.get_conversation!(attrs.conversation_id, bot_token_id: bot_token.id)

    case Chat.create_message(%{attrs | conversation_id: conversation.id}) do
      {:ok, message} ->
        Logger.info("[BotChannel] send_message saved message_id=#{message.id}")
        {:reply, {:ok, %{id: message.id}}, socket}

      {:error, changeset} ->
        Logger.warning("[BotChannel] send_message failed errors=#{inspect(changeset.errors)}")
        {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
    end
  rescue
    Ecto.NoResultsError ->
      {:reply, {:error, %{reason: "not_found"}}, socket}
  end

  # Bot acknowledges receipt of a user message (shows thinking animation)
  def handle_in(
        "acknowledge_message",
        %{"message_id" => message_id, "conversation_id" => conversation_id},
        socket
      ) do
    bot_token = socket.assigns.bot_token
    conversation = Chat.get_conversation!(conversation_id, bot_token_id: bot_token.id)

    Logger.info(
      "[BotChannel] acknowledge_message message_id=#{message_id} conversation_id=#{conversation.id} bot_token_id=#{bot_token.id}"
    )

    Chat.acknowledge_message(message_id, conversation.id)
    {:reply, :ok, socket}
  rescue
    Ecto.NoResultsError ->
      {:reply, {:error, %{reason: "not_found"}}, socket}
  end

  # Bot updates its working status
  def handle_in("update_status", %{"is_working" => is_working}, socket) do
    bot_token = socket.assigns.bot_token

    Logger.info(
      "[BotChannel] update_status is_working=#{is_working} bot_token_id=#{bot_token.id}"
    )

    Bots.update_bot_status(bot_token, %{is_working: is_working})
    {:reply, :ok, socket}
  end

  # Bot synchronizes active AHP sessions
  def handle_in("sync_sessions", %{"sessions" => sessions}, socket) do
    bot_token = socket.assigns.bot_token

    Logger.info(
      "[BotChannel] sync_sessions count=#{length(sessions)} bot_token_id=#{bot_token.id}"
    )

    case Chat.sync_bot_sessions(bot_token, sessions) do
      {:ok, synced} ->
        serialized =
          Enum.map(synced, fn c ->
            %{
              id: c.id,
              external_session_id: c.external_session_id,
              title: c.title,
              status: c.status,
              metadata: c.metadata,
              updated_at: c.updated_at
            }
          end)

        {:reply, {:ok, %{sessions: serialized}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # Bot updates sub-chat / session status (e.g. idle, running, waiting_for_input)
  def handle_in("session_status", payload, socket) do
    bot_token = socket.assigns.bot_token
    conv = resolve_conversation(bot_token, payload)
    status = payload["status"] || "idle"
    metadata = payload["metadata"] || %{}

    Logger.info(
      "[BotChannel] session_status conversation_id=#{conv.id} status=#{status} bot_token_id=#{bot_token.id}"
    )

    Chat.update_session_status(conv.id, status, metadata)
    maybe_dispatch_queued_prompt(conv.id, status, socket)

    {:reply, :ok, socket}
  rescue
    Ecto.NoResultsError ->
      {:reply, {:error, %{reason: "not_found"}}, socket}
  end

  # Bot ferrys raw AHP event (thinking, step, question, status, plan, etc.)
  def handle_in("ahp_event", payload, socket) do
    bot_token = socket.assigns.bot_token
    conv = resolve_conversation(bot_token, payload)
    event_type = payload["event_type"] || payload["type"]
    data = payload["data"] || %{}

    if event_type == "status" or Map.has_key?(data, "status") do
      new_status = data["status"] || event_type
      Chat.update_session_status(conv.id, new_status, data)
      maybe_dispatch_queued_prompt(conv.id, new_status, socket)
    end

    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "conversation:#{conv.id}",
      {:ahp_event, conv.id, event_type, data}
    )

    {:reply, :ok, socket}
  rescue
    Ecto.NoResultsError ->
      {:reply, {:error, %{reason: "not_found"}}, socket}
  end

  @impl true
  def terminate(reason, socket) do
    bot_token = socket.assigns.bot_token

    Logger.info(
      "[BotChannel] disconnected bot_token_id=#{bot_token.id} name=\"#{bot_token.name}\" reason=#{inspect(reason)}"
    )

    Bots.mark_disconnected(bot_token)
    :ok
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  # Compare topic_key against the channel_code (preferred) or numeric id (legacy).
  defp authorized_topic?(topic_key, socket) do
    bot_token = socket.assigns.bot_token

    case Integer.parse(topic_key) do
      {id, ""} -> id == bot_token.id
      _ -> topic_key == bot_token.channel_code
    end
  end

  defp resolve_conversation(bot_token, payload) do
    cond do
      conv_id = payload["conversation_id"] ->
        Chat.get_conversation!(conv_id, bot_token_id: bot_token.id)

      ext_id = payload["session_id"] || payload["external_session_id"] ->
        case Chat.get_conversation_by_external_session(bot_token.id, ext_id) do
          nil ->
            {:ok, conv} =
              Chat.create_conversation(%{
                user_id: bot_token.user_id,
                bot_token_id: bot_token.id,
                external_session_id: to_string(ext_id),
                title: "Session #{ext_id}",
                status: "idle"
              })

            conv

          conv ->
            conv
        end

      true ->
        raise Ecto.NoResultsError, queryable: Messaging.Chat.Conversation
    end
  end

  defp maybe_dispatch_queued_prompt(conv_id, "idle", socket) do
    case Chat.pop_queued_prompt(conv_id) do
      {:ok, %{} = prompt, _remaining} ->
        Logger.info("[BotChannel] popping queued prompt conversation_id=#{conv_id}")

        push(socket, "execute_queued_prompt", %{
          conversation_id: conv_id,
          prompt: prompt
        })

      _ ->
        :ok
    end
  end

  defp maybe_dispatch_queued_prompt(_conv_id, _status, _socket), do: :ok
end
