defmodule MessagingWeb.BotAPI.MessageController do
  use MessagingWeb, :controller

  alias Messaging.Chat

  # POST /api/bot/messages - Bot sends a message
  def create(conn, params) do
    bot_token = conn.assigns.bot_token

    attrs = %{
      role: "bot",
      content_type: params["content_type"] || "text",
      body: params["body"],
      metadata: params["metadata"] || %{},
      conversation_id: params["conversation_id"]
    }

    # Verify the conversation belongs to this bot
    conversation = Chat.get_conversation!(attrs.conversation_id)

    if conversation.bot_token_id == bot_token.id do
      case Chat.create_message(attrs) do
        {:ok, message} ->
          conn
          |> put_status(:created)
          |> json(%{
            id: message.id,
            conversation_id: message.conversation_id,
            content_type: message.content_type,
            body: message.body,
            metadata: message.metadata,
            model: message.model,
            inserted_at: message.inserted_at
          })

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Conversation does not belong to this bot"})
    end
  end

  # GET /api/bot/messages - Get pending user messages for the bot
  def index(conn, params) do
    bot_token = conn.assigns.bot_token

    opts =
      if params["since"] do
        case DateTime.from_iso8601(params["since"]) do
          {:ok, since, _} -> [since: since]
          _ -> []
        end
      else
        []
      end

    messages = Chat.get_pending_messages_for_bot(bot_token.id, opts)

    json(conn, %{
      messages:
        Enum.map(messages, fn %{message: m, conversation_id: cid} ->
          %{
            id: m.id,
            conversation_id: cid,
            content_type: m.content_type,
            body: m.body,
            metadata: m.metadata,
            model: m.model,
            inserted_at: m.inserted_at
          }
        end)
    })
  end

  # PUT /api/bot/messages/:id/acknowledge - Bot acknowledges receipt of a message
  def acknowledge(conn, %{"id" => id, "conversation_id" => conversation_id}) do
    bot_token = conn.assigns.bot_token
    message_id = String.to_integer(id)
    conv_id = String.to_integer(conversation_id)
    conversation = Chat.get_conversation!(conv_id)

    if conversation.bot_token_id == bot_token.id do
      Chat.acknowledge_message(message_id, conv_id)
      json(conn, %{acknowledged: true, message_id: message_id})
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Conversation does not belong to this bot"})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
