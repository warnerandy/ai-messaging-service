defmodule Messaging.Bots do
  @moduledoc """
  Context for managing bot tokens.
  """

  import Ecto.Query
  alias Messaging.Repo
  alias Messaging.Bots.{BotToken, BotModel}

  def list_bot_tokens(user_id) do
    BotToken
    |> where(user_id: ^user_id)
    |> where([b], is_nil(b.revoked_at))
    |> order_by(desc: :inserted_at)
    |> Repo.all()
  end

  def get_bot_token!(id, user_id) do
    bot_token_id = normalize_bot_token_id!(id)
    owner_id = normalize_bot_token_id!(user_id)

    BotToken
    |> where([b], b.id == ^bot_token_id and b.user_id == ^owner_id)
    |> where([b], is_nil(b.revoked_at))
    |> Repo.one!()
  end

  def get_bot_token_by_hash(token_hash) do
    BotToken
    |> where(token_hash: ^token_hash)
    |> where([b], is_nil(b.revoked_at))
    |> Repo.one()
  end

  def authenticate_bot_token(raw_token) do
    hash = BotToken.hash_token(raw_token)

    case get_bot_token_by_hash(hash) do
      nil -> {:error, :invalid_token}
      bot_token -> {:ok, Repo.preload(bot_token, :user)}
    end
  end

  def create_bot_token(attrs) do
    %BotToken{}
    |> BotToken.create_changeset(attrs)
    |> Repo.insert()
  end

  def revoke_bot_token(%BotToken{} = bot_token) do
    bot_token
    |> BotToken.revoke_changeset()
    |> Repo.update()
  end

  def update_bot_status(%BotToken{} = bot_token, attrs) do
    bot_token
    |> BotToken.status_changeset(attrs)
    |> Repo.update()
    |> tap(fn
      {:ok, updated} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_status:#{updated.user_id}",
          {:bot_status_changed, updated}
        )

      _ ->
        :ok
    end)
  end

  def mark_connected(%BotToken{} = bot_token) do
    update_bot_status(bot_token, %{
      is_connected: true,
      last_connected_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })
  end

  def mark_disconnected(%BotToken{} = bot_token) do
    update_bot_status(bot_token, %{is_connected: false, is_working: false})
  end

  # --- Bot Models ---

  def list_bot_models(bot_token_id) do
    BotModel
    |> where(bot_token_id: ^bot_token_id)
    |> order_by(:name)
    |> Repo.all()
  end

  @doc """
  Replace all models for a bot with the given list.
  Deletes existing models and inserts the new set.
  """
  def set_bot_models(%BotToken{} = bot_token, models) when is_list(models) do
    Repo.transaction(fn ->
      # Delete existing models
      BotModel
      |> where(bot_token_id: ^bot_token.id)
      |> Repo.delete_all()

      # Insert new models
      Enum.map(models, fn model_attrs ->
        attrs = Map.put(model_attrs, :bot_token_id, bot_token.id)

        %BotModel{}
        |> BotModel.changeset(attrs)
        |> Repo.insert!()
      end)
    end)
  end

  @doc """
  Broadcast a request to a specific bot to refresh its models.
  The bot receives this via its channel.
  """
  def request_model_refresh(%BotToken{} = bot_token) do
    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "bot:#{bot_token.id}",
      :refresh_models
    )
  end

  @doc """
  Broadcast a request to all of a user's bots to refresh models.
  """
  def request_all_models_refresh(user_id) do
    list_bot_tokens(user_id)
    |> Enum.each(&request_model_refresh/1)
  end

  defp normalize_bot_token_id!(id) when is_integer(id), do: id

  defp normalize_bot_token_id!(id) when is_binary(id) do
    case Integer.parse(id) do
      {parsed, ""} -> parsed
      _ -> raise Ecto.NoResultsError, queryable: BotToken
    end
  end
end
