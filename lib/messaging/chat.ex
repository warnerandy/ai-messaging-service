defmodule Messaging.Chat do
  @moduledoc """
  Context for conversations and messages.
  """

  import Ecto.Query
  alias Messaging.Repo
  alias Messaging.Chat.{Conversation, Message}

  # --- Conversations ---

  def list_conversations(user_id) do
    Conversation
    |> where(user_id: ^user_id)
    |> order_by(desc: :updated_at)
    |> preload(:bot_token)
    |> Repo.all()
  end

  def list_conversations_for_bot(bot_token_id) do
    Conversation
    |> where(bot_token_id: ^bot_token_id)
    |> order_by(desc: :updated_at)
    |> Repo.all()
  end

  def get_conversation!(id), do: Repo.get!(Conversation, id) |> Repo.preload(:bot_token)

  def create_conversation(attrs) do
    %Conversation{}
    |> Conversation.changeset(attrs)
    |> Repo.insert()
  end

  # --- Messages ---

  def list_messages(conversation_id) do
    Message
    |> where(conversation_id: ^conversation_id)
    |> order_by(asc: :inserted_at)
    |> Repo.all()
  end

  def get_pending_messages_for_bot(bot_token_id, opts \\ []) do
    since = Keyword.get(opts, :since)

    query =
      Message
      |> join(:inner, [m], c in Conversation, on: m.conversation_id == c.id)
      |> where([m, c], c.bot_token_id == ^bot_token_id)
      |> where([m], m.role == "user")
      |> order_by([m], asc: m.inserted_at)
      |> select([m, c], %{message: m, conversation_id: c.id})

    query =
      if since do
        where(query, [m], m.inserted_at > ^since)
      else
        query
      end

    Repo.all(query)
  end

  def create_message(attrs) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
    |> tap(fn
      {:ok, message} ->
        # Broadcast to conversation subscribers
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{message.conversation_id}",
          {:new_message, message}
        )

        # Also broadcast to the bot channel
        conversation = get_conversation!(message.conversation_id)

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{conversation.bot_token_id}",
          {:new_message, message, conversation}
        )

      _ ->
        :ok
    end)
  end
end
