defmodule Messaging.Chat.Conversation do
  use Ecto.Schema
  import Ecto.Changeset

  schema "conversations" do
    field :title, :string
    field :external_session_id, :string
    field :status, :string, default: "idle"
    field :metadata, :map, default: %{}

    belongs_to :user, Messaging.Accounts.User
    belongs_to :bot_token, Messaging.Bots.BotToken
    has_many :messages, Messaging.Chat.Message

    timestamps(type: :utc_datetime)
  end

  def changeset(conversation, attrs) do
    conversation
    |> cast(attrs, [:title, :user_id, :bot_token_id, :external_session_id, :status, :metadata])
    |> validate_required([:user_id, :bot_token_id])
    |> validate_length(:title, max: 255)
  end
end
