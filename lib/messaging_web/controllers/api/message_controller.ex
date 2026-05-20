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
           is_suggestion: params["is_suggestion"] || false,
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
          acknowledged: message.acknowledged,
          acknowledged_at: message.acknowledged_at,
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
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
  end

  def timeout(conn, %{"conversation_id" => conversation_id, "message_id" => message_id}) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(conversation_id, user_id: user.id)

    with {:ok, parsed_message_id} <- parse_positive_integer(message_id) do
      case Chat.create_bot_timeout_message(conversation.id, parsed_message_id) do
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
            acknowledged: message.acknowledged,
            acknowledged_at: message.acknowledged_at,
            is_suggestion: message.is_suggestion,
            inserted_at: message.inserted_at
          })

        {:error, :already_responded} ->
          conn
          |> put_status(:conflict)
          |> json(%{error: "Bot has already responded"})

        {:error, :already_reported} ->
          conn
          |> put_status(:conflict)
          |> json(%{error: "Timeout already reported"})

        {:error, :not_eligible} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "Message is not eligible for timeout"})

        {:error, {:invalid, changeset}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      :error ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Invalid message id"})
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

  defp parse_positive_integer(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_positive_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp parse_positive_integer(_), do: :error
end
