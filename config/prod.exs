import Config

# Do not print debug messages in production
config :logger, level: :info

config :messaging, MessagingWeb.Endpoint,
  force_ssl: [hsts: true, rewrite_on: [:x_forwarded_proto]]

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
