defmodule Messaging.Bots.BotModel do
  use Ecto.Schema
  import Ecto.Changeset

  schema "bot_models" do
    field :name, :string
    field :input_cost_per_token, :decimal
    field :output_cost_per_token, :decimal
    field :context_sizes, {:array, :integer}, default: []

    belongs_to :bot_token, Messaging.Bots.BotToken

    timestamps(type: :utc_datetime)
  end

  def changeset(bot_model, attrs) do
    bot_model
    |> cast(attrs, [
      :name,
      :input_cost_per_token,
      :output_cost_per_token,
      :bot_token_id,
      :context_sizes
    ])
    |> validate_required([:name, :input_cost_per_token, :output_cost_per_token, :bot_token_id])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_number(:input_cost_per_token, greater_than_or_equal_to: 0)
    |> validate_number(:output_cost_per_token, greater_than_or_equal_to: 0)
    |> unique_constraint([:bot_token_id, :name])
  end
end
