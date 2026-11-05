use std::collections::BTreeMap;
use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, RwLock};

#[derive(Clone)]
pub struct AdminState {
    pub(crate) data: Arc<RwLock<Dashboard>>,
    commands: mpsc::Sender<AdminCommand>,
    origin: String,
}

#[derive(Default, Serialize)]
pub(crate) struct Dashboard {
    pub connected: bool,
    pub archive_supported: bool,
    pub syncing: bool,
    pub last_update: Option<String>,
    pub error: Option<String>,
    pub sessions: BTreeMap<String, AdminSession>,
}

#[derive(Clone, Serialize)]
pub(crate) struct AdminSession {
    pub id: String,
    pub title: String,
    pub status: String,
    pub completed: bool,
    pub is_subagent: bool,
    pub hidden_in_aims: bool,
}

pub struct AdminCommand {
    pub(crate) archive: bool,
    pub(crate) ids: Vec<String>,
    pub(crate) reply: oneshot::Sender<Result<Value, String>>,
}

#[derive(Deserialize)]
struct Selection {
    ids: Vec<String>,
}

impl AdminState {
    pub async fn disconnected(&self) {
        let mut data = self.data.write().await;
        data.connected = false;
        data.archive_supported = false;
        data.syncing = false;
        data.error = Some("Proxy disconnected; reconnecting.".to_string());
    }

    pub async fn reconnecting(&self) {
        let mut data = self.data.write().await;
        data.sessions
            .retain(|_, session| session.status == "archived");
        data.syncing = true;
    }

    pub async fn observe(&self, frame: &Value) {
        let payload = &frame["payload"];
        let mut data = self.data.write().await;
        if frame["event"] == "sync_sessions" {
            if let Some(sessions) = payload["sessions"].as_array() {
                for session in sessions {
                    let Some(id) = session["session_id"].as_str() else {
                        continue;
                    };
                    let status = session["status"].as_str().unwrap_or("idle");
                    let completed = matches!(status, "completed" | "done")
                        || (status == "idle" && session["metadata"]["last_turn_complete"] == true);
                    let previous = data.sessions.get(id);
                    let archived = previous.is_some_and(|s| s.status == "archived");
                    let is_subagent = crate::visibility::subagent_entry(session)
                        || previous.is_some_and(|session| session.is_subagent);
                    let hidden_in_aims = previous.is_some_and(|s| s.hidden_in_aims);
                    data.sessions.insert(
                        id.to_string(),
                        AdminSession {
                            id: id.to_string(),
                            title: session["title"].as_str().unwrap_or(id).to_string(),
                            status: if archived { "archived" } else { status }.to_string(),
                            completed: !archived && completed,
                            is_subagent,
                            hidden_in_aims,
                        },
                    );
                }
            }
        } else if frame["event"] == "ahp_envelope" {
            let channel = payload["channel"].as_str().unwrap_or("");
            let id =
                crate::extract_session_id_from_uri(channel).unwrap_or_else(|| channel.to_string());
            let action = payload["action"]["type"].as_str().unwrap_or("");
            if let Some(session) = data.sessions.get_mut(&id) {
                if session.status != "archived" {
                    match action {
                        "chat/turnComplete" => {
                            session.status = "completed".to_string();
                            session.completed = true;
                        }
                        "chat/turnStarted" => {
                            session.status = "running".to_string();
                            session.completed = false;
                        }
                        "chat/inputRequested" => {
                            session.status = "waiting_for_input".to_string();
                            session.completed = false;
                        }
                        "chat/turnCancelled" => {
                            session.status = "idle".to_string();
                            session.completed = false;
                        }
                        _ => {}
                    }
                }
            }
        }
        data.last_update = Some(chrono::Utc::now().to_rfc3339());
    }

    pub async fn eligible(&self, ids: &[String]) -> bool {
        let data = self.data.read().await;
        !ids.is_empty()
            && ids.iter().all(|id| {
                data.sessions.get(id).is_some_and(|s| {
                    !s.is_subagent
                        && s.completed
                        && matches!(s.status.as_str(), "idle" | "completed" | "done")
                })
            })
    }
}

pub async fn start() -> Result<(AdminState, mpsc::Receiver<AdminCommand>), std::io::Error> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4035").await?;
    let (commands, receiver) = mpsc::channel(16);
    let state = AdminState {
        data: Arc::default(),
        commands,
        origin: "http://127.0.0.1:4035".to_string(),
    };
    let app = router(state.clone());
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!("Proxy dashboard stopped: {error}");
        }
    });
    tracing::info!("Proxy dashboard: http://127.0.0.1:4035");
    Ok((state, receiver))
}

fn router(state: AdminState) -> Router {
    Router::new()
        .route("/", get(|| async { Html(include_str!("admin.html")) }))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .route(
            "/admin.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript")],
                    include_str!("admin.js"),
                )
            }),
        )
        .route(
            "/admin.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css")],
                    include_str!("admin.css"),
                )
            }),
        )
        .route("/api/status", get(status))
        .route("/api/resync", post(resync))
        .route("/api/archive", post(archive))
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            local_only,
        ))
        .with_state(state)
}

async fn local_only(
    State(state): State<AdminState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok());
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    if host != Some("127.0.0.1:4035")
        || (request.method() != axum::http::Method::GET && origin != Some(state.origin.as_str()))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            .parse()
            .unwrap(),
    );
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
}

async fn status(State(state): State<AdminState>) -> Json<Value> {
    Json(serde_json::to_value(&*state.data.read().await).unwrap_or_default())
}

async fn resync(State(state): State<AdminState>, Json(selection): Json<Selection>) -> Response {
    submit(state, selection, false).await
}

async fn archive(State(state): State<AdminState>, Json(selection): Json<Selection>) -> Response {
    submit(state, selection, true).await
}

