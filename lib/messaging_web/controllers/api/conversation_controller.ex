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
            bot_token_id: c.bot_token_id,
            bot_name: c.bot_token.name,
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
           title: params["title"] || "New conversation"
         }) do
      {:ok, conversation} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: conversation.id,
          title: conversation.title,
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
    messages = Chat.list_messages(conversation.id)

    json(conn, %{
      conversation: %{
        id: conversation.id,
        title: conversation.title,
        bot_token_id: conversation.bot_token_id
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
end
