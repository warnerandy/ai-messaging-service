defmodule Messaging.Bots.BotToken do
  use Ecto.Schema
  import Ecto.Changeset

  schema "bot_tokens" do
    field :name, :string
    field :token_hash, :string
    # only set on creation
    field :token, :string, virtual: true
    field :channel_code, :string
    field :last_connected_at, :utc_datetime
    field :is_connected, :boolean, default: false
    field :is_working, :boolean, default: false
    field :revoked_at, :utc_datetime

    belongs_to :user, Messaging.Accounts.User
    has_many :conversations, Messaging.Chat.Conversation
    has_many :bot_models, Messaging.Bots.BotModel

    timestamps(type: :utc_datetime)
  end

  def create_changeset(bot_token, attrs) do
    bot_token
    |> cast(attrs, [:name, :user_id])
    |> validate_required([:name, :user_id])
    |> validate_length(:name, min: 1, max: 100)
    |> put_token()
  end

  defp put_token(changeset) do
    token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
    hash = :crypto.hash(:sha256, token) |> Base.encode16(case: :lower)
    channel_code = :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)

    changeset
    |> put_change(:token, token)
    |> put_change(:token_hash, hash)
    |> put_change(:channel_code, channel_code)
  end

  def revoke_changeset(bot_token) do
    bot_token
    |> change(%{revoked_at: DateTime.utc_now() |> DateTime.truncate(:second)})
  end

  def status_changeset(bot_token, attrs) do
    bot_token
    |> cast(attrs, [:is_connected, :is_working, :last_connected_at])
  end

  @doc """
  Hash a raw token for lookup.
  """
  def hash_token(token) do
    :crypto.hash(:sha256, token) |> Base.encode16(case: :lower)
  end
end