async fn submit(state: AdminState, selection: Selection, archive: bool) -> Response {
    if selection.ids.is_empty() || selection.ids.len() > 100 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Select between 1 and 100 sessions."})),
        )
            .into_response();
    }
    if !state.data.read().await.connected {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "AIMS is disconnected."})),
        )
            .into_response();
    }
    if archive && !state.data.read().await.archive_supported {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({"error": "Deploy the updated aims-server to enable dashboard archiving."})),
        )
            .into_response();
    }
    if archive && !state.eligible(&selection.ids).await {
        return (StatusCode::CONFLICT, Json(json!({"error": "Only explicitly completed sessions can be archived. Refresh the selection."}))).into_response();
    }
    let (reply, response) = oneshot::channel();
    if state
        .commands
        .try_send(AdminCommand {
            archive,
            ids: selection.ids,
            reply,
        })
        .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match tokio::time::timeout(std::time::Duration::from_secs(30), response).await {
        Ok(Ok(Ok(result))) => Json(result).into_response(),
        Ok(Ok(Err(error))) => {
            (StatusCode::BAD_GATEWAY, Json(json!({"error": error}))).into_response()
        }
        _ => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({"error": "No acknowledgement received. Refresh status before retrying."})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn state() -> AdminState {
        let (commands, _) = mpsc::channel(1);
        AdminState {
            data: Arc::default(),
            commands,
            origin: "http://127.0.0.1:4035".into(),
        }
    }

    #[tokio::test]
    async fn idle_is_not_completion_and_archives_survive_snapshots() {
        let state = state();
        let mut frame = json!({"event": "sync_sessions", "payload": {"sessions": [
            {"session_id": "idle", "status": "idle"},
            {"session_id": "done", "status": "idle", "metadata": {"last_turn_complete": true}}
        ]}});
        state.observe(&frame).await;
        assert!(!state.eligible(&["idle".into()]).await);
        assert!(state.eligible(&["done".into()]).await);
        frame["payload"]["sessions"][1]["status"] = json!("running");
        state.observe(&frame).await;
        assert!(!state.eligible(&["done".into()]).await);
        state
            .data
            .write()
            .await
            .sessions
            .get_mut("done")
            .unwrap()
            .status = "archived".into();
        frame["payload"]["sessions"][1]["status"] = json!("idle");
        state.observe(&frame).await;
        assert!(!state.eligible(&["done".into()]).await);
        assert_eq!(state.data.read().await.sessions["done"].status, "archived");
    }

    #[tokio::test]
    async fn rejects_foreign_hosts_and_cross_origin_writes() {
        for (host, origin) in [
            ("evil.example", Some("http://127.0.0.1:4035")),
            ("127.0.0.1:4035", Some("https://evil.example")),
            ("127.0.0.1:4035", None),
        ] {
            let mut request = Request::post("/api/archive")
                .header("host", host)
                .header("content-type", "application/json");
            if let Some(origin) = origin {
                request = request.header("origin", origin);
            }
            let response = router(state())
                .oneshot(request.body(Body::from(r#"{"ids":["done"]}"#)).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        let response = router(state())
            .oneshot(
                Request::get("/api/status")
                    .header("host", "127.0.0.1:4035")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn archive_requires_completion_and_server_acknowledgement() {
        let (commands, mut receiver) = mpsc::channel(1);
        let state = AdminState {
            commands,
            ..state()
        };
        {
            let mut data = state.data.write().await;
            data.connected = true;
            data.archive_supported = true;
        }
        state
            .observe(&json!({"event": "sync_sessions", "payload": {"sessions": [
                {"session_id": "idle", "status": "idle"},
                {"session_id": "done", "status": "completed"}
            ]}}))
            .await;
        let rejected = submit(
            state.clone(),
            Selection {
                ids: vec!["idle".into()],
            },
            true,
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::CONFLICT);
        let submit_state = state.clone();
        let request = tokio::spawn(async move {
            submit(
                submit_state,
                Selection {
                    ids: vec!["done".into()],
                },
                true,
            )
            .await
        });
        let command = receiver.recv().await.unwrap();
        assert!(command.archive);
        assert_eq!(command.ids, ["done"]);
        command
            .reply
            .send(Err("AIMS rejected archive".into()))
            .unwrap();
        assert_eq!(request.await.unwrap().status(), StatusCode::BAD_GATEWAY);
        assert_ne!(state.data.read().await.sessions["done"].status, "archived");
    }

    #[tokio::test]
    async fn a_new_turn_revokes_archive_eligibility() {
        let state = state();
        state
            .observe(&json!({"event": "sync_sessions", "payload": {"sessions": [
                {"session_id": "ahp-chat://default/encoded-identity", "status": "completed"}
            ]}}))
            .await;
        state
            .observe(&json!({"event": "ahp_envelope", "payload": {
                "channel": "ahp-chat://default/encoded-identity",
                "action": {"type": "chat/turnStarted"}
            }}))
            .await;
        assert!(
            !state
                .eligible(&["ahp-chat://default/encoded-identity".into()])
                .await
        );
    }

    #[tokio::test]
    async fn subagents_stay_visible_locally_without_becoming_archive_candidates() {
        let state = state();
        let id = "ahp-chat://subagent/parent/worker";
        state
            .observe(&json!({"event": "sync_sessions", "payload": {"sessions": [
                {"session_id": id, "status": "completed", "title": "Worker"}
            ]}}))
            .await;
        let data = state.data.read().await;
        assert!(data.sessions[id].is_subagent);
        assert!(!data.sessions[id].hidden_in_aims);
        assert_eq!(data.sessions[id].status, "completed");
        drop(data);
        assert!(!state.eligible(&[id.into()]).await);
    }
}
