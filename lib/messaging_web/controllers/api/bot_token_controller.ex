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
            bot_type: t.bot_type,
            metadata: t.metadata,
            is_connected: t.is_connected,
            is_working: t.is_working,
            last_connected_at: t.last_connected_at,
            inserted_at: t.inserted_at
          }
        end)
    })
  end

  def create(conn, %{"name" => name} = params) do
    user = conn.assigns.current_user

    attrs = %{
      name: name,
      user_id: user.id,
      bot_type: params["bot_type"] || "chat",
      metadata: params["metadata"] || %{}
    }

    case Bots.create_bot_token(attrs) do
      {:ok, bot_token} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: bot_token.id,
          name: bot_token.name,
          token: bot_token.token,
          channel_code: bot_token.channel_code,
          bot_type: bot_token.bot_type,
          metadata: bot_token.metadata
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def regenerate(conn, %{"bot_token_id" => id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(id, user.id)

    case Bots.regenerate_bot_token(bot_token) do
      {:ok, updated} ->
        json(conn, %{
          id: updated.id,
          name: updated.name,
          token: updated.token,
          channel_code: updated.channel_code,
          bot_type: updated.bot_type
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  rescue
    Ecto.NoResultsError ->
      conn
      |> put_status(:not_found)
      |> json(%{error: "Not found"})
  end

  def channel(conn, %{"bot_token_id" => id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(id, user.id)

    json(conn, %{
      bot_token_id: bot_token.id,
      channel_code: bot_token.channel_code
    })
  rescue
    Ecto.NoResultsError ->
      conn
      |> put_status(:not_found)
      |> json(%{error: "Not found"})
  end

  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(id, user.id)
    {:ok, _} = Bots.revoke_bot_token(bot_token)
    json(conn, %{ok: true})
  rescue
    Ecto.NoResultsError ->
      conn
      |> put_status(:not_found)
      |> json(%{error: "Not found"})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
