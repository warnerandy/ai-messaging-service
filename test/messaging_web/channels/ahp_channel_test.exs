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

  test "ahp_event persists step, plan, and changeset in conversation metadata", %{
    bot_token: bot,
    bot_socket: bot_socket,
    user_socket: user_socket
  } do
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    ref =
      push(bot_channel, "sync_sessions", %{
        "sessions" => [
          %{
            "session_id" => "spec-task",
            "title" => "Spec Task",
            "status" => "running"
          }
        ]
      })

    assert_reply ref, :ok, %{sessions: [session]}
    conv_id = session.id

    {:ok, _, _user_channel} =
      subscribe_and_join(user_socket, ConversationChannel, "conversation:#{conv_id}", %{})

    # 1. Step event
    push(bot_channel, "ahp_event", %{
      "conversation_id" => conv_id,
      "event_type" => "step",
      "data" => %{"tool" => "read_file", "step" => "Reading mix.exs"}
    })

    assert_push "ahp_event", %{
      event_type: "step",
      data: %{"tool" => "read_file", "step" => "Reading mix.exs"}
    }

    updated = Messaging.Chat.get_conversation!(conv_id, [])
    assert updated.metadata["step"] == "Reading mix.exs"
    assert updated.metadata["tool"] == "read_file"

    # 2. Plan event
    push(bot_channel, "ahp_event", %{
      "conversation_id" => conv_id,
      "event_type" => "plan",
      "data" => %{"steps" => ["Init", "Build", "Deploy"]}
    })

    assert_push "ahp_event", %{
      event_type: "plan",
      data: %{"steps" => ["Init", "Build", "Deploy"]}
    }

    updated = Messaging.Chat.get_conversation!(conv_id, [])
    assert updated.metadata["plan"]["steps"] == ["Init", "Build", "Deploy"]

    # 3. Changeset event
    push(bot_channel, "ahp_event", %{
      "conversation_id" => conv_id,
      "event_type" => "changeset",
      "data" => %{"files" => ["lib/app.ex", "test/app_test.exs"]}
    })

    assert_push "ahp_event", %{
      event_type: "changeset",
      data: %{"files" => ["lib/app.ex", "test/app_test.exs"]}
    }

    updated = Messaging.Chat.get_conversation!(conv_id, [])
    assert updated.metadata["changeset"]["files"] == ["lib/app.ex", "test/app_test.exs"]
  end

  test "creating a conversation in AIMS broadcasts create_session and request_session_sync to bot with UUID",
       %{
         user: user,
         bot_token: bot,
         bot_socket: bot_socket
       } do
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    {:ok, conv} =
      Messaging.Chat.create_conversation(%{
        user_id: user.id,
        bot_token_id: bot.id,
        title: "Project Alpha Session",
        metadata: %{
          "project" => %{
            "name" => "aims",
            "path" => "/home/user/aims"
          }
        }
      })

    assert is_binary(conv.external_session_id)
    assert conv.external_session_id != ""

    # Bot receives create_session
    assert_push "create_session", %{
      "conversation_id" => conv_id,
      "session_id" => session_id,
      "external_session_id" => session_id,
      "title" => "Project Alpha Session",
      "metadata" => %{
        "project" => %{
          "name" => "aims",
          "path" => "/home/user/aims"
        }
      }
    }

    assert conv_id == conv.id
    assert session_id == conv.external_session_id

    # Bot also receives request_session_sync
    assert_push "request_session_sync", %{
      "conversation_id" => ^conv_id,
      "session_id" => ^session_id,
      "external_session_id" => ^session_id
    }

    # User sends a message via Chat context (as REST API does)
    {:ok, _message} =
      Messaging.Chat.create_message(%{
        conversation_id: conv.id,
        user_id: user.id,
        role: "user",
        body: "Let's review the integration file"
      })

    # Bot receives new_message containing session_id and metadata
    assert_push "new_message", %{
      message: %{
        body: "Let's review the integration file"
      },
      conversation_id: ^conv_id,
      session_id: ^session_id,
      external_session_id: ^session_id,
      conversation_title: "Project Alpha Session",
      conversation_metadata: %{
        "project" => %{
          "name" => "aims",
          "path" => "/home/user/aims"
        }
      }
    }

    # Bot reports sync_sessions with its own known sessions (which doesn't include the new UUID yet)
    ref_sync =
      push(bot_channel, "sync_sessions", %{
        "sessions" => [
          %{
            "session_id" => "other-existing-session",
            "title" => "Other Existing Task",
            "status" => "idle"
          }
        ]
      })

    assert_reply ref_sync, :ok, _

    # The newly created session in Project Alpha MUST NOT be archived
    refetched = Messaging.Chat.get_conversation!(conv_id, [])
    assert refetched.status == "idle"
    assert refetched.status != "archived"

    # Bot sends status running for the user session
    ref_status =
      push(bot_channel, "session_status", %{
        "conversation_id" => conv_id,
        "status" => "running",
        "metadata" => %{"step" => "Reviewing files"}
      })

    assert_reply ref_status, :ok

    refetched2 = Messaging.Chat.get_conversation!(conv_id, [])
    assert refetched2.status == "running"
    assert refetched2.status != "archived"
  end

  test "syncs agent mode, use_worktree, base_branch, and agent_types bidirectionally", %{
    user: user,
    bot_token: bot,
    bot_socket: bot_socket,
    user_socket: user_socket
  } do
    # 1. Join bot channel
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    # 2. Create conversation
    {:ok, conv} =
      Messaging.Chat.create_conversation(%{
        user_id: user.id,
        bot_token_id: bot.id,
        title: "Agent Mode Test",
        external_session_id: "agent-mode-sess",
        metadata: %{
          "base_branch" => "main",
          "agent_mode" => "interactive"
        }
      })

    # 3. Join user conversation channel
    {:ok, _, user_channel} =
      subscribe_and_join(user_socket, ConversationChannel, "conversation:#{conv.id}", %{})

    # Clear initial sync push
    assert_push "request_session_sync", _

    # 4. User updates session configuration: mode to 'plan', worktree to true, branch to 'feature/v2', agent_type to 'architect'
    ref =
      push(user_channel, "update_session_config", %{
        "agent_mode" => "plan",
        "use_worktree" => true,
        "base_branch" => "feature/v2",
        "agent_type" => "architect",
        "agent_types" => ["workspace", "coder", "architect"]
      })

    assert_reply ref, :ok, %{metadata: updated_meta}
    assert updated_meta["agent_mode"] == "plan"
    assert updated_meta["use_worktree"] == true
    assert updated_meta["base_branch"] == "feature/v2"
    assert updated_meta["agent_type"] == "architect"
    assert updated_meta["agent_types"] == ["workspace", "coder", "architect"]

    # 5. Bot channel receives session_config_changed push
    assert_push "session_config_changed", %{
      "conversation_id" => conv_id,
      "metadata" => bot_received_meta
    }

    assert conv_id == conv.id
    assert bot_received_meta["agent_mode"] == "plan"
    assert bot_received_meta["use_worktree"] == true
    assert bot_received_meta["base_branch"] == "feature/v2"

    # 6. Bot updates session config from VS Code side via session_status
    push(bot_channel, "session_status", %{
      "conversation_id" => conv.id,
      "status" => "running",
      "agent_mode" => "autopilot",
      "use_worktree" => false,
      "base_branch" => "main",
      "agent_type" => "coder"
    })

    # 7. User channel receives session_status_changed with the new mode and branch
    assert_push "session_status_changed", %{
      status: "running",
      metadata: status_meta
    }

    assert status_meta["agent_mode"] == "autopilot"
    assert status_meta["use_worktree"] == false
    assert status_meta["base_branch"] == "main"
    assert status_meta["agent_type"] == "coder"
  end

  test "syncs agent_roles and capabilities via sync_sessions, update_capabilities, and session_status",
       %{
         user: user,
         bot_token: bot,
         bot_socket: bot_socket,
         user_socket: user_socket
       } do
    {:ok, _, bot_channel} =
      subscribe_and_join(bot_socket, BotChannel, "bot:#{bot.channel_code}", %{})

    # 1. Bot pushes sync_sessions with top-level agent_roles and capabilities
    ref =
      push(bot_channel, "sync_sessions", %{
        "agent_roles" => [
          %{"id" => "sec_auditor", "label" => "Security Auditor"},
          %{"id" => "db_admin", "label" => "Database Specialist"}
        ],
        "worktree_supported" => true,
        "sessions" => [
          %{
            "session_id" => "sess-cap-test",
            "title" => "Capabilities Test Session",
            "status" => "idle"
          }
        ]
      })

    assert_reply ref, :ok, %{sessions: _sessions, metadata: updated_bot_meta}

    assert_push "create_session", %{"session_id" => "sess-cap-test"}
    assert_push "request_session_sync", %{"session_id" => "sess-cap-test"}

    assert updated_bot_meta["agent_roles"] == [
             %{"id" => "sec_auditor", "label" => "Security Auditor"},
             %{"id" => "db_admin", "label" => "Database Specialist"}
           ]

    assert updated_bot_meta["worktree_supported"] == true

    # 2. Join bot_sessions channel to verify it receives bot metadata
    {:ok, resp, _sessions_channel} =
      subscribe_and_join(
        user_socket,
        MessagingWeb.BotSessionsChannel,
        "bot_sessions:#{bot.id}",
        %{}
      )

    assert resp.bot.metadata["agent_roles"] == [
             %{"id" => "sec_auditor", "label" => "Security Auditor"},
             %{"id" => "db_admin", "label" => "Database Specialist"}
           ]

    # 3. Bot pushes update_capabilities event
    ref2 =
      push(bot_channel, "update_capabilities", %{
        "capabilities" => %{
          "agent_roles" => [
            %{"id" => "devops", "label" => "DevOps Engineer"}
          ],
          "modes" => ["interactive", "plan", "autopilot"]
        }
      })

    assert_reply ref2, :ok, %{metadata: cap_meta}

    assert cap_meta["capabilities"]["agent_roles"] == [
             %{"id" => "devops", "label" => "DevOps Engineer"}
           ]

    # 4. Create a new conversation and verify it inherits bot capabilities and transmits them in create_session push
    {:ok, new_conv} =
      Messaging.Chat.create_conversation(%{
        user_id: user.id,
        bot_token_id: bot.id,
        title: "New Session Capabilities Test"
      })

    assert new_conv.metadata["agent_roles"] != nil

    new_conv_id = new_conv.id

    assert_push "create_session", %{
      "conversation_id" => ^new_conv_id,
      "agent_roles" => pushed_roles
    }

    assert is_list(pushed_roles)
    assert length(pushed_roles) > 0
  end
end
