defmodule MessagingWeb.ConversationChannel do
  use MessagingWeb, :channel

  alias Messaging.Chat

  @impl true
  def join("conversation:" <> id, _payload, socket) do
    user = socket.assigns.current_user

    with {conversation_id, ""} <- Integer.parse(id) do
      conversation = Chat.get_conversation!(conversation_id, user_id: user.id)
      topic = "conversation:#{conversation.id}"
      Phoenix.PubSub.subscribe(Messaging.PubSub, topic)

      if conversation.bot_token_id do
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{conversation.bot_token_id}",
          {:request_session_sync,
           %{
             "conversation_id" => conversation.id,
             "session_id" => conversation.external_session_id,
             "external_session_id" => conversation.external_session_id,
             "metadata" => conversation.metadata,
             "title" => conversation.title,
             "requested_at" => DateTime.utc_now() |> DateTime.to_iso8601()
           }}
        )
      end

      {:ok,
       %{
         conversation_id: conversation.id,
         status: conversation.status,
         metadata: conversation.metadata,
         bot_metadata: conversation.bot_token && conversation.bot_token.metadata,
         external_session_id: conversation.external_session_id
       },
       socket
       |> assign(:conversation_id, conversation.id)
       |> assign(:bot_token_id, conversation.bot_token_id)}
    else
      _ ->
        {:error, %{reason: "invalid_conversation_id"}}
    end
  rescue
    Ecto.NoResultsError ->
      {:error, %{reason: "not_found"}}
  end

  @impl true
  def handle_info({:message_acknowledged, message_id}, socket) do
    push(socket, "message_acknowledged", %{message_id: message_id})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:new_message, message}, socket) do
    push(socket, "new_message", %{
      message: %{
        id: message.id,
        conversation_id: message.conversation_id,
        role: message.role,
        content_type: message.content_type,
        body: message.body,
        metadata: message.metadata,
        model: message.model,
        context_size: message.context_size,
        acknowledged: message.acknowledged,
        acknowledged_at: message.acknowledged_at,
        is_suggestion: message.is_suggestion,
        inserted_at: message.inserted_at
      }
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:session_status_changed, conv_id, status, metadata}, socket) do
    push(socket, "session_status_changed", %{
      conversation_id: conv_id || socket.assigns[:conversation_id],
      status: status,
      metadata: metadata
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:ahp_event, _conv_id, event_type, data}, socket) do
    push(socket, "ahp_event", %{
      event_type: event_type,
      data: data
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:prompt_queue_updated, _conv_id, queue}, socket) do
    push(socket, "prompt_queue_updated", %{
      prompt_queue: queue
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info({:session_config_changed, payload}, socket) do
    push(socket, "session_config_changed", payload)
    {:noreply, socket}
  end

  # User answers an agent question or approval request
  @impl true
  def handle_in("answer_question", payload, socket) do
    bot_token_id = socket.assigns[:bot_token_id]
    conv_id = socket.assigns.conversation_id

    if bot_token_id do
      forward_payload =
        payload
        |> Map.put("conversation_id", conv_id)
        |> normalize_answer_payload()

      Phoenix.PubSub.broadcast(
        Messaging.PubSub,
        "bot:#{bot_token_id}",
        {:answer_question, forward_payload}
      )
    end

    {:reply, :ok, socket}
  end

  # User sends a steering or interruption command to the agent
  @impl true
  def handle_in("steer", payload, socket) do
    bot_token_id = socket.assigns[:bot_token_id]
    conv_id = socket.assigns.conversation_id

    if bot_token_id do
      forward_payload =
        payload
        |> Map.put("conversation_id", conv_id)

      Phoenix.PubSub.broadcast(
        Messaging.PubSub,
        "bot:#{bot_token_id}",
        {:steer_agent, forward_payload}
      )
    end

    {:reply, :ok, socket}
  end

  # User queues a prompt while agent is busy
  @impl true
  def handle_in("queue_prompt", payload, socket) do
    conv_id = socket.assigns.conversation_id
    {:ok, item, queue} = Chat.queue_prompt(conv_id, payload)
    {:reply, {:ok, %{prompt: item, queue: queue}}, socket}
  end

  # User removes a prompt from the queue
  @impl true
  def handle_in("remove_queued_prompt", %{"prompt_id" => prompt_id}, socket) do
    conv_id = socket.assigns.conversation_id
    {:ok, queue} = Chat.remove_queued_prompt(conv_id, prompt_id)
    {:reply, {:ok, %{queue: queue}}, socket}
  end

  # User updates session configuration (agent mode, worktree, base branch, agent type)
  @impl true
  def handle_in("update_session_config", payload, socket) do
    conv_id = socket.assigns.conversation_id
    bot_token_id = socket.assigns[:bot_token_id]

    config_meta =
      if is_map(payload) do
        payload
        |> Map.take([
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
          "roles",
          "metadata"
        ])
      else
        %{}
      end

    nested_meta = if is_map(config_meta["metadata"]), do: config_meta["metadata"], else: %{}
    merged_config = Map.merge(config_meta, nested_meta) |> Map.delete("metadata")

    raw_worktree =
      cond do
        not is_nil(merged_config["use_worktree"]) -> merged_config["use_worktree"]
        not is_nil(merged_config["useWorktree"]) -> merged_config["useWorktree"]
        true -> merged_config["worktree"]
      end

    raw_worktree_supported =
      cond do
        not is_nil(merged_config["worktree_supported"]) -> merged_config["worktree_supported"]
        not is_nil(merged_config["supports_worktree"]) -> merged_config["supports_worktree"]
        not is_nil(merged_config["allow_worktree"]) -> merged_config["allow_worktree"]
        true -> nil
      end

    canonical =
      %{}
      |> maybe_put_field(
        "agent_mode",
        merged_config["agent_mode"] || merged_config["agentMode"] || merged_config["mode"]
      )
      |> maybe_put_field(
        "modes",
        merged_config["modes"] || merged_config["agent_modes"] || merged_config["agentModes"] ||
          merged_config["supported_modes"]
      )
      |> maybe_put_field("use_worktree", normalize_bool(raw_worktree))
      |> maybe_put_field("worktree_supported", normalize_bool(raw_worktree_supported))
      |> maybe_put_field(
        "base_branch",
        merged_config["base_branch"] || merged_config["baseBranch"] || merged_config["branch"] ||
          merged_config["git_branch"]
      )
      |> maybe_put_field(
        "branches",
        merged_config["branches"] || merged_config["available_branches"] ||
          merged_config["base_branches"]
      )
      |> maybe_put_field("agent_type", merged_config["agent_type"] || merged_config["agentType"])
      |> maybe_put_field(
        "agent_types",
        merged_config["agent_types"] || merged_config["agentTypes"] || merged_config["roles"] ||
          merged_config["agent_roles"] || merged_config["agentRoles"]
      )
      |> maybe_put_field(
        "agent_roles",
        merged_config["agent_roles"] || merged_config["agentRoles"] || merged_config["roles"] ||
          merged_config["agent_types"] || merged_config["agentTypes"]
      )

    full_update = Map.merge(merged_config, canonical)

    case Chat.update_session_metadata(conv_id, full_update) do
      {:ok, updated_conv} ->
        if bot_token_id do
          Phoenix.PubSub.broadcast(
            Messaging.PubSub,
            "bot:#{bot_token_id}",
            {:session_config_changed,
             canonical
             |> Map.merge(%{
               "conversation_id" => conv_id,
               "session_id" => updated_conv.external_session_id,
               "external_session_id" => updated_conv.external_session_id,
               "config" => full_update,
               "metadata" => updated_conv.metadata
             })}
          )
        end

        {:reply, {:ok, %{metadata: updated_conv.metadata}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # User requests a sync of session messages (from both DB and bot)
  @impl true
  def handle_in("sync_session", _payload, socket) do
    bot_token_id = socket.assigns[:bot_token_id]
    conv_id = socket.assigns[:conversation_id]

    if bot_token_id && conv_id do
      conversation = Chat.get_conversation!(conv_id, [])

      Phoenix.PubSub.broadcast(
        Messaging.PubSub,
        "bot:#{bot_token_id}",
        {:request_session_sync,
         %{
           "conversation_id" => conv_id,
           "session_id" => conversation.external_session_id,
           "external_session_id" => conversation.external_session_id,
           "title" => conversation.title,
           "metadata" => conversation.metadata,
           "requested_at" => DateTime.utc_now() |> DateTime.to_iso8601()
         }}
      )
    end

    {:reply, :ok, socket}
  end

  defp normalize_answer_payload(%{"answer" => answer} = payload) when is_binary(answer) do
    case Jason.decode(answer) do
      {:ok, decoded} when is_map(decoded) or is_list(decoded) ->
        qid = payload["question_id"] || "0"

        payload
        |> Map.put("answer", decoded)
        |> Map.put_new("answers", if(is_map(decoded), do: decoded, else: %{qid => decoded}))
        |> Map.put_new(qid, decoded)

      _ ->
        payload
    end
  end

  defp normalize_answer_payload(payload), do: payload

  defp maybe_put_field(map, _key, nil), do: map
  defp maybe_put_field(map, key, val), do: Map.put(map, key, val)

  defp normalize_bool(nil), do: nil
  defp normalize_bool(val) when is_boolean(val), do: val
  defp normalize_bool("true"), do: true
  defp normalize_bool("false"), do: false
  defp normalize_bool(1), do: true
  defp normalize_bool(0), do: false
  defp normalize_bool(_), do: nil
end
