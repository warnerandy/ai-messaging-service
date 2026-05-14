defmodule MessagingWeb.API.BotTokenControllerTest do
  use MessagingWeb.ConnCase, async: true

  alias Messaging.Bots
  alias Messaging.AccountsFixtures

  describe "GET /api/bot-tokens" do
    setup :register_and_log_in_user

    test "returns all non-revoked bot tokens for the authenticated user", %{conn: conn, user: user} do
      other_user = AccountsFixtures.user_fixture()

      {:ok, bot_one} = Bots.create_bot_token(%{name: "alpha", user_id: user.id})
      {:ok, bot_two} = Bots.create_bot_token(%{name: "beta", user_id: user.id})
      {:ok, revoked_bot} = Bots.create_bot_token(%{name: "gamma", user_id: user.id})
      {:ok, _other_user_bot} = Bots.create_bot_token(%{name: "other-user", user_id: other_user.id})

      {:ok, _revoked} = Bots.revoke_bot_token(revoked_bot)

      response =
        conn
        |> get(~p"/api/bot-tokens")
        |> json_response(200)

      ids = Enum.map(response["bot_tokens"], & &1["id"])

      assert length(response["bot_tokens"]) == 2
      assert bot_one.id in ids
      assert bot_two.id in ids
      refute revoked_bot.id in ids
    end
  end
end
