defmodule Messaging.Repo.Migrations.AddAcknowledgedAtToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :acknowledged_at, :utc_datetime
    end
  end
end
