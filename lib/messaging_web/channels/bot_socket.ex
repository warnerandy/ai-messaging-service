defmodule MessagingWeb.BotSocket do
  use Phoenix.Socket
  require Logger

  alias Messaging.Bots

  channel "bot:*", MessagingWeb.BotChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Bots.authenticate_bot_token(token) do
      {:ok, bot_token} ->
        Bots.mark_connected(bot_token)

        Logger.info(
          "[BotSocket] connected bot_token_id=#{bot_token.id} name=\"#{bot_token.name}\""
        )

        socket =
          socket
          |> assign(:bot_token, bot_token)
          |> assign(:user_id, bot_token.user_id)

        {:ok, socket}

      {:error, _} ->
        Logger.warning("[BotSocket] rejected connection - invalid token")
        :error
    end
  end

  def connect(_params, _socket, _connect_info) do
    Logger.warning("[BotSocket] rejected connection - missing token param")
    :error
  end

  @impl true
  def id(socket), do: "bot_socket:#{socket.assigns.bot_token.id}"
end
