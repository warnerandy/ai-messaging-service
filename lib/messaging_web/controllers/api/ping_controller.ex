defmodule MessagingWeb.API.PingController do
  use MessagingWeb, :controller

  def show(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
