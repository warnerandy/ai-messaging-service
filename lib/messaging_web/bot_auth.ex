defmodule MessagingWeb.BotAuth do
  @moduledoc """
  Plug that authenticates bot API requests via Bearer token.
  """

  import Plug.Conn
  alias Messaging.Bots

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, bot_token} <- Bots.authenticate_bot_token(token) do
      conn
      |> assign(:bot_token, bot_token)
      |> assign(:current_user, bot_token.user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{error: "Invalid or missing bot token"})
        |> halt()
    end
  end
end
