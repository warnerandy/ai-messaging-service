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

      {:ok,
       %{
         conversation_id: conversation.id,
         status: conversation.status,
         metadata: conversation.metadata,
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

  # User answers an agent question or approval request
  @impl true
  def handle_in("answer_question", payload, socket) do
    bot_token_id = socket.assigns[:bot_token_id]
    conv_id = socket.assigns.conversation_id

    if bot_token_id do
      forward_payload =
        payload
        |> Map.put("conversation_id", conv_id)

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

    case Chat.queue_prompt(conv_id, payload) do
      {:ok, item, queue} ->
        {:reply, {:ok, %{prompt: item, queue: queue}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # User removes a prompt from the queue
  @impl true
  def handle_in("remove_queued_prompt", %{"prompt_id" => prompt_id}, socket) do
    conv_id = socket.assigns.conversation_id

    case Chat.remove_queued_prompt(conv_id, prompt_id) do
      {:ok, queue} ->
        {:reply, {:ok, %{queue: queue}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end
end
