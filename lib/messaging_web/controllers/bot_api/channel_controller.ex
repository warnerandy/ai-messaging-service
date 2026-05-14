defmodule MessagingWeb.BotAPI.ChannelController do
  use MessagingWeb, :controller

  # GET /api/bot/channel - Bot retrieves its own WebSocket channel code
  def show(conn, _params) do
    bot_token = conn.assigns.bot_token
    json(conn, %{channel_code: bot_token.channel_code})
  end
end
