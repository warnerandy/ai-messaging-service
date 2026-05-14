defmodule MessagingWeb.UserSocket do
  use Phoenix.Socket

  alias Messaging.Accounts

  channel "conversation:*", MessagingWeb.ConversationChannel

  @impl true
  def connect(%{"token" => encoded_token}, socket, _connect_info) do
    with {:ok, raw_token} <- Base.url_decode64(encoded_token, padding: false),
         {user, _inserted_at} <- Accounts.get_user_by_session_token(raw_token) do
      {:ok, assign(socket, :current_user, user)}
    else
      _ -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(%{assigns: %{current_user: user}}), do: "user_socket:#{user.id}"
end
