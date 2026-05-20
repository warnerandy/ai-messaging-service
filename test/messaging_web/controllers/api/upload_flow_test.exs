defmodule MessagingWeb.API.UploadFlowTest do
  use MessagingWeb.ConnCase, async: true

  @upload_root Application.app_dir(:messaging, "priv/static/uploads")

  describe "user upload flow to bot" do
    setup :register_and_log_in_user

    test "user can upload an asset and bot can read it as a file message", %{conn: conn} do
      bot_response =
        conn
        |> post(~p"/api/bot-tokens", %{"name" => "Upload Flow Bot"})
        |> json_response(:created)

      conversation_response =
        conn
        |> post(~p"/api/conversations", %{"bot_token_id" => bot_response["id"]})
        |> json_response(:created)

      conversation_id = conversation_response["id"]
      bot_token = bot_response["token"]

      temp_file_path =
        Path.join(System.tmp_dir!(), "upload-flow-#{System.unique_integer([:positive])}.png")

      file_contents = "upload flow fixture"
      :ok = File.write(temp_file_path, file_contents)

      on_exit(fn ->
        File.rm(temp_file_path)
        File.rm_rf(Path.join(@upload_root, Integer.to_string(conversation_id)))
      end)

      upload = %Plug.Upload{
        path: temp_file_path,
        filename: "upload-flow.png",
        content_type: "image/png"
      }

      upload_response =
        conn
        |> post(~p"/api/conversations/#{conversation_id}/assets", %{"file" => upload})
        |> json_response(:created)

      assert upload_response["filename"] == "upload-flow.png"
      assert upload_response["content_type"] == "image/png"
      assert upload_response["url"] =~ "/uploads/#{conversation_id}/upload-flow-"
      assert upload_response["url"] =~ "token="

      message_response =
        conn
        |> post(~p"/api/conversations/#{conversation_id}/messages", %{
          "asset_url" => upload_response["url"],
          "asset_type" => "file",
          "asset_filename" => upload_response["filename"]
        })
        |> json_response(:created)

      assert message_response["role"] == "user"
      assert message_response["content_type"] == "file"
      assert message_response["body"] == nil
      assert message_response["metadata"]["filename"] == "upload-flow.png"
      assert message_response["metadata"]["url"] == upload_response["url"]

      bot_conn =
        Phoenix.ConnTest.build_conn()
        |> put_req_header("authorization", "Bearer #{bot_token}")

      pending_messages =
        bot_conn
        |> get(~p"/api/bot/messages")
        |> json_response(:ok)
        |> Map.fetch!("messages")

      file_message =
        Enum.find(pending_messages, fn message ->
          message["conversation_id"] == conversation_id and
            message["content_type"] == "file" and
            message["metadata"]["filename"] == "upload-flow.png"
        end)

      assert file_message
      assert file_message["metadata"]["url"] == upload_response["url"]
      assert file_message["body"] == nil
    end

    test "bot can upload an asset and user can retrieve it for display", %{conn: conn} do
      bot_response =
        conn
        |> post(~p"/api/bot-tokens", %{"name" => "Bot Asset Flow"})
        |> json_response(:created)

      conversation_response =
        conn
        |> post(~p"/api/conversations", %{"bot_token_id" => bot_response["id"]})
        |> json_response(:created)

      conversation_id = conversation_response["id"]
      bot_token = bot_response["token"]

      temp_file_path =
        Path.join(System.tmp_dir!(), "bot-upload-flow-#{System.unique_integer([:positive])}.png")

      file_contents = "bot upload fixture"
      :ok = File.write(temp_file_path, file_contents)

      on_exit(fn ->
        File.rm(temp_file_path)
        File.rm_rf(Path.join(@upload_root, Integer.to_string(conversation_id)))
      end)

      upload = %Plug.Upload{
        path: temp_file_path,
        filename: "bot-upload.png",
        content_type: "image/png"
      }

      bot_conn =
        Phoenix.ConnTest.build_conn()
        |> put_req_header("authorization", "Bearer #{bot_token}")

      upload_response =
        bot_conn
        |> post(~p"/api/bot/conversations/#{conversation_id}/assets", %{"file" => upload})
        |> json_response(:created)

      assert upload_response["filename"] == "bot-upload.png"
      assert upload_response["content_type"] == "image/png"
      assert upload_response["url"] =~ "/uploads/#{conversation_id}/bot-upload-"
      assert upload_response["url"] =~ "token="

      bot_message_response =
        bot_conn
        |> post(~p"/api/bot/messages", %{
          "conversation_id" => conversation_id,
          "content_type" => "file",
          "metadata" => %{
            "url" => upload_response["url"],
            "filename" => upload_response["filename"]
          }
        })
        |> json_response(:created)

      assert bot_message_response["content_type"] == "file"
      assert bot_message_response["body"] == nil
      assert bot_message_response["metadata"]["url"] == upload_response["url"]
      assert bot_message_response["metadata"]["filename"] == "bot-upload.png"

      conversation_show_response =
        conn
        |> get(~p"/api/conversations/#{conversation_id}")
        |> json_response(:ok)

      file_message =
        Enum.find(conversation_show_response["messages"], fn message ->
          message["role"] == "bot" and
            message["content_type"] == "file" and
            message["metadata"]["filename"] == "bot-upload.png"
        end)

      assert file_message
      assert file_message["metadata"]["url"] == upload_response["url"]
      assert file_message["body"] == nil
    end

    test "is_suggestion persists for user text messages across bot and conversation reloads", %{
      conn: conn
    } do
      bot_response =
        conn
        |> post(~p"/api/bot-tokens", %{"name" => "Suggestion Flag Bot"})
        |> json_response(:created)

      conversation_response =
        conn
        |> post(~p"/api/conversations", %{"bot_token_id" => bot_response["id"]})
        |> json_response(:created)

      conversation_id = conversation_response["id"]
      bot_token = bot_response["token"]

      message_response =
        conn
        |> post(~p"/api/conversations/#{conversation_id}/messages", %{
          "body" => "From suggestion chip",
          "is_suggestion" => true
        })
        |> json_response(:created)

      assert message_response["is_suggestion"] == true

      conversation_show_response =
        conn
        |> get(~p"/api/conversations/#{conversation_id}")
        |> json_response(:ok)

      suggested_message =
        Enum.find(conversation_show_response["messages"], fn message ->
          message["id"] == message_response["id"]
        end)

      assert suggested_message
      assert suggested_message["is_suggestion"] == true

      bot_conn =
        Phoenix.ConnTest.build_conn()
        |> put_req_header("authorization", "Bearer #{bot_token}")

      pending_messages =
        bot_conn
        |> get(~p"/api/bot/messages")
        |> json_response(:ok)
        |> Map.fetch!("messages")

      bot_pending =
        Enum.find(pending_messages, fn message ->
          message["id"] == message_response["id"]
        end)

      assert bot_pending
      assert bot_pending["is_suggestion"] == true
    end
  end
end
