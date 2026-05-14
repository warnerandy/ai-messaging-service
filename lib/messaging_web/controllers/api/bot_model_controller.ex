defmodule MessagingWeb.API.BotModelController do
  use MessagingWeb, :controller

  alias Messaging.Bots

  # GET /api/bot-tokens/:bot_token_id/models - List models for a bot
  def index(conn, %{"bot_token_id" => bot_token_id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(bot_token_id)

    if bot_token.user_id != user.id do
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
    else
      models = Bots.list_bot_models(bot_token.id)
      json(conn, %{models: Enum.map(models, &model_json/1)})
    end
  end

  # POST /api/bot-tokens/:bot_token_id/refresh-models - Request a specific bot to update models
  def refresh(conn, %{"bot_token_id" => bot_token_id}) do
    user = conn.assigns.current_user
    bot_token = Bots.get_bot_token!(bot_token_id)

    if bot_token.user_id != user.id do
      conn |> put_status(:not_found) |> json(%{error: "Not found"})
    else
      Bots.request_model_refresh(bot_token)
      json(conn, %{status: "refresh_requested", bot_token_id: bot_token.id})
    end
  end

  # POST /api/bot-tokens/refresh-models - Request ALL user's bots to update models
  def refresh_all(conn, _params) do
    user = conn.assigns.current_user
    Bots.request_all_models_refresh(user.id)
    json(conn, %{status: "refresh_requested_all"})
  end

  defp model_json(m) do
    %{
      id: m.id,
      name: m.name,
      input_cost_per_token: Decimal.to_string(m.input_cost_per_token),
      output_cost_per_token: Decimal.to_string(m.output_cost_per_token)
    }
  end
end
