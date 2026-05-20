defmodule MessagingWeb.API.MessageTimeoutTest do
  use MessagingWeb.ConnCase, async: true

  setup :register_and_log_in_user

  test "creates a persisted system timeout message for acknowledged user messages", %{conn: conn} do
    bot_response =
      conn
      |> post(~p"/api/bot-tokens", %{"name" => "Timeout Bot"})
      |> json_response(:created)

    conversation_response =
      conn
      |> post(~p"/api/conversations", %{"bot_token_id" => bot_response["id"]})
      |> json_response(:created)

    conversation_id = conversation_response["id"]

    user_message =
      conn
      |> post(~p"/api/conversations/#{conversation_id}/messages", %{"body" => "Hello?"})
      |> json_response(:created)

    bot_conn =
      Phoenix.ConnTest.build_conn()
      |> put_req_header("authorization", "Bearer #{bot_response["token"]}")

    _ack =
      bot_conn
      |> put(~p"/api/bot/messages/#{user_message["id"]}/acknowledge", %{
        "conversation_id" => conversation_id
      })
      |> json_response(:ok)

    timeout_message =
      conn
      |> post(~p"/api/conversations/#{conversation_id}/messages/timeout", %{
        "message_id" => user_message["id"]
      })
      |> json_response(:created)

    assert timeout_message["role"] == "system"
    assert timeout_message["body"] == "The bot failed to respond."
    assert timeout_message["metadata"]["kind"] == "bot_timeout"
    assert timeout_message["metadata"]["timeout_for_message_id"] == user_message["id"]

    conversation =
      conn
      |> get(~p"/api/conversations/#{conversation_id}")
      |> json_response(:ok)

    assert Enum.any?(conversation["messages"], &(&1["id"] == timeout_message["id"]))
  end

  test "returns conflict if bot already replied", %{conn: conn} do
    bot_response =
      conn
      |> post(~p"/api/bot-tokens", %{"name" => "Timeout Bot"})
      |> json_response(:created)

    conversation_response =
      conn
      |> post(~p"/api/conversations", %{"bot_token_id" => bot_response["id"]})
      |> json_response(:created)

    conversation_id = conversation_response["id"]

    user_message =
      conn
      |> post(~p"/api/conversations/#{conversation_id}/messages", %{"body" => "Hello?"})
      |> json_response(:created)

    bot_conn =
      Phoenix.ConnTest.build_conn()
      |> put_req_header("authorization", "Bearer #{bot_response["token"]}")

    _ack =
      bot_conn
      |> put(~p"/api/bot/messages/#{user_message["id"]}/acknowledge", %{
        "conversation_id" => conversation_id
      })
      |> json_response(:ok)

    _reply =
      bot_conn
      |> post(~p"/api/bot/messages", %{
        "conversation_id" => conversation_id,
        "body" => "Reply arrived",
        "content_type" => "text"
      })
      |> json_response(:created)

    conflict_response =
      conn
      |> post(~p"/api/conversations/#{conversation_id}/messages/timeout", %{
        "message_id" => user_message["id"]
      })
      |> json_response(:conflict)

    assert conflict_response["error"] == "Bot has already responded"
  end
end
