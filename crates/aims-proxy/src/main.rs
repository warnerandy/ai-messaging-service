//! CLI entry point for `aims-proxy` — connects a local AHP server to `aims-server`.

use std::env;
use std::time::Duration;

use aims_proxy::{run_proxy, ProxyConfig};
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
    let mut local_ahp_url = env::var("AHP_LOCAL_URL").unwrap_or_else(|_| "ws://127.0.0.1:4034/ahp/v1".to_string());
    let mut upstream_ws_url = env::var("AIMS_SERVER_WS_URL").unwrap_or_else(|_| "wss://aims.thebitvoid.dev/bot/websocket".to_string());
    let mut bot_token = env::var("AIMS_BOT_TOKEN").unwrap_or_default();
    let mut default_working_directory = env::var("AHP_WORKING_DIRECTORY").ok();

    let mut i = 1;
    let mut positional_idx = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--ahp-url" if i + 1 < args.len() => {
                local_ahp_url = args[i + 1].clone();
                i += 2;
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
            arg if !arg.starts_with("--") => {
                if positional_idx == 0 {
                    local_ahp_url = arg.to_string();
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

    if bot_token.is_empty() {
        eprintln!(
            "Usage: aims-proxy <AHP_LOCAL_URL> <AIMS_SERVER_WS_URL> <AIMS_BOT_TOKEN>\n\
             Or set AHP_LOCAL_URL, AIMS_SERVER_WS_URL, and AIMS_BOT_TOKEN environment variables."
        );
        std::process::exit(1);
    }

    let config = ProxyConfig {
        local_ahp_url,
        upstream_ws_url,
        bot_token,
        default_working_directory,
    };

    loop {
        info!("Starting AHP proxy loop...");
        if let Err(e) = run_proxy(config.clone()).await {
            error!("AHP proxy disconnected ({}). Reconnecting in 3s...", e);
            tokio::time::sleep(Duration::from_secs(3)).await;
        } else {
            break;
        }
    }

    Ok(())
}
