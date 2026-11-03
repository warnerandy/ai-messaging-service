defmodule MessagingWeb.BotAPI.StatusController do
  use MessagingWeb, :controller

  alias Messaging.Bots

  # PUT /api/bot/status - Bot updates its working status and/or capabilities
  def update(conn, params) when is_map(params) do
    bot_token = conn.assigns.bot_token
    is_working = params["is_working"]

    extra_meta =
      params
      |> Map.take([
        "capabilities",
        "agent_roles",
        "agentRoles",
        "agent_types",
        "agentTypes",
        "roles",
        "modes",
        "agent_modes",
        "branches",
        "available_branches",
        "worktree_supported"
      ])
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    raw_meta = params["metadata"] || %{}
    data_meta = if is_map(raw_meta), do: Map.merge(raw_meta, extra_meta), else: extra_meta

    attrs = %{}
    attrs = if is_boolean(is_working), do: Map.put(attrs, :is_working, is_working), else: attrs

    attrs =
      if map_size(data_meta) > 0 do
        Map.put(attrs, :metadata, Map.merge(bot_token.metadata || %{}, data_meta))
      else
        attrs
      end

    case Bots.update_bot_status(bot_token, attrs) do
      {:ok, updated} ->
        json(conn, %{
          is_connected: updated.is_connected,
          is_working: updated.is_working,
          metadata: updated.metadata
        })

      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Failed to update status"})
    end
  end

  # PUT /api/bot/capabilities or POST /api/bot/capabilities
  def update_capabilities(conn, params) when is_map(params) do
    bot_token = conn.assigns.bot_token

    extra_meta =
      params
      |> Map.take([
        "capabilities",
        "agent_roles",
        "agentRoles",
        "agent_types",
        "agentTypes",
        "roles",
        "modes",
        "agent_modes",
        "branches",
        "available_branches",
        "worktree_supported"
      ])
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    raw_meta = params["metadata"] || params["capabilities"] || params
    data_meta = if is_map(raw_meta), do: Map.merge(raw_meta, extra_meta), else: extra_meta
    merged = Map.merge(bot_token.metadata || %{}, data_meta)

    case Bots.update_bot_status(bot_token, %{metadata: merged}) do
      {:ok, updated} ->
        json(conn, %{metadata: updated.metadata})

      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Failed to update capabilities"})
    end
  end
end
