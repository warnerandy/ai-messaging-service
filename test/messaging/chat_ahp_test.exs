defmodule Messaging.ChatAhpTest do
  use Messaging.DataCase

  alias Messaging.{AccountsFixtures, Bots, Chat}

  setup do
    user = AccountsFixtures.user_fixture()

    {:ok, bot_token} =
      Bots.create_bot_token(%{
        name: "coding-agent",
        user_id: user.id,
        bot_type: "ahp",
        metadata: %{"version" => "1.0"}
      })

    %{user: user, bot_token: bot_token}
  end

  describe "sync_bot_sessions/2" do
    test "creates conversations for new sessions and updates existing ones", %{bot_token: bot} do
      sessions = [
        %{
          "session_id" => "sess-1",
          "title" => "Backend Task",
          "status" => "running",
          "metadata" => %{"step" => "compile"}
        },
        %{
          "session_id" => "sess-2",
          "title" => "Frontend Task",
          "status" => "idle"
        }
      ]

      assert {:ok, synced} = Chat.sync_bot_sessions(bot, sessions)
      assert length(synced) == 2

      sess1 = Enum.find(synced, &(&1.external_session_id == "sess-1"))
      assert sess1.status == "running"
      assert sess1.title == "Backend Task"
      assert sess1.metadata["step"] == "compile"

      # Subsequent sync archives removed sessions
      updated_sessions = [
        %{
          "session_id" => "sess-1",
          "title" => "Backend Task Updated",
          "status" => "waiting_for_input",
          "metadata" => %{"step" => "needs approval"}
        }
      ]

      assert {:ok, synced2} = Chat.sync_bot_sessions(bot, updated_sessions)
      assert length(synced2) == 1

      archived_sess2 = Chat.get_conversation_by_external_session(bot.id, "sess-2")
      assert archived_sess2.status == "archived"

      active_sess1 = Chat.get_conversation_by_external_session(bot.id, "sess-1")
      assert active_sess1.status == "waiting_for_input"
      assert active_sess1.title == "Backend Task Updated"
    end

    test "does not unarchive an already archived session during sync_bot_sessions", %{
      bot_token: bot
    } do
      sessions = [
        %{
          "session_id" => "sess-archived",
          "title" => "Archived Task",
          "status" => "idle"
        }
      ]

      assert {:ok, _} = Chat.sync_bot_sessions(bot, sessions)
      conv = Chat.get_conversation_by_external_session(bot.id, "sess-archived")
      assert {:ok, archived} = Chat.archive_conversation(conv.id, bot.user_id)
      assert archived.status == "archived"

      # Bot attempts routine sync with status "idle"
      assert {:ok, synced} = Chat.sync_bot_sessions(bot, sessions)
      synced_conv = Enum.find(synced, &(&1.external_session_id == "sess-archived"))
      assert synced_conv.status == "archived"

      refetched = Chat.get_conversation!(conv.id, [])
      assert refetched.status == "archived"
    end

    test "does not archive user-created sessions when routine sync_bot_sessions omits them", %{
      user: user,
      bot_token: bot
    } do
      # 1. User creates a new session in AIMS on an existing project
      {:ok, user_conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot.id,
          title: "My Project Session",
          external_session_id: "user-uuid-123",
          status: "idle",
          metadata: %{
            "project" => %{
              "name" => "my-project",
              "path" => "/home/user/my-project"
            }
          }
        })

      # 2. User sends a message
      {:ok, _msg} =
        Chat.create_message(%{
          conversation_id: user_conv.id,
          user_id: user.id,
          role: "user",
          body: "Hello agent, do task X"
        })

      # 3. Bot sends routine sync_sessions reporting only its own sessions
      bot_sessions = [
        %{
          "session_id" => "bot-existing-sess",
          "title" => "Bot Task",
          "status" => "idle"
        }
      ]

      assert {:ok, _} = Chat.sync_bot_sessions(bot, bot_sessions)

      # 4. User's conversation MUST NOT be archived!
      refetched = Chat.get_conversation!(user_conv.id, [])
      assert refetched.status == "idle"
      assert refetched.status != "archived"
    end

    test "does not archive sessions belonging to another project when bot reports sessions for one project",
         %{bot_token: bot} do
      # Project A session (bot managed)
      {:ok, _} =
        Chat.sync_bot_sessions(bot, [
          %{
            "session_id" => "proj-a-sess",
            "title" => "Project A Session",
            "status" => "idle",
            "metadata" => %{"project" => %{"name" => "Project A"}}
          }
        ])

      # Project B session (bot managed)
      {:ok, _} =
        Chat.sync_bot_sessions(bot, [
          %{
            "session_id" => "proj-b-sess",
            "title" => "Project B Session",
            "status" => "idle",
            "metadata" => %{"project" => %{"name" => "Project B"}}
          }
        ])

      # Bot subsequently syncs only Project A sessions
      {:ok, _} =
        Chat.sync_bot_sessions(bot, [
          %{
            "session_id" => "proj-a-sess",
            "title" => "Project A Session Updated",
            "status" => "running",
            "metadata" => %{"project" => %{"name" => "Project A"}}
          }
        ])

      # Project B session must NOT be archived because incoming sync was scoped to Project A
      proj_b_conv = Chat.get_conversation_by_external_session(bot.id, "proj-b-sess")
      assert proj_b_conv.status == "idle"
      assert proj_b_conv.status != "archived"
    end

    test "does not archive bot-managed sessions that have recent user activity", %{
      user: user,
      bot_token: bot
    } do
      # Bot creates a session
      {:ok, [conv]} =
        Chat.sync_bot_sessions(bot, [
          %{
            "session_id" => "active-user-sess",
            "title" => "Active Session",
            "status" => "idle"
          }
        ])

      # User interacts with it
      {:ok, _msg} =
        Chat.create_message(%{
          conversation_id: conv.id,
          user_id: user.id,
          role: "user",
          body: "Keep working on this"
        })

      # Bot sends sync_sessions omitting this session
      {:ok, _} =
        Chat.sync_bot_sessions(bot, [
          %{
            "session_id" => "other-sess",
            "title" => "Other Session",
            "status" => "idle"
          }
        ])

      # Because the session has user activity, it should NOT be archived
      refetched = Chat.get_conversation!(conv.id, [])
      assert refetched.status == "idle"
    end

    test "create_message syncs session config metadata from user message into conversation metadata",
         %{user: user, bot_token: bot} do
      {:ok, conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot.id,
          title: "New Planning Session",
          status: "idle",
          metadata: %{}
        })

      assert conv.metadata["agent_mode"] == nil

      # User submits first prompt with selected options
      {:ok, _msg} =
        Chat.create_message(%{
          conversation_id: conv.id,
          user_id: user.id,
          role: "user",
          body: "Plan the architecture",
          metadata: %{
            "agent_mode" => "plan",
            "use_worktree" => true,
            "base_branch" => "feature/v2",
            "agent_type" => "architect"
          }
        })

      # Conversation metadata is now updated with the user-selected options
      refetched = Chat.get_conversation!(conv.id, [])
      assert refetched.metadata["agent_mode"] == "plan"
      assert refetched.metadata["use_worktree"] == true
      assert refetched.metadata["base_branch"] == "feature/v2"
      assert refetched.metadata["agent_type"] == "architect"
    end

    test "steer message never updates use_worktree in conversation metadata and message metadata strips it",
         %{
           user: user,
           bot_token: bot
         } do
      {:ok, conv} =
        Chat.create_conversation(%{
          bot_token_id: bot.id,
          user_id: user.id,
          title: "Steering Worktree Guard Test",
          metadata: %{"use_worktree" => false, "agent_mode" => "interactive"}
        })

      {:ok, message} =
        Chat.create_message(%{
          conversation_id: conv.id,
          user_id: user.id,
          role: "user",
          body: "Focus on unit tests first",
          metadata: %{
            "is_steer" => true,
            "use_worktree" => true,
            "agent_mode" => "plan"
          }
        })

      refetched_msg = Chat.get_message!(message.id)
      assert refetched_msg.metadata["is_steer"] == true
      assert is_nil(refetched_msg.metadata["use_worktree"])

      refetched_conv = Chat.get_conversation!(conv.id, [])
      assert refetched_conv.metadata["use_worktree"] == false
      assert refetched_conv.metadata["agent_mode"] == "plan"
    end

    test "prunes older abandoned default generic sessions that have no user messages", %{
      bot_token: bot
    } do
      # 1. Simulate an older abandoned generic session created 10 minutes ago
      ten_mins_ago =
        DateTime.utc_now() |> DateTime.add(-600, :second) |> DateTime.truncate(:second)

      {:ok, old_conv} =
        Chat.create_conversation(%{
          bot_token_id: bot.id,
          user_id: bot.user_id,
          title: "morpheus-ui Session",
          status: "idle"
        })

      from(c in Messaging.Chat.Conversation, where: c.id == ^old_conv.id)
      |> Messaging.Repo.update_all(set: [inserted_at: ten_mins_ago, updated_at: ten_mins_ago])

      # 2. Simulate routine bot sync
      assert {:ok, _synced} =
               Chat.sync_bot_sessions(bot, [
                 %{
                   "session_id" => "active-session",
                   "title" => "Active Session",
                   "status" => "idle"
                 }
               ])

      # 3. The older empty generic session should be archived so only 1 new session remains
      refetched = Chat.get_conversation!(old_conv.id, [])
      assert refetched.status == "archived"
    end

    test "synchronizes nested sub-sessions preserving parent_session_id and nesting metadata",
         %{bot_token: bot} do
      sessions = [
        %{
          "session_id" => "parent-sess",
          "title" => "Root Task",
          "status" => "running"
        },
        %{
          "session_id" => "child-sess",
          "title" => "Sub-task Compilation",
          "parent_session_id" => "parent-sess",
          "nested" => true,
          "status" => "running",
          "metadata" => %{"step" => "mix compile"}
        }
      ]

      assert {:ok, synced} = Chat.sync_bot_sessions(bot, sessions)
      assert length(synced) == 2

      child = Enum.find(synced, &(&1.external_session_id == "child-sess"))
      assert child.metadata["parent_session_id"] == "parent-sess"
      assert child.metadata["nested"] == true
      assert child.metadata["step"] == "mix compile"
    end
  end

  describe "update_session_status/3" do
    test "updates session status and merges metadata", %{bot_token: bot, user: user} do
      {:ok, conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot.id,
          title: "Session Alpha",
          status: "idle",
          metadata: %{"tool" => "initial"}
        })

      assert {:ok, updated} =
               Chat.update_session_status(conv.id, "running", %{"step" => "running tests"})

      assert updated.status == "running"
      assert updated.metadata["tool"] == "initial"
      assert updated.metadata["step"] == "running tests"
    end

    test "does not unarchive an already archived session on routine idle status update", %{
      bot_token: bot,
      user: user
    } do
      {:ok, conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot.id,
          title: "Session To Archive",
          status: "idle"
        })

      assert {:ok, _} = Chat.archive_conversation(conv.id, user.id)

      assert {:ok, updated} =
               Chat.update_session_status(conv.id, "idle", %{"step" => "routine heartbeat"})

      assert updated.status == "archived"
      assert updated.metadata["step"] == "routine heartbeat"

      # But if session actively runs, it can wake up
      assert {:ok, running} =
               Chat.update_session_status(conv.id, "running", %{"step" => "woken by user prompt"})

      assert running.status == "running"
    end
  end

  describe "prompt queuing" do
    test "queue, pop, and remove queued prompts", %{bot_token: bot, user: user} do
      {:ok, conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot.id,
          title: "Session Queue",
          status: "running"
        })

      # Queue first prompt
      assert {:ok, p1, queue1} = Chat.queue_prompt(conv.id, "First queued task")
      assert length(queue1) == 1
      assert p1["body"] == "First queued task"

      # Queue second prompt
      assert {:ok, p2, queue2} =
               Chat.queue_prompt(conv.id, %{
                 "body" => "Second queued task",
                 "model" => "gpt-4o"
               })

      assert length(queue2) == 2
      assert p2["model"] == "gpt-4o"

      # Pop first prompt
      assert {:ok, popped, remaining} = Chat.pop_queued_prompt(conv.id)
      assert popped["id"] == p1["id"]
      assert length(remaining) == 1

      # Remove prompt by id
      assert {:ok, final_queue} = Chat.remove_queued_prompt(conv.id, p2["id"])
      assert final_queue == []
    end
  end

  describe "bot token regeneration" do
    test "regenerate_bot_token/1 generates new token and channel_code", %{bot_token: bot} do
      original_hash = bot.token_hash
      original_channel = bot.channel_code

      assert {:ok, regenerated} = Bots.regenerate_bot_token(bot)
      assert regenerated.id == bot.id
      assert regenerated.token != nil
      assert regenerated.token_hash != original_hash
      assert regenerated.channel_code != original_channel
    end
  end
end
