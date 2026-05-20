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
      is_suggestion: params["is_suggestion"] || false,
      conversation_id: params["conversation_id"]
    }

    conversation = Chat.get_conversation!(attrs.conversation_id, bot_token_id: bot_token.id)

    case Chat.create_message(%{attrs | conversation_id: conversation.id}) do
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
          is_suggestion: message.is_suggestion,
          inserted_at: message.inserted_at
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  rescue
    Ecto.NoResultsError ->
      conn
      |> put_status(:not_found)
      |> json(%{error: "Not found"})
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
            acknowledged: m.acknowledged,
            acknowledged_at: m.acknowledged_at,
            is_suggestion: m.is_suggestion,
            inserted_at: m.inserted_at
          }
        end)
    })
  end

  # PUT /api/bot/messages/:id/acknowledge - Bot acknowledges receipt of a message
  def acknowledge(conn, %{"id" => id, "conversation_id" => conversation_id}) do
    bot_token = conn.assigns.bot_token

    with {:ok, message_id} <- parse_integer_param(id),
         {:ok, conv_id} <- parse_integer_param(conversation_id) do
      _conversation = Chat.get_conversation!(conv_id, bot_token_id: bot_token.id)
      Chat.acknowledge_message(message_id, conv_id)
      json(conn, %{acknowledged: true, message_id: message_id})
    else
      :error ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Invalid message or conversation id"})
    end
  rescue
    Ecto.NoResultsError ->
      conn
      |> put_status(:not_found)
      |> json(%{error: "Not found"})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  defp parse_integer_param(value) when is_integer(value), do: {:ok, value}

  defp parse_integer_param(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> {:ok, parsed}
      _ -> :error
    end
  end

  defp parse_integer_param(_value), do: :error
end
