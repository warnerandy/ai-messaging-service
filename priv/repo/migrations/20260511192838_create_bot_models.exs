defmodule Messaging.Repo.Migrations.CreateBotModels do
  use Ecto.Migration

  def change do
    create table(:bot_models) do
      add :name, :string, null: false
      add :input_cost_per_token, :decimal, null: false
      add :output_cost_per_token, :decimal, null: false
      add :bot_token_id, references(:bot_tokens, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:bot_models, [:bot_token_id])
    create unique_index(:bot_models, [:bot_token_id, :name])
  end
end
