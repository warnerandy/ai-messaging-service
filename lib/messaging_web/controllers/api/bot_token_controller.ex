defmodule MessagingWeb.API.BotTokenController do
  use MessagingWeb, :controller

  alias Messaging.Bots

  def index(conn, _params) do
    user = conn.assigns.current_user
    bot_tokens = Bots.list_bot_tokens(user.id)

    json(conn, %{
      bot_tokens:
        Enum.map(bot_tokens, fn t ->
          %{
            id: t.id,
            name: t.name,
            is_connected: t.is_connected,
            is_working: t.is_working,
            last_connected_at: t.last_connected_at,
            inserted_at: t.inserted_at
          }
        end)
    })
  end

  def create(conn, %{"name" => name}) do
    user = conn.assigns.current_user

    case Bots.create_bot_token(%{name: name, user_id: user.id}) do
      {:ok, bot_token} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: bot_token.id,
          name: bot_token.name,
          token: bot_token.token
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def channel(conn, %{"bot_token_id" => id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(id)

    if bot_token.user_id == user.id do
      json(conn, %{
        bot_token_id: bot_token.id,
        channel_code: bot_token.channel_code
      })
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Not your token"})
    end
  end

  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(id)

    if bot_token.user_id == user.id do
      {:ok, _} = Bots.revoke_bot_token(bot_token)
      json(conn, %{ok: true})
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Not your token"})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
