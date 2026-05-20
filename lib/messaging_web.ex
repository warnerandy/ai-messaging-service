defmodule MessagingWeb do
  @moduledoc """
  The entrypoint for defining your web interface, such
  as controllers, channels, and so on.
  """

  def static_paths,
    do:
      ~w(assets fonts images favicon.ico robots.txt manifest.webmanifest sw.js index.html suggestion-preview.html botamus-prime-192.svg botamus-prime-512.svg botamus-prime-192.png botamus-prime-512.png botamus-prime-1024.png)

  def router do
    quote do
      use Phoenix.Router, helpers: false

      import Plug.Conn
      import Phoenix.Controller
    end
  end

  def channel do
    quote do
      use Phoenix.Channel
    end
  end

  def controller do
    quote do
      use Phoenix.Controller, formats: [:json]

      import Plug.Conn

      unquote(verified_routes())
    end
  end

  def verified_routes do
    quote do
      use Phoenix.VerifiedRoutes,
        endpoint: MessagingWeb.Endpoint,
        router: MessagingWeb.Router,
        statics: MessagingWeb.static_paths()
    end
  end

  @doc """
  When used, dispatch to the appropriate controller/channel/etc.
  """
  defmacro __using__(which) when is_atom(which) do
    apply(__MODULE__, which, [])
  end
end
