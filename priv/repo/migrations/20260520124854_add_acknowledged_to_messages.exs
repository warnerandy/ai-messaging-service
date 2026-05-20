defmodule Messaging.Repo.Migrations.AddAcknowledgedToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :acknowledged, :boolean, default: false, null: false
    end
  end
end
