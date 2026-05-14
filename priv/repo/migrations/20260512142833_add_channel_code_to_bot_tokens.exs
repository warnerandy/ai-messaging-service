defmodule Messaging.Repo.Migrations.AddChannelCodeToBotTokens do
  use Ecto.Migration

  def change do
    alter table(:bot_tokens) do
      add :channel_code, :string
    end

    create unique_index(:bot_tokens, [:channel_code])
  end
end
