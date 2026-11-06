//! CLI entry point for `aims-proxy` — connects a local AHP server to `aims-server`.

use std::env;
use std::time::Duration;

use aims_proxy::{admin, run_proxy_with_admin_and_receipts, DeliveryReceipts, ProxyConfig};
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aims_proxy=info,ahp=info".into()),
        )
        .init();

    let args: Vec<String> = env::args().collect();
    let mut local_ahp_url: Option<String> = env::var("AHP_LOCAL_URL").ok();
    let mut local_ahp_socket: Option<std::path::PathBuf> = env::var("AHP_LOCAL_SOCKET")
        .ok()
        .map(std::path::PathBuf::from);
    let mut local_ahp_token: Option<String> = env::var("AHP_CONNECTION_TOKEN").ok();
    let mut force_discovery = false;

    let mut upstream_ws_url = env::var("AIMS_SERVER_WS_URL")
        .unwrap_or_else(|_| "wss://aims.thebitvoid.dev/bot/websocket".to_string());
    let mut bot_token = env::var("AIMS_BOT_TOKEN").unwrap_or_default();
    let mut default_working_directory = env::var("AHP_WORKING_DIRECTORY").ok();
    let mut audit_log_file: Option<std::path::PathBuf> = env::var("AHP_AUDIT_LOG_FILE")
        .or_else(|_| env::var("AHP_AUDIT_LOG"))
        .ok()
        .map(std::path::PathBuf::from);

    let mut i = 1;
    let mut positional_idx = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--ahp-url" if i + 1 < args.len() => {
                local_ahp_url = Some(args[i + 1].clone());
                i += 2;
            }
            "--ahp-socket" if i + 1 < args.len() => {
                local_ahp_socket = Some(std::path::PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--ahp-token" if i + 1 < args.len() => {
                local_ahp_token = Some(args[i + 1].clone());
                i += 2;
            }
            "--discover" | "--auto-discover" => {
                force_discovery = true;
                i += 1;
            }
            "--server-url" if i + 1 < args.len() => {
                upstream_ws_url = args[i + 1].clone();
                i += 2;
            }
            "--token" if i + 1 < args.len() => {
                bot_token = args[i + 1].clone();
                i += 2;
            }
            "--workdir" if i + 1 < args.len() => {
                default_working_directory = Some(args[i + 1].clone());
                i += 2;
            }
            "--audit-log" if i + 1 < args.len() => {
                audit_log_file = Some(std::path::PathBuf::from(&args[i + 1]));
                i += 2;
            }
            arg if !arg.starts_with("--") => {
                if positional_idx == 0 {
                    local_ahp_url = Some(arg.to_string());
                } else if positional_idx == 1 {
                    upstream_ws_url = arg.to_string();
                } else if positional_idx == 2 {
                    bot_token = arg.to_string();
                }
                positional_idx += 1;
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    // Auto-discover local AHP endpoints if not explicitly provided or if requested
    let is_auto_requested = force_discovery
        || local_ahp_url.as_deref() == Some("auto")
        || (local_ahp_url.is_none() && local_ahp_socket.is_none());

    if is_auto_requested {
        info!("Searching for active local VS Code AHP endpoints...");
        match aims_proxy::discovery::discover_active_endpoint() {
            Some(discovered) => match discovered.target {
                aims_proxy::discovery::AhpTarget::UnixSocket(path) => {
                    info!("Using discovered Unix domain socket: {}", path.display());
                    local_ahp_socket = Some(path);
                    if local_ahp_token.is_none() {
                        local_ahp_token = discovered.token;
                    }
                    local_ahp_url = None;
                }
                aims_proxy::discovery::AhpTarget::Tcp { host, port } => {
                    let url = format!("ws://{}:{}", host, port);
                    info!("Using discovered TCP endpoint: {}", url);
                    local_ahp_url = Some(url);
                    if local_ahp_token.is_none() {
                        local_ahp_token = discovered.token;
                    }
                    local_ahp_socket = None;
                }
            },
            None => {
                if local_ahp_url.as_deref() == Some("auto") || local_ahp_url.is_none() {
                    info!("No active VS Code AHP endpoints discovered, falling back to default ws://127.0.0.1:4034/ahp/v1");
                    local_ahp_url = Some("ws://127.0.0.1:4034/ahp/v1".to_string());
                }
            }
        }
    }

    // Parse unix:// or unix: URLs if specified via --ahp-url
    if let Some(ref url) = local_ahp_url {
        if url.starts_with("unix://") || url.starts_with("unix:") {
            let stripped = url
                .strip_prefix("unix://")
                .or_else(|| url.strip_prefix("unix:"))
                .unwrap();
            let (path_part, query_part) = match stripped.split_once('?') {
                Some((p, q)) => (p, Some(q)),
                None => (stripped, None),
            };
            local_ahp_socket = Some(std::path::PathBuf::from(path_part));
            if let Some(q) = query_part {
                for pair in q.split('&') {
                    if let Some(token) = pair.strip_prefix("tkn=") {
                        local_ahp_token = Some(token.to_string());
                    }
                }
            }
            local_ahp_url = None;
        }
    }

    if bot_token.is_empty() {
        eprintln!(
            "Usage: aims-proxy [--ahp-url <URL> | --ahp-socket <PATH>] [--ahp-token <TOKEN>] --token <BOT_TOKEN>\n\
             Or set AHP_LOCAL_URL / AHP_LOCAL_SOCKET, and AIMS_BOT_TOKEN environment variables.\n\
             By default, aims-proxy automatically discovers active VS Code AHP endpoints (Unix sockets & TCP)."
        );
        std::process::exit(1);
    }

    let config = ProxyConfig {
        local_ahp_url,
        local_ahp_socket,
        local_ahp_token,
        upstream_ws_url,
        bot_token,
        default_working_directory,
    };
    let (dashboard, mut commands) = admin::start_with_audit_file(audit_log_file).await?;
    let receipts = std::sync::Arc::new(DeliveryReceipts::default());

    loop {
        dashboard.reconnecting().await;
        info!("Starting AHP proxy loop...");
        if let Err(e) =
            run_proxy_with_admin_and_receipts(config.clone(), Some(dashboard.clone()), &mut commands, receipts.clone()).await
        {
            dashboard.disconnected_with_reason(&format!("Proxy disconnected ({e}); reconnecting.")).await;
            error!("AHP proxy disconnected ({}). Reconnecting in 3s...", e);
            tokio::time::sleep(Duration::from_secs(3)).await;
        } else {
            break;
        }
    }

    Ok(())
}
