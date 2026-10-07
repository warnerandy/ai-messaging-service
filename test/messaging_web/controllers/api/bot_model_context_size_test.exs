defmodule MessagingWeb.API.BotModelContextSizeTest do
  use MessagingWeb.ConnCase, async: true

  alias Messaging.Bots
  alias Messaging.Chat
  alias Messaging.AccountsFixtures

  describe "bot models and message context sizes" do
    setup :register_and_log_in_user

    test "bot sets models with context_sizes and user retrieves and sends messages with context_size",
         %{conn: conn, user: user} do
      # 1. Create a bot token
      {:ok, bot_token} = Bots.create_bot_token(%{name: "ai-assistant", user_id: user.id})

      # 2. Bot sets available models with context_sizes via PUT /api/bot/models
      bot_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer #{bot_token.token}")
        |> put(~p"/api/bot/models", %{
          "models" => [
            %{
              "name" => "gpt-4o",
              "input_cost_per_token" => "0.000005",
              "output_cost_per_token" => "0.000015",
              "context_sizes" => [4096, 8192, 16384, 32768, 128000]
            },
            %{
              "name" => "gpt-4o-mini",
              "input_cost_per_token" => "0.00000015",
              "output_cost_per_token" => "0.0000006",
              "context_sizes" => [4096, 8192, 16384]
            }
          ]
        })

      bot_res = json_response(bot_conn, 200)
      assert length(bot_res["models"]) == 2
      gpt4o = Enum.find(bot_res["models"], &(&1["name"] == "gpt-4o"))
      assert gpt4o["context_sizes"] == [4096, 8192, 16384, 32768, 128000]

      # 3. User lists models for this bot token via GET /api/bot-tokens/:id/models
      user_models_res =
        conn
        |> get(~p"/api/bot-tokens/#{bot_token.id}/models")
        |> json_response(200)

      assert length(user_models_res["models"]) == 2
      listed_gpt4o = Enum.find(user_models_res["models"], &(&1["name"] == "gpt-4o"))
      assert listed_gpt4o["context_sizes"] == [4096, 8192, 16384, 32768, 128000]

      # 4. User creates a conversation
      {:ok, conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot_token.id,
          title: "Test Conversation"
        })

      # 5. User sends a message with model and context_size via POST /api/conversations/:id/messages
      msg_res =
        conn
        |> post(~p"/api/conversations/#{conv.id}/messages", %{
          "body" => "Summarize this document",
          "model" => "gpt-4o",
          "context_size" => 32768
        })
        |> json_response(201)

      assert msg_res["model"] == "gpt-4o"
      assert msg_res["context_size"] == 32768

      # 6. User views conversation messages via GET /api/conversations/:id
      conv_res =
        conn
        |> get(~p"/api/conversations/#{conv.id}")
        |> json_response(200)

      assert length(conv_res["messages"]) == 1
      [msg] = conv_res["messages"]
      assert msg["model"] == "gpt-4o"
      assert msg["context_size"] == 32768

      # 7. Bot lists pending messages via GET /api/bot/messages
      pending_res =
        build_conn()
        |> put_req_header("authorization", "Bearer #{bot_token.token}")
        |> get(~p"/api/bot/messages")
        |> json_response(200)

      assert length(pending_res["messages"]) == 1
      [pending_msg] = pending_res["messages"]
      assert pending_msg["model"] == "gpt-4o"
      assert pending_msg["context_size"] == 32768

      # 8. Verify list_conversations sorts conversation with newest message to top
      {:ok, older_conv} =
        Chat.create_conversation(%{
          user_id: user.id,
          bot_token_id: bot_token.id,
          title: "Older Conversation"
        })

      # Send message to older_conv to bump its updated_at
      {:ok, _} =
        Chat.create_message(%{
          role: "user",
          content_type: "text",
          body: "Bumping older conversation",
          conversation_id: older_conv.id
        })

      all_convs = Chat.list_conversations(user.id)
      assert hd(all_convs).id == older_conv.id
    end
  end
end
