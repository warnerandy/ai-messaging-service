defmodule MessagingWeb.API.AssetController do
  use MessagingWeb, :controller

  alias Messaging.Chat

  def upload(conn, %{"file" => file, "conversation_id" => conversation_id}) do
    user = conn.assigns.current_user
    conversation = Chat.get_conversation!(conversation_id)

    if conversation.user_id != user.id do
      conn |> put_status(:forbidden) |> json(%{error: "Not your conversation"})
    else
      case handle_file_upload(file, conversation_id) do
        {:ok, url, content_type} ->
          conn
          |> put_status(:created)
          |> json(%{
            url: url,
            content_type: content_type,
            filename: file.filename
          })

        {:error, reason} ->
          conn
          |> put_status(:bad_request)
          |> json(%{error: reason})
      end
    end
  end

  defp handle_file_upload(file, conversation_id) do
    # Validate file exists
    if file.path && File.exists?(file.path) do
      # Determine content type
      content_type = MIME.type(file.filename)

      # Validate allowed types
      if is_allowed_type?(content_type) do
        # Create unique filename
        ext = Path.extname(file.filename)
        base_name = Path.basename(file.filename, ext)
        timestamp = System.os_time(:millisecond)
        unique_name = "#{base_name}-#{timestamp}#{ext}"
        filename = "#{conversation_id}/#{unique_name}"
        upload_dir = Application.app_dir(:messaging, "priv/static/uploads")
        conv_dir = Path.join(upload_dir, to_string(conversation_id))

        # Create directory if it doesn't exist
        File.mkdir_p!(conv_dir)

        dest_path = Path.join(conv_dir, unique_name)

        # Copy file to upload directory
        case File.cp(file.path, dest_path) do
          :ok ->
            url = "/uploads/#{filename}"
            {:ok, url, content_type}

          {:error, reason} ->
            {:error, "Failed to save file: #{inspect(reason)}"}
        end
      else
        {:error, "File type not allowed"}
      end
    else
      {:error, "File not found"}
    end
  end

  defp is_allowed_type?(content_type) do
    allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "text/plain",
      "text/csv"
    ]

    Enum.any?(allowed, fn allowed_type ->
      String.starts_with?(content_type, allowed_type)
    end)
  end
end
