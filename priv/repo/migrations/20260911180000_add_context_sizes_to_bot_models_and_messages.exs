defmodule Messaging.Repo.Migrations.AddContextSizesToBotModelsAndMessages do
  use Ecto.Migration

  def change do
    alter table(:bot_models) do
      add :context_sizes, {:array, :integer}, default: [], null: false
    end

    alter table(:messages) do
      add :context_size, :integer
    end
  end
end
