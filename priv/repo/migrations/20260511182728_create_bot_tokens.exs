defmodule Messaging.Repo.Migrations.CreateBotTokens do
  use Ecto.Migration

  def change do
    create table(:bot_tokens) do
      add :name, :string, null: false
      add :token_hash, :string, null: false
      add :last_connected_at, :utc_datetime
      add :is_connected, :boolean, default: false, null: false
      add :is_working, :boolean, default: false, null: false
      add :revoked_at, :utc_datetime
      add :user_id, references(:users, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:bot_tokens, [:user_id])
    create unique_index(:bot_tokens, [:token_hash])
  end
end
