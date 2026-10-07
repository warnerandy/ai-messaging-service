defmodule Messaging.Chat do
  @moduledoc """
  Context for conversations and messages.
  """

  import Ecto.Query
  alias Messaging.Repo
  alias Messaging.Chat.{Conversation, Message}

  # --- Conversations ---

  def resolve_conversation_timestamps(%Conversation{} = c, stats \\ %{}) do
    meta = c.metadata || %{}

    last_user_input_time =
      meta["last_user_input_time"] ||
        meta[:last_user_input_time] ||
        meta["lastUserInputTime"] ||
        meta[:lastUserInputTime] ||
        stats[:last_user_input_time]

    last_modified_time =
      meta["last_modified_time"] ||
        meta[:last_modified_time] ||
        meta["lastModifiedTime"] ||
        meta[:lastModifiedTime] ||
        meta["source_updated_at"] ||
        meta[:source_updated_at] ||
        meta["last_modified"] ||
        meta[:last_modified] ||
        meta["last_activity_at"] ||
        meta[:last_activity_at] ||
        stats[:last_message_at] ||
        c.updated_at

    last_message_at =
      stats[:last_message_at] ||
        meta["last_message_at"] ||
        meta[:last_message_at] ||
        meta["lastMessageAt"] ||
        meta[:lastMessageAt] ||
        last_modified_time

    %{
      c
      | last_user_input_time: last_user_input_time,
        last_modified_time: last_modified_time,
        last_message_at: last_message_at
    }
  end

  def get_message_stats_for_conversations(conversation_ids) when is_list(conversation_ids) do
    if conversation_ids == [] do
      %{}
    else
      from(m in Message,
        where: m.conversation_id in ^conversation_ids,
        group_by: m.conversation_id,
        select: %{
          conversation_id: m.conversation_id,
          last_message_at: max(m.inserted_at),
          last_user_input_time:
            max(fragment("CASE WHEN ? = 'user' THEN ? ELSE NULL END", m.role, m.inserted_at))
        }
      )
      |> Repo.all()
      |> Map.new(fn s -> {s.conversation_id, s} end)
    end
  end

  def list_conversations(user_id) do
    convs =
      Conversation
      |> where(user_id: ^user_id)
      |> order_by([c], desc: c.updated_at, desc: c.id)
      |> preload(:bot_token)
      |> Repo.all()

    conv_ids = Enum.map(convs, & &1.id)
    stats_map = get_message_stats_for_conversations(conv_ids)

    Enum.map(convs, fn c ->
      resolve_conversation_timestamps(c, Map.get(stats_map, c.id, %{}))
    end)
  end

  def list_conversations_for_bot(bot_token_id) do
    convs =
      Conversation
      |> where(bot_token_id: ^bot_token_id)
      |> order_by([c], desc: c.updated_at, desc: c.id)
      |> preload(:bot_token)
      |> Repo.all()

    conv_ids = Enum.map(convs, & &1.id)
    stats_map = get_message_stats_for_conversations(conv_ids)

    Enum.map(convs, fn c ->
      resolve_conversation_timestamps(c, Map.get(stats_map, c.id, %{}))
    end)
  end

  def get_conversation!(id, opts) when is_list(opts) do
    conversation_id = normalize_conversation_id!(id)

    query =
      Conversation
      |> where([c], c.id == ^conversation_id)
      |> maybe_scope_conversation(opts)
      |> preload(:bot_token)

    conv = Repo.one!(query)
    stats = get_message_stats_for_conversations([conv.id])
    resolve_conversation_timestamps(conv, Map.get(stats, conv.id, %{}))
  end

  def create_conversation(attrs) do
    %Conversation{}
    |> Conversation.changeset(attrs)
    |> Repo.insert()
    |> tap(fn
      {:ok, conv} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{conv.bot_token_id}",
          {:conversation_created, conv}
        )

      _ ->
        :ok
    end)
  end

  def get_conversation_by_external_session(bot_token_id, external_session_id) do
    Conversation
    |> where(bot_token_id: ^normalize_conversation_id!(bot_token_id))
    |> where(external_session_id: ^to_string(external_session_id))
    |> preload(:bot_token)
    |> Repo.one()
  end

  def sync_bot_sessions(%Messaging.Bots.BotToken{} = bot_token, sessions_list)
      when is_list(sessions_list) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    normalized_sessions =
      Enum.map(sessions_list, fn s ->
        session_id = to_string(s["session_id"] || s[:session_id] || s["id"] || s[:id])
        title = s["title"] || s[:title]
        status = s["status"] || s[:status] || "idle"
        raw_meta = s["metadata"] || s[:metadata] || %{}
        
        # Merge top-level attributes like project, working_directories, source_updated_at into metadata
        extra_keys =
          s
          |> Map.drop(["session_id", :session_id, "id", :id, "title", :title, "status", :status, "metadata", :metadata])
          |> Enum.map(fn {k, v} -> {to_string(k), v} end)
          |> Map.new()

        metadata = Map.merge(extra_keys, raw_meta)
        %{session_id: session_id, title: title, status: status, metadata: metadata}
      end)
      |> Enum.filter(&(&1.session_id != ""))

    incoming_session_ids = Enum.map(normalized_sessions, & &1.session_id)

    existing_conversations =
      Conversation
      |> where(bot_token_id: ^bot_token.id)
      |> where([c], not is_nil(c.external_session_id))
      |> Repo.all()
      |> Map.new(fn c -> {c.external_session_id, c} end)

    synced =
      Enum.map(normalized_sessions, fn item ->
        case Map.get(existing_conversations, item.session_id) do
          nil ->
            attrs = %{
              user_id: bot_token.user_id,
              bot_token_id: bot_token.id,
              external_session_id: item.session_id,
              title: item.title || "Session #{item.session_id}",
              status: item.status,
              metadata: item.metadata
            }

            {:ok, conv} = create_conversation(attrs)
            conv

          existing ->
            update_attrs = %{
              status: item.status,
              metadata: Map.merge(existing.metadata || %{}, item.metadata)
            }

            update_attrs =
              if item.title && item.title != "" do
                Map.put(update_attrs, :title, item.title)
              else
                update_attrs
              end

            {:ok, conv} =
              existing
              |> Conversation.changeset(update_attrs)
              |> Repo.update()

            conv
        end
      end)
      |> Enum.map(&resolve_conversation_timestamps(&1, %{}))

    from(c in Conversation,
      where:
        c.bot_token_id == ^bot_token.id and not is_nil(c.external_session_id) and
          c.external_session_id not in ^incoming_session_ids and c.status != "archived"
    )
    |> Repo.update_all(set: [status: "archived", updated_at: now])

    # Broadcast to bot session subscribers
    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "bot_sessions:#{bot_token.id}",
      {:bot_sessions_updated, bot_token.id, synced}
    )

    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "bot_status:#{bot_token.user_id}",
      {:bot_sessions_updated, bot_token.id, synced}
    )

    {:ok, synced}
  end

  def update_session_status(conversation_id, status, metadata \\ %{}) do
    conversation = get_conversation!(conversation_id, [])

    merged_metadata =
      (conversation.metadata || %{})
      |> Map.merge(metadata || %{})

    case conversation
         |> Conversation.changeset(%{status: status, metadata: merged_metadata})
         |> Repo.update() do
      {:ok, updated} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{updated.id}",
          {:session_status_changed, updated.id, status, merged_metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{updated.bot_token_id}",
          {:session_status_changed, updated.id, status, merged_metadata}
        )

        {:ok, updated}

      error ->
        error
    end
  end

  def archive_conversation(conversation_id, user_id) do
    conversation = get_conversation!(conversation_id, user_id: user_id)

    case conversation
         |> Conversation.changeset(%{status: "archived"})
         |> Repo.update() do
      {:ok, updated} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{updated.id}",
          {:session_status_changed, updated.id, "archived", updated.metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{updated.bot_token_id}",
          {:session_status_changed, updated.id, "archived", updated.metadata}
        )

        {:ok, updated}

      error ->
        error
    end
  end

  def queue_prompt(conversation_id, prompt_data) do
    conversation = get_conversation!(conversation_id, [])
    current_meta = conversation.metadata || %{}
    current_queue = Map.get(current_meta, "prompt_queue", [])

    prompt_item =
      case prompt_data do
        %{} = map ->
          map
          |> Map.put_new("id", :crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower))
          |> Map.put_new("queued_at", DateTime.utc_now() |> DateTime.to_iso8601())

        body when is_binary(body) ->
          %{
            "id" => :crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower),
            "body" => body,
            "queued_at" => DateTime.utc_now() |> DateTime.to_iso8601()
          }
      end

    updated_queue = current_queue ++ [prompt_item]
    new_meta = Map.put(current_meta, "prompt_queue", updated_queue)

    {:ok, updated} =
      conversation
      |> Conversation.changeset(%{metadata: new_meta})
      |> Repo.update()

    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "conversation:#{updated.id}",
      {:prompt_queue_updated, updated.id, updated_queue}
    )

    {:ok, prompt_item, updated_queue}
  end

  def pop_queued_prompt(conversation_id) do
    conversation = get_conversation!(conversation_id, [])
    current_meta = conversation.metadata || %{}
    current_queue = Map.get(current_meta, "prompt_queue", [])

    case current_queue do
      [] ->
        {:ok, nil, []}

      [head | tail] ->
        new_meta = Map.put(current_meta, "prompt_queue", tail)

        {:ok, updated} =
          conversation
          |> Conversation.changeset(%{metadata: new_meta})
          |> Repo.update()

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{updated.id}",
          {:prompt_queue_updated, updated.id, tail}
        )

        {:ok, head, tail}
    end
  end

  def remove_queued_prompt(conversation_id, prompt_id) do
    conversation = get_conversation!(conversation_id, [])
    current_meta = conversation.metadata || %{}
    current_queue = Map.get(current_meta, "prompt_queue", [])

    updated_queue = Enum.reject(current_queue, fn item -> item["id"] == prompt_id end)
    new_meta = Map.put(current_meta, "prompt_queue", updated_queue)

    {:ok, updated} =
      conversation
      |> Conversation.changeset(%{metadata: new_meta})
      |> Repo.update()

    Phoenix.PubSub.broadcast(
      Messaging.PubSub,
      "conversation:#{updated.id}",
      {:prompt_queue_updated, updated.id, updated_queue}
    )

    {:ok, updated_queue}
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
        # Touch conversation updated_at so recent conversations sort to the top
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        from(c in Conversation, where: c.id == ^message.conversation_id)
        |> Repo.update_all(set: [updated_at: now])

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

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{conversation.bot_token_id}",
          {:session_message_created, conversation.id, now}
        )

      _ ->
        :ok
    end)
  end

  def create_bot_timeout_message(conversation_id, message_id) do
    conversation_id = normalize_conversation_id!(conversation_id)
    message_id = normalize_message_id!(message_id)

    Repo.transaction(fn ->
      user_message =
        Message
        |> where(
          [m],
          m.id == ^message_id and m.conversation_id == ^conversation_id and m.role == "user" and
            m.acknowledged
        )
        |> lock("FOR UPDATE")
        |> Repo.one()

      if is_nil(user_message) do
        Repo.rollback(:not_eligible)
      end

      bot_replied? =
        Message
        |> where(
          [m],
          m.conversation_id == ^conversation_id and m.role == "bot" and m.id > ^message_id
        )
        |> Repo.exists?()

      already_reported? =
        Message
        |> where([m], m.conversation_id == ^conversation_id and m.role == "system")
        |> where(
          [m],
          fragment("?->>'kind' = 'bot_timeout'", m.metadata) and
            fragment("(?->>'timeout_for_message_id')::bigint = ?", m.metadata, ^message_id)
        )
        |> Repo.exists?()

      cond do
        bot_replied? ->
          Repo.rollback(:already_responded)

        already_reported? ->
          Repo.rollback(:already_reported)

        true ->
          attrs = %{
            role: "system",
            content_type: "text",
            body: "The bot failed to respond.",
            metadata: %{"kind" => "bot_timeout", "timeout_for_message_id" => message_id},
            conversation_id: conversation_id
          }

          case Repo.insert(Message.changeset(%Message{}, attrs)) do
            {:ok, message} -> message
            {:error, changeset} -> Repo.rollback({:invalid, changeset})
          end
      end
    end)
    |> case do
      {:ok, message} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{message.conversation_id}",
          {:new_message, message}
        )

        {:ok, message}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_message!(id), do: Repo.get!(Message, id)

  def acknowledge_message(message_id, conversation_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    {count, _} =
      Message
      |> where(
        [m],
        m.id == ^message_id and m.conversation_id == ^conversation_id and m.role == "user" and
          not m.acknowledged
      )
      |> Repo.update_all(set: [acknowledged: true, acknowledged_at: now])

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

  defp normalize_message_id!(id) when is_integer(id), do: id

  defp normalize_message_id!(id) when is_binary(id) do
    case Integer.parse(id) do
      {parsed, ""} -> parsed
      _ -> raise Ecto.NoResultsError, queryable: Message
    end
  end
end
