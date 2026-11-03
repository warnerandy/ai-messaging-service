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
      session_id: conversation.external_session_id,
      external_session_id: conversation.external_session_id,
      conversation_title: conversation.title,
      conversation_metadata: conversation.metadata || %{},
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
  def handle_info({:create_session, payload}, socket) do
    Logger.info(
      "[BotChannel] pushing create_session session_id=#{payload["external_session_id"]} conv_id=#{payload["conversation_id"]} bot_token_id=#{socket.assigns.bot_token.id}"
    )

    push(socket, "create_session", payload)
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
    Logger.info(
      "[BotChannel] pushing answer_question bot_token_id=#{socket.assigns.bot_token.id}"
    )

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

  @impl true
  def handle_info({:request_session_sync, payload}, socket) do
    Logger.info(
      "[BotChannel] pushing request_session_sync session_id=#{payload["external_session_id"]} conv_id=#{payload["conversation_id"]} bot_token_id=#{socket.assigns.bot_token.id}"
    )

    push(socket, "request_session_sync", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:session_config_changed, payload}, socket) do
    Logger.info(
      "[BotChannel] pushing session_config_changed conv_id=#{payload["conversation_id"]} bot_token_id=#{socket.assigns.bot_token.id}"
    )

    push(socket, "session_config_changed", payload)
    {:noreply, socket}
  end

  # Bot sends a message reply
  @impl true
  def handle_in("send_message", payload, socket) do
    bot_token = socket.assigns.bot_token
    conversation = Chat.resolve_bot_conversation(bot_token, payload)

    Logger.info(
      "[BotChannel] received send_message conversation_id=#{conversation.id} bot_token_id=#{bot_token.id}"
    )

    attrs = %{
      role: "bot",
      content_type: payload["content_type"] || "text",
      body: payload["body"],
      metadata: payload["metadata"] || %{},
      is_suggestion: payload["is_suggestion"] || false,
      conversation_id: conversation.id
    }

    case Chat.create_message(attrs) do
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
  def handle_in("acknowledge_message", payload, socket) do
    bot_token = socket.assigns.bot_token
    conversation = Chat.resolve_bot_conversation(bot_token, payload)
    message_id = payload["message_id"]

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

    {:ok, synced} = Chat.sync_bot_sessions(bot_token, sessions)

    serialized =
      Enum.map(synced, fn c ->
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

    {:reply, {:ok, %{sessions: serialized}}, socket}
  end

  # Bot updates sub-chat / session status (e.g. idle, running, waiting_for_input)
  def handle_in("session_status", payload, socket) do
    bot_token = socket.assigns.bot_token
    conv = Chat.resolve_bot_conversation(bot_token, payload)
    status = payload["status"] || "idle"
    raw_metadata = payload["metadata"] || %{}

    extra_meta =
      payload
      |> Map.take([
        "question",
        "questions",
        "prompt",
        "step",
        "action",
        "data",
        "tool",
        "input_request",
        "parent_session_id",
        "parentSessionId",
        "parent_id",
        "parentId",
        "nested",
        "is_nested",
        "subagents",
        "sub_agents",
        "child_session_ids",
        "processes",
        "tool_calls",
        "thinking",
        "agent_mode",
        "agentMode",
        "mode",
        "modes",
        "agent_modes",
        "agentModes",
        "supported_modes",
        "use_worktree",
        "useWorktree",
        "worktree",
        "worktree_supported",
        "supports_worktree",
        "allow_worktree",
        "base_branch",
        "baseBranch",
        "branch",
        "git_branch",
        "branches",
        "available_branches",
        "base_branches",
        "agent_type",
        "agentType",
        "agent_types",
        "agentTypes",
        "roles"
      ])
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    metadata = Map.merge(extra_meta, raw_metadata)

    Logger.info(
      "[BotChannel] session_status conversation_id=#{conv.id} status=#{status} bot_token_id=#{bot_token.id}"
    )

    Chat.update_session_status(conv.id, status, metadata)
    maybe_create_status_message(conv, payload, metadata, status)
    maybe_dispatch_queued_prompt(conv.id, status, socket)

    {:reply, :ok, socket}
  rescue
    Ecto.NoResultsError ->
      {:reply, {:error, %{reason: "not_found"}}, socket}
  end

  # Bot ferrys raw AHP event (thinking, step, question, status, plan, etc.)
  def handle_in("ahp_event", payload, socket) do
    bot_token = socket.assigns.bot_token
    conv = Chat.resolve_bot_conversation(bot_token, payload)
    event_type = payload["event_type"] || payload["type"]
    data = payload["data"] || %{}

    cond do
      event_type == "question" ->
        question_data = if is_map(data), do: data, else: %{"prompt" => to_string(data)}
        meta = %{"question" => question_data}

        meta =
          if Map.has_key?(question_data, "step"),
            do: Map.put(meta, "step", question_data["step"]),
            else: meta

        Chat.update_session_status(conv.id, "waiting_for_input", meta)

      event_type == "status" or
          (is_map(data) and Map.has_key?(data, "status") and
             event_type not in ["subagent", "process", "step", "tool_call"]) ->
        new_status = data["status"] || event_type
        Chat.update_session_status(conv.id, new_status, data)
        maybe_dispatch_queued_prompt(conv.id, new_status, socket)

      event_type in ["step", "tool_call"] and is_map(data) ->
        existing_calls = List.wrap(get_in(conv.metadata || %{}, ["tool_calls"]))
        updated_calls = Enum.take(existing_calls ++ [data], -50)

        step_meta =
          data
          |> Map.take(["step", "tool", "name", "tool_name", "command", "args", "tool_status"])
          |> Enum.reject(fn {_k, v} -> is_nil(v) end)
          |> Map.new()
          |> Map.put("tool_calls", updated_calls)

        Chat.update_session_status(conv.id, conv.status, step_meta)

      event_type in ["subagent", "subagents"] ->
        subagents_meta = merge_subagent_metadata(conv.metadata || %{}, data)
        Chat.update_session_status(conv.id, conv.status, %{"subagents" => subagents_meta})

      event_type in ["process", "processes"] ->
        processes_meta = merge_process_metadata(conv.metadata || %{}, data)
        Chat.update_session_status(conv.id, conv.status, %{"processes" => processes_meta})

      event_type in ["plan", "changeset"] and is_map(data) ->
        Chat.update_session_status(conv.id, conv.status, %{event_type => data})

      event_type in ["session_config", "mode_change", "config"] and is_map(data) ->
        Chat.update_session_metadata(conv.id, data)

      true ->
        :ok
    end

    maybe_create_ahp_message(conv, event_type, data)

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

  # Bot updates session configuration (mode, worktree, base branch, agent types)
  def handle_in("update_session_config", payload, socket) do
    bot_token = socket.assigns.bot_token
    conv = Chat.resolve_bot_conversation(bot_token, payload)
    meta = payload["metadata"] || payload["config"] || payload
    {:ok, updated} = Chat.update_session_metadata(conv.id, meta)
    {:reply, {:ok, %{metadata: updated.metadata}}, socket}
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

  defp maybe_create_status_message(conv, payload, metadata, status) do
    body =
      payload["final_message"] || metadata["final_message"] ||
        if status in ["idle", "completed", "done", "waiting_for_input"] do
          payload["message"] || metadata["message"] || payload["response"] || metadata["response"]
        end

    if is_binary(body) and String.trim(body) != "" do
      trimmed = String.trim(body)
      last_msg = Chat.get_last_message(conv.id)

      unless last_msg && last_msg.role == "bot" && String.trim(last_msg.body || "") == trimmed do
        Chat.create_message(%{
          conversation_id: conv.id,
          role: "bot",
          content_type: "text",
          body: trimmed,
          metadata: metadata
        })
      end
    end
  end

  defp maybe_create_ahp_message(conv, event_type, data) do
    msg_body =
      cond do
        event_type in [
          "message",
          "response",
          "completion",
          "result",
          "turn_completed",
          "final_message",
          "text"
        ] ->
          cond do
            is_binary(data) ->
              data

            is_map(data) ->
              data["body"] || data["message"] || data["response"] || data["content"] ||
                data["text"] || data["output"] || data["summary"]

            true ->
              nil
          end

        is_map(data) and
          (Map.has_key?(data, "final_message") or Map.has_key?(data, "message") or
             Map.has_key?(data, "response")) and
            event_type not in [
              "thinking",
              "step",
              "tool_call",
              "question",
              "subagent",
              "subagents",
              "process",
              "processes"
            ] ->
          data["final_message"] || data["message"] || data["response"] || data["body"]

        true ->
          nil
      end

    if is_binary(msg_body) and String.trim(msg_body) != "" do
      trimmed = String.trim(msg_body)
      last_msg = Chat.get_last_message(conv.id)

      unless last_msg && last_msg.role == "bot" && String.trim(last_msg.body || "") == trimmed do
        Chat.create_message(%{
          conversation_id: conv.id,
          role: "bot",
          content_type: "text",
          body: trimmed,
          metadata: if(is_map(data), do: data, else: %{})
        })
      end
    end
  end

  defp merge_subagent_metadata(_meta, %{"subagents" => list}) when is_list(list), do: list
  defp merge_subagent_metadata(_meta, list) when is_list(list), do: list

  defp merge_subagent_metadata(meta, %{} = subagent_data) do
    existing = List.wrap(meta["subagents"])
    key = subagent_data["session_id"] || subagent_data["id"] || subagent_data["conversation_id"]

    if key do
      matched? =
        Enum.any?(existing, fn item ->
          is_map(item) and
            (item["session_id"] == key or item["id"] == key or item["conversation_id"] == key)
        end)

      if matched? do
        Enum.map(existing, fn item ->
          if is_map(item) and
               (item["session_id"] == key or item["id"] == key or item["conversation_id"] == key) do
            Map.merge(item, subagent_data)
          else
            item
          end
        end)
      else
        existing ++ [subagent_data]
      end
    else
      existing ++ [subagent_data]
    end
  end

  defp merge_subagent_metadata(meta, _), do: List.wrap(meta["subagents"])

  defp merge_process_metadata(_meta, %{"processes" => list}) when is_list(list), do: list
  defp merge_process_metadata(_meta, list) when is_list(list), do: list

  defp merge_process_metadata(meta, %{} = proc_data) do
    existing = List.wrap(meta["processes"])
    key = proc_data["id"] || proc_data["pid"]

    if key do
      matched? =
        Enum.any?(existing, fn item ->
          is_map(item) and (item["id"] == key or item["pid"] == key)
        end)

      if matched? do
        Enum.map(existing, fn item ->
          if is_map(item) and (item["id"] == key or item["pid"] == key) do
            Map.merge(item, proc_data)
          else
            item
          end
        end)
      else
        Enum.take(existing ++ [proc_data], -30)
      end
    else
      Enum.take(existing ++ [proc_data], -30)
    end
  end

  defp merge_process_metadata(meta, _), do: List.wrap(meta["processes"])

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
