defmodule MessagingWeb.BotAPI.StatusController do
  use MessagingWeb, :controller

  alias Messaging.Bots

  # PUT /api/bot/status - Bot updates its working status
  def update(conn, %{"is_working" => is_working}) do
    bot_token = conn.assigns.bot_token

    case Bots.update_bot_status(bot_token, %{is_working: is_working}) do
      {:ok, updated} ->
        json(conn, %{
          is_connected: updated.is_connected,
          is_working: updated.is_working
        })

      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Failed to update status"})
    end
  end
end
