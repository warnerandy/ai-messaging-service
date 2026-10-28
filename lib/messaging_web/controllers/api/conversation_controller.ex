defmodule MessagingWeb.API.ConversationController do
  use MessagingWeb, :controller

  alias Messaging.{Chat, Bots}

  def index(conn, params) do
    user = conn.assigns.current_user
    include_archived = params["include_archived"] in ["true", true, "1"]
    conversations = Chat.list_conversations(user.id, include_archived: include_archived)

    json(conn, %{
      conversations:
        Enum.map(conversations, fn c ->
          %{
            id: c.id,
            title: c.title,
            external_session_id: c.external_session_id,
            status: c.status,
            metadata: c.metadata,
            parent_session_id:
              c.metadata &&
                (c.metadata["parent_session_id"] || c.metadata["parentSessionId"] ||
                   c.metadata["parent_id"] || c.metadata["parentId"]),
            bot_token_id: c.bot_token_id,
            bot_name: c.bot_token.name,
            bot_type: c.bot_token.bot_type,
            bot_connected: c.bot_token.is_connected,
            last_user_input_time: c.last_user_input_time,
            last_modified_time: c.last_modified_time,
            last_message_at: c.last_message_at,
            inserted_at: c.inserted_at,
            updated_at: c.updated_at
          }
        end)
    })
  end

  def create(conn, %{"bot_token_id" => bot_token_id} = params) do
    user = conn.assigns.current_user

    bot_token = Bots.get_bot_token!(bot_token_id, user.id)

    raw_meta = params["metadata"] || %{}
    parent_id = params["parent_session_id"] || params["parentSessionId"]

    meta =
      if parent_id do
        Map.put(raw_meta, "parent_session_id", parent_id)
      else
        raw_meta
      end

    case Chat.create_conversation(%{
           user_id: user.id,
           bot_token_id: bot_token.id,
           title: params["title"] || bot_token.name,
           external_session_id: params["external_session_id"],
           status: params["status"] || "idle",
           metadata: meta
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
          parent_session_id:
            conversation.metadata &&
              (conversation.metadata["parent_session_id"] ||
                 conversation.metadata["parentSessionId"] ||
                 conversation.metadata["parent_id"] || conversation.metadata["parentId"]),
          bot_token_id: conversation.bot_token_id,
          last_user_input_time: conversation.last_user_input_time,
          last_modified_time: conversation.last_modified_time,
          last_message_at: conversation.last_message_at,
          inserted_at: conversation.inserted_at,
          updated_at: conversation.updated_at
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
        parent_session_id:
          conversation.metadata &&
            (conversation.metadata["parent_session_id"] ||
               conversation.metadata["parentSessionId"] ||
               conversation.metadata["parent_id"] || conversation.metadata["parentId"]),
        bot_token_id: conversation.bot_token_id,
        bot_name: conversation.bot_token.name,
        bot_type: conversation.bot_token.bot_type,
        bot_connected: conversation.bot_token.is_connected,
        last_user_input_time: conversation.last_user_input_time,
        last_modified_time: conversation.last_modified_time,
        last_message_at: conversation.last_message_at,
        inserted_at: conversation.inserted_at,
        updated_at: conversation.updated_at
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

  def archive(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Chat.archive_conversation(id, user.id) do
      {:ok, conv} ->
        json(conn, %{id: conv.id, status: conv.status})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
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
