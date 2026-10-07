defmodule Messaging.Repo.Migrations.AddAhpSupportToConversationsAndBots do
  use Ecto.Migration

  def change do
    alter table(:conversations) do
      add :external_session_id, :string
      add :status, :string, default: "idle", null: false
      add :metadata, :map, default: %{}, null: false
    end

    create index(:conversations, [:bot_token_id, :external_session_id])

    alter table(:bot_tokens) do
      add :bot_type, :string, default: "chat", null: false
      add :metadata, :map, default: %{}, null: false
    end
  end
end
