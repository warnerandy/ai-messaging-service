defmodule Messaging.Chat.Message do
  use Ecto.Schema
  import Ecto.Changeset

  @valid_roles ~w(user bot)
  @valid_content_types ~w(text image video file actions)

  schema "messages" do
    field :role, :string
    field :content_type, :string, default: "text"
    field :body, :string
    field :metadata, :map, default: %{}
    field :model, :string

    belongs_to :conversation, Messaging.Chat.Conversation

    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:role, :content_type, :body, :metadata, :model, :conversation_id])
    |> validate_required([:role, :conversation_id])
    |> validate_inclusion(:role, @valid_roles)
    |> validate_inclusion(:content_type, @valid_content_types)
    |> validate_content()
  end

  defp validate_content(changeset) do
    content_type = get_field(changeset, :content_type)
    body = get_field(changeset, :body)
    metadata = get_field(changeset, :metadata)

    case content_type do
      "text" ->
        if is_nil(body) or body == "",
          do: add_error(changeset, :body, "is required for text messages"),
          else: changeset

      "actions" ->
        if is_nil(metadata) or metadata == %{} or not Map.has_key?(metadata, "actions"),
          do: add_error(changeset, :metadata, "must include 'actions' list"),
          else: changeset

      type when type in ["image", "video", "file"] ->
        if is_nil(metadata) or metadata == %{} or not Map.has_key?(metadata, "url"),
          do: add_error(changeset, :metadata, "must include 'url' for #{type} messages"),
          else: changeset

      _ ->
        changeset
    end
  end
end
