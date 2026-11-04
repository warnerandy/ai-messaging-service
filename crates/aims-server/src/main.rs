//! Entry point for `aims-server` — Rust AHP (Agent Host Protocol) backend and WebSocket hub.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use aims_server::{db, routes, ws::PubSubHub, AppState};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aims_server=info,tower_http=info".into()),
        )
        .init();

    let raw_database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/messaging_dev".into());
    let database_url = if raw_database_url.starts_with("ecto://") {
        raw_database_url.replacen("ecto://", "postgres://", 1)
    } else {
        raw_database_url
    };
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4000);
    let secret_key_base = std::env::var("SECRET_KEY_BASE")
        .unwrap_or_else(|_| "aims-rust-ahp-default-secret-key-base-64-bytes-minimum-length".into());
    let static_dir = std::env::var("STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("priv/static"));

    info!("Connecting to PostgreSQL...");
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    db::init_db(&pool).await?;
    info!("Database schema initialized (AHP v{} ready)", ahp_types::PROTOCOL_VERSION);

    let state = Arc::new(AppState {
        db: pool,
        hub: PubSubHub::new(),
        static_dir,
        secret_key_base,
    });

    let app = routes::build_router(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("aims-server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
