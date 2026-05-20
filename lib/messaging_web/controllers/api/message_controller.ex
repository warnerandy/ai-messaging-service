defmodule MessagingWeb.API.MessageController do
  use MessagingWeb, :controller

  alias Messaging.Chat

  def create(conn, %{"conversation_id" => conversation_id} = params) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(conversation_id, user_id: user.id)

    # Determine content type and body/metadata
    {content_type, body, metadata} =
      cond do
        params["asset_url"] ->
          # User is sending an asset
          content_type = params["asset_type"] || "image"
          metadata = %{"url" => params["asset_url"], "filename" => params["asset_filename"]}
          {content_type, nil, metadata}

        params["body"] ->
          # User is sending text
          {"text", params["body"], %{}}

        true ->
          {"text", nil, %{}}
      end

    case Chat.create_message(%{
           role: "user",
           content_type: content_type,
           body: body,
           metadata: metadata,
           model: params["model"],
           conversation_id: conversation.id
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
          metadata: message.metadata,
          model: message.model,
          inserted_at: message.inserted_at
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

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
