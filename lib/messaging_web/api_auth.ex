defmodule MessagingWeb.ApiAuth do
  @moduledoc """
  Plug that authenticates user API requests via Bearer token (session token).
  """

  import Plug.Conn
  alias Messaging.Accounts

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         raw_token <- Base.url_decode64!(token, padding: false),
         {user, _inserted_at} <- Accounts.get_user_by_session_token(raw_token) do
      assign(conn, :current_user, user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{error: "Invalid or missing user token"})
        |> halt()
    end
  end
end
