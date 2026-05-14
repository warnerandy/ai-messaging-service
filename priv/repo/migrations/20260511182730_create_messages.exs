defmodule Messaging.Repo.Migrations.CreateMessages do
  use Ecto.Migration

  def change do
    create table(:messages) do
      # "user" or "bot"
      add :role, :string, null: false
      # text, image, video, file, actions
      add :content_type, :string, null: false, default: "text"
      # text content or caption
      add :body, :text
      # attachments, urls, suggested actions, etc.
      add :metadata, :map, default: %{}
      add :conversation_id, references(:conversations, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:conversation_id])
    create index(:messages, [:inserted_at])
  end
end
