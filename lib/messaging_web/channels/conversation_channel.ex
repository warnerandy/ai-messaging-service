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

      {:ok, %{conversation_id: conversation.id},
       assign(socket, :conversation_id, conversation.id)}
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
        acknowledged: message.acknowledged,
        is_suggestion: message.is_suggestion,
        inserted_at: message.inserted_at
      }
    })

    {:noreply, socket}
  end
end
