defmodule Messaging.Repo.Migrations.AddIsSuggestionToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :is_suggestion, :boolean, default: false, null: false
    end
  end
end
