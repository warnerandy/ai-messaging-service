defmodule MessagingWeb.AhpChannelTest do
  use MessagingWeb.ChannelCase

  alias Messaging.{Accounts, AccountsFixtures, Bots}
  alias MessagingWeb.{BotChannel, BotSocket, ConversationChannel, UserSocket}

  setup do
    user = AccountsFixtures.user_fixture()

    {:ok, bot_token} =
      Bots.create_bot_token(%{
        name: "test-ahp-agent",
        user_id: user.id,
        bot_type: "ahp"
      })

    user_token = Accounts.generate_user_session_token(user)
    encoded_user_token = Base.url_encode64(user_token, padding: false)

    {:ok, bot_socket} =
      connect(BotSocket, %{"token" => bot_token.token})

    {:ok, user_socket} =
      connect(UserSocket, %{"token" => encoded_user_token})

    %{
      user: user,
      bot_token: bot_token,
      bot_socket: bot_socket,
      user_socket: user_socket
    }
  end

  test "sync_sessions creates conversations and allows user to interact", %{
    bot_token: bot,
    bot_socket: bot_socket,
    user_socket: user_socket
  } do
    # 1. Join bot channel
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    # 2. Bot syncs sessions
    ref =
      push(bot_channel, "sync_sessions", %{
        "sessions" => [
          %{
            "session_id" => "subchat-1",
            "title" => "Code Refactoring",
            "status" => "running",
            "metadata" => %{"step" => "init"}
          }
        ]
      })

    assert_reply ref, :ok, %{sessions: [created_session]}
    assert created_session.external_session_id == "subchat-1"
    assert created_session.status == "running"

    conv_id = created_session.id

    # 3. User joins the subchat's conversation channel
    {:ok, join_reply, user_channel} =
      subscribe_and_join(user_socket, ConversationChannel, "conversation:#{conv_id}", %{})

    assert join_reply.status == "running"
    assert join_reply.external_session_id == "subchat-1"

    # 4. Bot pushes an ahp_event (thinking stream)
    push(bot_channel, "ahp_event", %{
      "conversation_id" => conv_id,
      "event_type" => "thinking",
      "data" => %{"chunk" => "Analyzing code syntax..."}
    })

    assert_push "ahp_event", %{
      event_type: "thinking",
      data: %{"chunk" => "Analyzing code syntax..."}
    }

    # 5. Bot pushes an ahp_event (question approval)
    push(bot_channel, "ahp_event", %{
      "conversation_id" => conv_id,
      "event_type" => "question",
      "data" => %{
        "id" => "q-1",
        "title" => "Allow file rewrite?",
        "options" => ["Approve", "Deny"]
      }
    })

    assert_push "ahp_event", %{
      event_type: "question",
      data: %{"id" => "q-1", "title" => "Allow file rewrite?"}
    }

    # 6. User answers question
    push(user_channel, "answer_question", %{
      "question_id" => "q-1",
      "answer" => "Approve",
      "approved" => true
    })

    # Bot receives user's answer
    assert_push "answer_question", %{
      "question_id" => "q-1",
      "answer" => "Approve",
      "approved" => true,
      "conversation_id" => ^conv_id
    }

    # 7. User sends a steering command
    push(user_channel, "steer", %{
      "action" => "steer",
      "instruction" => "Target only lib/chat.ex"
    })

    assert_push "steer_agent", %{
      "action" => "steer",
      "instruction" => "Target only lib/chat.ex",
      "conversation_id" => ^conv_id
    }

    # 8. User queues a prompt
    ref_queue =
      push(user_channel, "queue_prompt", %{
        "body" => "Next task: write documentation"
      })

    assert_reply ref_queue, :ok, %{queue: [queued_item]}
    assert queued_item["body"] == "Next task: write documentation"

    # 9. Bot reports status idle -> triggers prompt dispatch
    push(bot_channel, "session_status", %{
      "conversation_id" => conv_id,
      "status" => "idle"
    })

    assert_push "execute_queued_prompt", %{
      conversation_id: ^conv_id,
      prompt: %{"body" => "Next task: write documentation"}
    }
  end
end
