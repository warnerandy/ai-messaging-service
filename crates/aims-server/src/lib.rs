//! `aims-server` library crate exposing the AHP mirror, database layer, WebSocket hub, and Axum router.

pub mod ahp_mirror;
pub mod auth;
pub mod db;
pub mod routes;
pub mod ws;

use std::path::PathBuf;
use sqlx::PgPool;
use ws::PubSubHub;

pub struct AppState {
    pub db: PgPool,
    pub hub: PubSubHub,
    pub static_dir: PathBuf,
    pub secret_key_base: String,
}
