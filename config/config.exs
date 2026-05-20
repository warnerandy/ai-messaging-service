# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :messaging, :scopes,
  user: [
    default: true,
    module: Messaging.Accounts.Scope,
    assign_key: :current_scope,
    access_path: [:user, :id],
    schema_key: :user_id,
    schema_type: :id,
    schema_table: :users,
    test_data_fixture: Messaging.AccountsFixtures,
    test_setup_helper: :register_and_log_in_user
  ]

config :messaging,
  ecto_repos: [Messaging.Repo],
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :messaging, MessagingWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: MessagingWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Messaging.PubSub

# Configure esbuild (the version is required)
config :esbuild,
  version: "0.25.4",
  messaging: [
    args:
      ~w(js/app.jsx --bundle --target=es2022 --outdir=../priv/static/assets/js --external:/fonts/* --external:/images/* --alias:@=. --jsx=automatic),
    cd: Path.expand("../assets", __DIR__),
    env: %{
      "NODE_PATH" =>
        Enum.join([Path.expand("../deps", __DIR__), Path.expand("../node_modules", __DIR__)], ":")
    }
  ]

# Configure tailwind (the version is required)
config :tailwind,
  version: "4.1.12",
  messaging: [
    args: ~w(
      --input=assets/css/app.css
      --output=priv/static/assets/css/app.css
    ),
    cd: Path.expand("..", __DIR__)
  ]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Mailer config
config :messaging, Messaging.Mailer, adapter: Swoosh.Adapters.Local
config :swoosh, :api_client, false

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
