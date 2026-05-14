defmodule MessagingWeb.BotAPI.ModelController do
  use MessagingWeb, :controller

  alias Messaging.Bots

  # PUT /api/bot/models - Bot sets its available models
  def update(conn, %{"models" => models}) when is_list(models) do
    bot_token = conn.assigns.bot_token

    model_attrs =
      Enum.map(models, fn m ->
        %{
          name: m["name"],
          input_cost_per_token: m["input_cost_per_token"],
          output_cost_per_token: m["output_cost_per_token"]
        }
      end)

    case Bots.set_bot_models(bot_token, model_attrs) do
      {:ok, saved_models} ->
        json(conn, %{models: Enum.map(saved_models, &model_json/1)})

      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Failed to set models"})
    end
  end

  def update(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Expected a 'models' array"})
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
