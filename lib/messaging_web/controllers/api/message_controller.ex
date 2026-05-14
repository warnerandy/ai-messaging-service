defmodule MessagingWeb.API.MessageController do
  use MessagingWeb, :controller

  alias Messaging.Chat

  def create(conn, %{"conversation_id" => conversation_id} = params) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(conversation_id)

    if conversation.user_id != user.id do
      conn |> put_status(:forbidden) |> json(%{error: "Not your conversation"})
    else
      case Chat.create_message(%{
             role: "user",
             content_type: "text",
             body: params["body"],
             model: params["model"],
             conversation_id: conversation_id
           }) do
        {:ok, message} ->
          conn
          |> put_status(:created)
          |> json(%{
            id: message.id,
            conversation_id: message.conversation_id,
            role: message.role,
            content_type: message.content_type,
            body: message.body,
            model: message.model,
            inserted_at: message.inserted_at
          })

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
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
