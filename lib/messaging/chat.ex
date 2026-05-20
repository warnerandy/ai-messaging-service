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

  def get_conversation!(id, opts) when is_list(opts) do
    conversation_id = normalize_conversation_id!(id)

    query =
      Conversation
      |> where([c], c.id == ^conversation_id)
      |> maybe_scope_conversation(opts)
      |> preload(:bot_token)

    Repo.one!(query)
  end

  def create_conversation(attrs) do
    %Conversation{}
    |> Conversation.changeset(attrs)
    |> Repo.insert()
  end

  # --- Messages ---

  def list_messages(conversation_id, opts \\ []) do
    conversation_id = normalize_conversation_id!(conversation_id)
    after_id = Keyword.get(opts, :after_id)
    limit = Keyword.get(opts, :limit)

    query =
      Message
      |> where(conversation_id: ^conversation_id)
      |> maybe_scope_after_id(after_id)
      |> maybe_limit_messages(limit)

    Repo.all(query)
    |> Enum.reverse()
  end

  def get_pending_messages_for_bot(bot_token_id, opts \\ []) do
    since = Keyword.get(opts, :since)

    query =
      Message
      |> join(:inner, [m], c in Conversation, on: m.conversation_id == c.id)
      |> where([m, c], c.bot_token_id == ^bot_token_id)
      |> where([m], m.role == "user")
      |> where([m], not m.acknowledged)
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
        conversation = get_conversation_with_bot!(message.conversation_id)

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{conversation.bot_token_id}",
          {:new_message, message, conversation}
        )

      _ ->
        :ok
    end)
  end

  def get_message!(id), do: Repo.get!(Message, id)

  def acknowledge_message(message_id, conversation_id) do
    {count, _} =
      Message
      |> where(
        [m],
        m.id == ^message_id and m.conversation_id == ^conversation_id and m.role == "user"
      )
      |> Repo.update_all(set: [acknowledged: true])

    if count > 0 do
      Phoenix.PubSub.broadcast(
        Messaging.PubSub,
        "conversation:#{conversation_id}",
        {:message_acknowledged, message_id}
      )
    end

    :ok
  end

  defp get_conversation_with_bot!(id) do
    id
    |> normalize_conversation_id!()
    |> then(&Repo.get!(Conversation, &1))
    |> Repo.preload(:bot_token)
  end

  defp maybe_scope_conversation(query, opts) do
    Enum.reduce(opts, query, fn
      {:user_id, user_id}, acc_query ->
        where(acc_query, [c], c.user_id == ^normalize_conversation_id!(user_id))

      {:bot_token_id, bot_token_id}, acc_query ->
        where(acc_query, [c], c.bot_token_id == ^normalize_conversation_id!(bot_token_id))

      {key, _value}, _acc_query ->
        raise ArgumentError, "unsupported conversation scope: #{inspect(key)}"
    end)
  end

  defp maybe_scope_after_id(query, nil), do: query

  defp maybe_scope_after_id(query, after_id) when is_integer(after_id) do
    where(query, [m], m.id > ^after_id)
  end

  defp maybe_scope_after_id(_query, after_id) do
    raise ArgumentError, "invalid after_id: #{inspect(after_id)}"
  end

  defp maybe_limit_messages(query, nil) do
    order_by(query, [m], desc: m.id)
  end

  defp maybe_limit_messages(query, limit) when is_integer(limit) and limit > 0 do
    query
    |> order_by([m], desc: m.id)
    |> limit(^limit)
  end

  defp maybe_limit_messages(_query, limit) do
    raise ArgumentError, "invalid limit: #{inspect(limit)}"
  end

  defp normalize_conversation_id!(id) when is_integer(id), do: id

  defp normalize_conversation_id!(id) when is_binary(id) do
    case Integer.parse(id) do
      {parsed, ""} -> parsed
      _ -> raise Ecto.NoResultsError, queryable: Conversation
    end
  end
end
