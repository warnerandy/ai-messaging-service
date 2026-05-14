defmodule Messaging.Chat.Conversation do
  use Ecto.Schema
  import Ecto.Changeset

  schema "conversations" do
    field :title, :string

    belongs_to :user, Messaging.Accounts.User
    belongs_to :bot_token, Messaging.Bots.BotToken
    has_many :messages, Messaging.Chat.Message

    timestamps(type: :utc_datetime)
  end

  def changeset(conversation, attrs) do
    conversation
    |> cast(attrs, [:title, :user_id, :bot_token_id])
    |> validate_required([:user_id, :bot_token_id])
    |> validate_length(:title, max: 255)
  end
end
