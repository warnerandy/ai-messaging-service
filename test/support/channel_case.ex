defmodule MessagingWeb.ChannelCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      # Import conveniences for testing with channels
      import Phoenix.ChannelTest
      import MessagingWeb.ChannelCase

      # The default endpoint for testing
      @endpoint MessagingWeb.Endpoint
    end
  end

  setup tags do
    Messaging.DataCase.setup_sandbox(tags)
    :ok
  end
end
