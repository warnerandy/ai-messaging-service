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
