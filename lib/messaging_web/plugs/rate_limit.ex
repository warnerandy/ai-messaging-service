defmodule MessagingWeb.Plugs.RateLimit do
  @moduledoc false

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, opts) do
    scope = Keyword.fetch!(opts, :scope)
    limit = Keyword.fetch!(opts, :limit)
    window_ms = Keyword.fetch!(opts, :window_ms)
    identifier = rate_limit_identifier(conn)

    case Messaging.RateLimiter.allow?(scope, identifier, limit, window_ms) do
      :ok ->
        conn

      {:error, retry_ms} ->
        retry_after_seconds = retry_ms |> div(1000) |> max(1)

        conn
        |> put_resp_header("retry-after", Integer.to_string(retry_after_seconds))
        |> put_status(:too_many_requests)
        |> Phoenix.Controller.json(%{error: "Too many requests"})
        |> halt()
    end
  end

  defp rate_limit_identifier(conn) do
    ip =
      conn.remote_ip
      |> Tuple.to_list()
      |> Enum.join(".")

    "#{ip}:#{conn.request_path}"
  end
end
