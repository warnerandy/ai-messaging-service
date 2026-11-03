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

  def list_conversations(user_id, opts \\ []) do
    include_archived = Keyword.get(opts, :include_archived, false)

    query =
      Conversation
      |> where(user_id: ^user_id)

    query =
      if include_archived do
        query
      else
        where(query, [c], c.status != "archived")
      end

    convs =
      query
      |> order_by([c], desc: c.updated_at, desc: c.id)
      |> preload(:bot_token)
      |> Repo.all()

    conv_ids = Enum.map(convs, & &1.id)
    stats_map = get_message_stats_for_conversations(conv_ids)

    Enum.map(convs, fn c ->
      resolve_conversation_timestamps(c, Map.get(stats_map, c.id, %{}))
    end)
  end

  def list_conversations_for_bot(bot_token_id, opts \\ []) do
    include_archived = Keyword.get(opts, :include_archived, false)

    query =
      Conversation
      |> where(bot_token_id: ^bot_token_id)

    query =
      if include_archived do
        query
      else
        where(query, [c], c.status != "archived")
      end

    convs =
      query
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

  def get_conversation_scoped(id, opts \\ []) do
    try do
      get_conversation!(id, opts)
    rescue
      Ecto.NoResultsError -> nil
    end
  end

  def create_conversation(attrs) do
    attrs = ensure_external_session_id(attrs)

    # When creating a new session with a default generic title (e.g. "* Session"),
    # clean up any prior idle sessions with the same title that have zero user messages
    # so the sidebar never accumulates duplicate empty session placeholders.
    title = attrs[:title] || attrs["title"]
    bot_token_id = attrs[:bot_token_id] || attrs["bot_token_id"]

    if is_binary(title) and String.ends_with?(title, " Session") and not is_nil(bot_token_id) do
      prior_empty_ids =
        from(c in Conversation,
          left_join: m in Message,
          on: m.conversation_id == c.id and m.role == "user",
          where: c.bot_token_id == ^bot_token_id and c.title == ^title and c.status == "idle",
          where: is_nil(m.id),
          select: c.id
        )
        |> Repo.all()

      if prior_empty_ids != [] do
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        from(c in Conversation, where: c.id in ^prior_empty_ids)
        |> Repo.update_all(set: [status: "archived", updated_at: now])

        Enum.each(prior_empty_ids, fn conv_id ->
          Phoenix.PubSub.broadcast(
            Messaging.PubSub,
            "conversation:#{conv_id}",
            {:session_status_changed, conv_id, "archived", %{}}
          )

          Phoenix.PubSub.broadcast(
            Messaging.PubSub,
            "bot_sessions:#{bot_token_id}",
            {:session_status_changed, conv_id, "archived", %{}}
          )
        end)
      end
    end

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

        create_payload = %{
          "conversation_id" => conv.id,
          "session_id" => conv.external_session_id,
          "external_session_id" => conv.external_session_id,
          "title" => conv.title,
          "status" => conv.status,
          "metadata" => conv.metadata || %{},
          "created_at" => DateTime.to_iso8601(conv.inserted_at)
        }

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{conv.bot_token_id}",
          {:create_session, create_payload}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{conv.bot_token_id}",
          {:request_session_sync, create_payload}
        )

      _ ->
        :ok
    end)
  end

  defp ensure_external_session_id(attrs) when is_map(attrs) do
    ext_id = attrs[:external_session_id] || attrs["external_session_id"]

    if is_nil(ext_id) or ext_id == "" do
      uuid = Ecto.UUID.generate()

      if Map.has_key?(attrs, :bot_token_id) or Map.has_key?(attrs, :user_id) do
        Map.put(attrs, :external_session_id, uuid)
      else
        Map.put(attrs, "external_session_id", uuid)
      end
    else
      attrs
    end
  end

  defp ensure_external_session_id(attrs), do: attrs

  defp extract_project_key(nil), do: nil

  defp extract_project_key(%{} = meta) do
    project = meta["project"] || meta[:project]
    working_dir = meta["working_directory"] || meta[:working_directory]
    cwd = meta["cwd"] || meta[:cwd]
    working_dirs = meta["working_directories"] || meta[:working_directories]

    cond do
      is_map(project) and is_binary(project["name"] || project[:name]) and
          (project["name"] || project[:name]) != "" ->
        project["name"] || project[:name]

      is_map(project) and is_binary(project["path"] || project[:path]) and
          (project["path"] || project[:path]) != "" ->
        project["path"] || project[:path]

      is_binary(project) and project != "" ->
        project

      is_binary(working_dir) and working_dir != "" ->
        working_dir

      is_binary(cwd) and cwd != "" ->
        cwd

      is_list(working_dirs) and working_dirs != [] and is_binary(hd(working_dirs)) ->
        hd(working_dirs)

      true ->
        nil
    end
  end

  def get_conversation_by_external_session(bot_token_id, external_session_id) do
    Conversation
    |> where(bot_token_id: ^normalize_conversation_id!(bot_token_id))
    |> where(external_session_id: ^to_string(external_session_id))
    |> preload(:bot_token)
    |> Repo.one()
  end

  def resolve_bot_conversation(%Messaging.Bots.BotToken{} = bot_token, payload)
      when is_map(payload) do
    raw_id = payload["conversation_id"] || payload[:conversation_id]

    ext_id =
      payload["session_id"] || payload[:session_id] || payload["external_session_id"] ||
        payload[:external_session_id]

    cond do
      is_integer(raw_id) ->
        get_conversation!(raw_id, bot_token_id: bot_token.id)

      is_binary(raw_id) and raw_id != "" ->
        case Integer.parse(raw_id) do
          {int_id, ""} ->
            case get_conversation_scoped(int_id, bot_token_id: bot_token.id) do
              nil ->
                find_or_create_by_external_id(bot_token, raw_id) ||
                  raise Ecto.NoResultsError, queryable: Conversation

              conv ->
                conv
            end

          _ ->
            find_or_create_by_external_id(bot_token, raw_id) ||
              raise Ecto.NoResultsError, queryable: Conversation
        end

      (is_binary(ext_id) and ext_id != "") or is_integer(ext_id) ->
        find_or_create_by_external_id(bot_token, to_string(ext_id)) ||
          raise Ecto.NoResultsError, queryable: Conversation

      true ->
        raise Ecto.NoResultsError, queryable: Conversation
    end
  end

  defp find_or_create_by_external_id(bot_token, ext_id) do
    case get_conversation_by_external_session(bot_token.id, ext_id) do
      nil ->
        case create_conversation(%{
               user_id: bot_token.user_id,
               bot_token_id: bot_token.id,
               external_session_id: to_string(ext_id),
               title: "Session #{ext_id}",
               status: "idle"
             }) do
          {:ok, conv} -> conv
          _ -> nil
        end

      conv ->
        conv
    end
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
          |> Map.drop([
            "session_id",
            :session_id,
            "id",
            :id,
            "title",
            :title,
            "status",
            :status,
            "metadata",
            :metadata
          ])
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
            title =
              cond do
                item.title && item.title != "" ->
                  item.title

                String.match?(
                  item.session_id,
                  ~r/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                ) ->
                  "Session (#{String.slice(item.session_id, 0, 8)})"

                true ->
                  "Session #{item.session_id}"
              end

            attrs = %{
              user_id: bot_token.user_id,
              bot_token_id: bot_token.id,
              external_session_id: item.session_id,
              title: title,
              status: item.status,
              metadata: Map.put(item.metadata || %{}, "synced_by_bot", true)
            }

            {:ok, conv} = create_conversation(attrs)
            conv

          existing ->
            cleared_meta =
              if item.status in ["idle", "running", "completed", "done", "archived"] and
                   not Map.has_key?(item.metadata, "question") do
                Map.delete(existing.metadata || %{}, "question")
              else
                existing.metadata || %{}
              end

            # CRITICAL: Preserve archived status against routine background bot syncs.
            new_status =
              if existing.status == "archived" and
                   item.status not in ["running", "waiting_for_input", "needs_input"] do
                "archived"
              else
                item.status
              end

            merged_meta =
              cleared_meta
              |> Map.merge(item.metadata || %{})
              |> Map.put("synced_by_bot", true)

            update_attrs = %{
              status: new_status,
              metadata: merged_meta
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

    # Identify incoming project scope
    incoming_projects =
      normalized_sessions
      |> Enum.map(&extract_project_key(&1.metadata))
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    # Find candidates for pruning:
    # 1. Must belong to this bot_token
    # 2. Must have an external_session_id
    # 3. Must not be in incoming_session_ids
    # 4. Must not already be archived
    # 5. Must not be in an active state (running, thinking, waiting_for_input, needs_input)
    candidate_conversations =
      Conversation
      |> where(bot_token_id: ^bot_token.id)
      |> where([c], not is_nil(c.external_session_id))
      |> where([c], c.external_session_id not in ^incoming_session_ids)
      |> where(
        [c],
        c.status not in ["archived", "running", "thinking", "waiting_for_input", "needs_input"]
      )
      |> Repo.all()

    candidate_ids = Enum.map(candidate_conversations, & &1.id)

    conv_ids_with_user_messages =
      if candidate_ids == [] do
        MapSet.new()
      else
        from(m in Message,
          where: m.conversation_id in ^candidate_ids and m.role == "user",
          select: m.conversation_id,
          distinct: true
        )
        |> Repo.all()
        |> MapSet.new()
      end

    to_archive_ids =
      candidate_conversations
      |> Enum.filter(fn conv ->
        synced_by_bot? =
          conv.metadata &&
            (conv.metadata["synced_by_bot"] == true or conv.metadata[:synced_by_bot] == true)

        same_project? =
          if incoming_projects == [] do
            true
          else
            conv_project = extract_project_key(conv.metadata)
            is_nil(conv_project) or conv_project in incoming_projects
          end

        has_user_messages? = MapSet.member?(conv_ids_with_user_messages, conv.id)

        # Conversations with user messages are valuable conversation history and should NEVER be auto-archived!
        # Only bot-synced sessions without user messages that are omitted can be archived.
        synced_by_bot? and same_project? and not has_user_messages?
      end)
      |> Enum.map(& &1.id)

    # Also archive any older abandoned sessions that have generic default titles (e.g. "* Session")
    # and have NO user messages, keeping at most the single newest one active
    generic_default_conversations =
      candidate_conversations
      |> Enum.filter(fn conv ->
        generic_title? =
          is_binary(conv.title) and
            (String.ends_with?(conv.title, " Session") or conv.title == "Session")

        has_user_messages? = MapSet.member?(conv_ids_with_user_messages, conv.id)

        generic_title? and not has_user_messages?
      end)
      |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})

    # Drop the most recent one if it was created very recently (within 5 minutes), archive the rest
    five_min_ago = DateTime.add(now, -300, :second)

    extra_generic_to_archive =
      case generic_default_conversations do
        [latest | older] ->
          if DateTime.compare(latest.inserted_at, five_min_ago) == :gt do
            Enum.map(older, & &1.id)
          else
            Enum.map([latest | older], & &1.id)
          end

        [] ->
          []
      end

    all_to_archive_ids =
      (to_archive_ids ++ extra_generic_to_archive)
      |> Enum.uniq()

    if all_to_archive_ids != [] do
      from(c in Conversation, where: c.id in ^all_to_archive_ids)
      |> Repo.update_all(set: [status: "archived", updated_at: now])

      Enum.each(all_to_archive_ids, fn conv_id ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{conv_id}",
          {:session_status_changed, conv_id, "archived", %{}}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{bot_token.id}",
          {:session_status_changed, conv_id, "archived", %{}}
        )
      end)
    end

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

    # Protect archived status from being overwritten by routine status events
    resolved_status =
      if conversation.status == "archived" and
           status not in ["running", "waiting_for_input", "needs_input"] do
        "archived"
      else
        status
      end

    cleared_metadata =
      if resolved_status in ["idle", "running", "completed", "done", "archived"] and
           not Map.has_key?(metadata || %{}, "question") do
        Map.delete(conversation.metadata || %{}, "question")
      else
        conversation.metadata || %{}
      end

    merged_metadata =
      cleared_metadata
      |> Map.merge(metadata || %{})

    case conversation
         |> Conversation.changeset(%{status: resolved_status, metadata: merged_metadata})
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

  def update_session_metadata(conversation_id, new_metadata) when is_map(new_metadata) do
    conversation = get_conversation!(conversation_id, [])
    merged_metadata = Map.merge(conversation.metadata || %{}, new_metadata)

    case conversation
         |> Conversation.changeset(%{metadata: merged_metadata})
         |> Repo.update() do
      {:ok, updated} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{updated.id}",
          {:session_status_changed, updated.id, updated.status, merged_metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{updated.bot_token_id}",
          {:session_status_changed, updated.id, updated.status, merged_metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{updated.bot_token_id}",
          {:session_config_changed,
           %{
             "conversation_id" => updated.id,
             "session_id" => updated.external_session_id,
             "external_session_id" => updated.external_session_id,
             "metadata" => merged_metadata
           }}
        )

        {:ok, updated}

      error ->
        error
    end
  end

  def update_conversation(%Conversation{} = conversation, attrs) do
    metadata =
      if Map.has_key?(attrs, "metadata") or Map.has_key?(attrs, :metadata) do
        new_meta = attrs["metadata"] || attrs[:metadata] || %{}
        Map.merge(conversation.metadata || %{}, new_meta)
      else
        conversation.metadata || %{}
      end

    updated_attrs =
      attrs
      |> Map.put("metadata", metadata)

    case conversation
         |> Conversation.changeset(updated_attrs)
         |> Repo.update() do
      {:ok, updated} ->
        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "conversation:#{updated.id}",
          {:session_status_changed, updated.id, updated.status, updated.metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot_sessions:#{updated.bot_token_id}",
          {:session_status_changed, updated.id, updated.status, updated.metadata}
        )

        Phoenix.PubSub.broadcast(
          Messaging.PubSub,
          "bot:#{updated.bot_token_id}",
          {:session_config_changed,
           %{
             "conversation_id" => updated.id,
             "session_id" => updated.external_session_id,
             "external_session_id" => updated.external_session_id,
             "metadata" => updated.metadata
           }}
        )

        {:ok, updated}

      error ->
        error
    end
  end

  def archive_conversation(conversation_id, user_id) do
    conversation = get_conversation!(conversation_id, user_id: user_id)
    meta = Map.put(conversation.metadata || %{}, "explicitly_archived", true)

    case conversation
         |> Conversation.changeset(%{status: "archived", metadata: meta})
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

  def get_last_message(conversation_id) do
    conv_id = normalize_conversation_id!(conversation_id)

    Message
    |> where(conversation_id: ^conv_id)
    |> order_by([m], desc: m.id)
    |> limit(1)
    |> Repo.one()
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
