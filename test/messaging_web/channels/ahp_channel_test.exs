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

    # Bot receives request_session_sync upon user joining
    assert_push "request_session_sync", %{
      "conversation_id" => ^conv_id,
      "external_session_id" => "subchat-1"
    }

    # User can also explicitly request a session sync
    push(user_channel, "sync_session", %{})

    assert_push "request_session_sync", %{
      "conversation_id" => ^conv_id,
      "external_session_id" => "subchat-1"
    }

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

    # Verify conversation status is updated to waiting_for_input and question is saved in metadata
    updated_conv = Messaging.Chat.get_conversation!(conv_id, [])
    assert updated_conv.status == "waiting_for_input"
    assert updated_conv.metadata["question"]["id"] == "q-1"

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

    # 10. Bot sends final message using session_id (AHP external session ID)
    push(bot_channel, "send_message", %{
      "session_id" => "subchat-1",
      "body" => "Documentation has been generated successfully."
    })

    # User channel receives new_message
    assert_push "new_message", %{
      message: %{
        body: "Documentation has been generated successfully.",
        role: "bot",
        conversation_id: ^conv_id
      }
    }

    # 11. Bot sends completion message via ahp_event response
    push(bot_channel, "ahp_event", %{
      "session_id" => "subchat-1",
      "event_type" => "response",
      "data" => %{"body" => "Turn complete. All files updated."}
    })

    assert_push "new_message", %{
      message: %{
        body: "Turn complete. All files updated.",
        role: "bot",
        conversation_id: ^conv_id
      }
    }
  end

  test "sync_sessions serializes parent_session_id for nested sessions", %{
    bot_token: bot,
    bot_socket: bot_socket
  } do
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    ref =
      push(bot_channel, "sync_sessions", %{
        "sessions" => [
          %{
            "session_id" => "parent-task",
            "title" => "Parent Orchestrator",
            "status" => "running"
          },
          %{
            "session_id" => "child-task",
            "title" => "Child Sub-task",
            "parent_session_id" => "parent-task",
            "status" => "running"
          }
        ]
      })

    assert_reply ref, :ok, %{sessions: sessions}
    assert length(sessions) == 2

    child = Enum.find(sessions, &(&1.external_session_id == "child-task"))
    assert child.parent_session_id == "parent-task"
  end
end
