defmodule Messaging.Repo.Migrations.CreateConversations do
  use Ecto.Migration

  def change do
    create table(:conversations) do
      add :title, :string
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :bot_token_id, references(:bot_tokens, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:conversations, [:user_id])
    create index(:conversations, [:bot_token_id])
  end
end
