defmodule MessagingWeb.UploadController do
  @moduledoc """
  Serves uploaded files after verifying a signed token.

  Upload URLs include a `token` query parameter generated via Phoenix.Token.
  This ensures files cannot be accessed without a valid, time-limited signature.
  """

  use MessagingWeb, :controller

  @token_salt "upload_access"
  @max_age 86_400 * 7

  @doc """
  Generates a signed URL for an uploaded file.
  """
  def signed_url(conversation_id, filename) do
    path = "/uploads/#{conversation_id}/#{filename}"
    token = Phoenix.Token.sign(MessagingWeb.Endpoint, @token_salt, {conversation_id, filename})
    "#{path}?token=#{token}"
  end

  def show(conn, %{"conversation_id" => conversation_id, "filename" => filename_parts} = params) do
    filename = Enum.join(filename_parts, "/")
    token = params["token"]

    with {:ok, {^conversation_id, ^filename}} <-
           verify_token(token, conversation_id, filename) do
      serve_file(conn, conversation_id, filename)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid or expired download token"})
    end
  end

  defp verify_token(nil, _conversation_id, _filename), do: :error

  defp verify_token(token, conversation_id, filename) do
    case Phoenix.Token.verify(MessagingWeb.Endpoint, @token_salt, token, max_age: @max_age) do
      {:ok, {conv_id, fname}} ->
        conv_id_str = to_string(conv_id)

        if conv_id_str == to_string(conversation_id) && fname == filename do
          {:ok, {conversation_id, filename}}
        else
          :error
        end

      _ ->
        :error
    end
  end

  defp serve_file(conn, conversation_id, filename) do
    upload_dir = Application.app_dir(:messaging, "priv/static/uploads")
    file_path = Path.join([upload_dir, to_string(conversation_id), filename])

    # Prevent path traversal
    safe_base = Path.expand(upload_dir)
    expanded = Path.expand(file_path)

    if String.starts_with?(expanded, safe_base) && File.exists?(file_path) do
      content_type = MIME.from_path(file_path)

      conn
      |> put_resp_content_type(content_type)
      |> send_file(200, file_path)
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "File not found"})
    end
  end
end
