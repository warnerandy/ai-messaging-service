defmodule Messaging.Repo.Migrations.AddModelToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :model, :string
    end
  end
end
