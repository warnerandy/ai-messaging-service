defmodule MessagingWeb.AppController do
  use Phoenix.Controller, formats: [:html]
  import Plug.Conn

  def index(conn, _params) do
    index_path = Application.app_dir(:messaging, "priv/static/index.html")

    case File.read(index_path) do
      {:ok, content} ->
        conn
        |> put_resp_content_type("text/html")
        |> send_resp(200, content)

      {:error, reason} ->
        conn
        |> put_status(500)
        |> put_resp_content_type("text/plain")
        |> send_resp(500, "Failed to read index.html: #{inspect(reason)}")
    end
  end
end
