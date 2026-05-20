defmodule Messaging.RateLimiter do
  @moduledoc false
  use GenServer

  @table __MODULE__
  @cleanup_interval_ms :timer.minutes(5)

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def allow?(scope, identifier, limit, window_ms)
      when is_atom(scope) and is_binary(identifier) and is_integer(limit) and limit > 0 and
             is_integer(window_ms) and window_ms > 0 do
    now = System.monotonic_time(:millisecond)
    window_start = div(now, window_ms) * window_ms
    expires_at = window_start + window_ms
    key = {scope, identifier, window_start}

    count = :ets.update_counter(@table, key, {2, 1}, {key, 0, expires_at})

    if count <= limit do
      :ok
    else
      {:error, max(0, expires_at - now)}
    end
  end

  @impl true
  def init(state) do
    :ets.new(@table, [
      :named_table,
      :public,
      :set,
      write_concurrency: true,
      read_concurrency: true
    ])

    schedule_cleanup()
    {:ok, state}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)
    :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}])
    schedule_cleanup()
    {:noreply, state}
  end

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, @cleanup_interval_ms)
  end
end
