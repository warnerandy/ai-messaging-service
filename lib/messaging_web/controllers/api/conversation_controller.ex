defmodule MessagingWeb.API.ConversationController do
  use MessagingWeb, :controller

  alias Messaging.{Chat, Bots}

  def index(conn, _params) do
    user = conn.assigns.current_user
    conversations = Chat.list_conversations(user.id)

    json(conn, %{
      conversations:
        Enum.map(conversations, fn c ->
          %{
            id: c.id,
            title: c.title,
            external_session_id: c.external_session_id,
            status: c.status,
            metadata: c.metadata,
            bot_token_id: c.bot_token_id,
            bot_name: c.bot_token.name,
            bot_type: c.bot_token.bot_type,
            bot_connected: c.bot_token.is_connected,
            inserted_at: c.inserted_at,
            updated_at: c.updated_at
          }
        end)
    })
  end

  def create(conn, %{"bot_token_id" => bot_token_id} = params) do
    user = conn.assigns.current_user

    bot_token = Bots.get_bot_token!(bot_token_id, user.id)

    case Chat.create_conversation(%{
           user_id: user.id,
           bot_token_id: bot_token.id,
           title: params["title"] || bot_token.name,
           external_session_id: params["external_session_id"],
           status: params["status"] || "idle",
           metadata: params["metadata"] || %{}
         }) do
      {:ok, conversation} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: conversation.id,
          title: conversation.title,
          external_session_id: conversation.external_session_id,
          status: conversation.status,
          metadata: conversation.metadata,
          bot_token_id: conversation.bot_token_id
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  rescue
    Ecto.NoResultsError ->
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(id, user_id: user.id)
    after_id = parse_positive_integer(conn.params["after_id"])
    limit = parse_positive_integer(conn.params["limit"])
    messages = Chat.list_messages(conversation.id, after_id: after_id, limit: limit)

    json(conn, %{
      conversation: %{
        id: conversation.id,
        title: conversation.title,
        external_session_id: conversation.external_session_id,
        status: conversation.status,
        metadata: conversation.metadata,
        bot_token_id: conversation.bot_token_id,
        bot_name: conversation.bot_token.name,
        bot_type: conversation.bot_token.bot_type,
        bot_connected: conversation.bot_token.is_connected
      },
      messages:
        Enum.map(messages, fn m ->
          %{
            id: m.id,
            role: m.role,
            content_type: m.content_type,
            body: m.body,
            metadata: m.metadata,
            model: m.model,
            context_size: m.context_size,
            acknowledged: m.acknowledged,
            acknowledged_at: m.acknowledged_at,
            is_suggestion: m.is_suggestion,
            inserted_at: m.inserted_at
          }
        end)
    })
  rescue
    Ecto.NoResultsError ->
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
  end

  def channel(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(id, user_id: user.id)
    json(conn, %{conversation_id: conversation.id, topic: "conversation:#{conversation.id}"})
  rescue
    Ecto.NoResultsError ->
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  defp parse_positive_integer(nil), do: nil

  defp parse_positive_integer(value) when is_integer(value) and value > 0, do: value

  defp parse_positive_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed > 0 -> parsed
      _ -> nil
    end
  end

  defp parse_positive_integer(_), do: nil
end
