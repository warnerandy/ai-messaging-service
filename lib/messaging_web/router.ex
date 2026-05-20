defmodule MessagingWeb.Router do
  use MessagingWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :public_api do
    plug :accepts, ["json"]
    plug MessagingWeb.Plugs.RateLimit, scope: :public_auth, limit: 10, window_ms: 60_000
  end

  pipeline :user_api do
    plug :accepts, ["json"]
    plug MessagingWeb.ApiAuth
  end

  pipeline :bot_api do
    plug :accepts, ["json"]
    plug MessagingWeb.Plugs.RateLimit, scope: :bot_auth, limit: 60, window_ms: 60_000
    plug MessagingWeb.BotAuth
  end

  # Public - registration & login
  scope "/api", MessagingWeb.API do
    pipe_through :public_api

    post "/register", AuthController, :register
    post "/login", AuthController, :login
  end

  # User API - requires user token
  scope "/api", MessagingWeb.API do
    pipe_through :user_api

    resources "/bot-tokens", BotTokenController, only: [:index, :create, :delete]
    get "/bot-tokens/:bot_token_id/channel", BotTokenController, :channel
    get "/bot-tokens/:bot_token_id/models", BotModelController, :index
    post "/bot-tokens/:bot_token_id/refresh-models", BotModelController, :refresh
    post "/bot-tokens/refresh-models", BotModelController, :refresh_all
    resources "/conversations", ConversationController, only: [:index, :create, :show]
    get "/conversations/:id/channel", ConversationController, :channel
    post "/conversations/:conversation_id/messages", MessageController, :create
    post "/conversations/:conversation_id/assets", AssetController, :upload
  end

  # Bot API - requires bot token
  scope "/api/bot", MessagingWeb.BotAPI do
    pipe_through :bot_api

    post "/messages", MessageController, :create
    get "/messages", MessageController, :index
    put "/messages/:id/acknowledge", MessageController, :acknowledge
    put "/status", StatusController, :update
    put "/models", ModelController, :update
    get "/channel", ChannelController, :show
    post "/conversations/:conversation_id/assets", AssetController, :upload
  end

  # Authenticated file downloads (signed token via query param)
  scope "/uploads", MessagingWeb do
    pipe_through :api

    get "/:conversation_id/*filename", UploadController, :show
  end

  # PWA frontend shell
  scope "/", MessagingWeb do
    pipe_through :browser

    get "/", AppController, :index
  end
end
