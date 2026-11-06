//! HTTP REST API routes, multipart mobile image/asset upload handlers, and static PWA shell.

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::ServeDir;

use crate::{
    auth::{sign_upload_url, verify_upload_token},
    db::{self, BotTokenRecord, UserRecord},
    ws::{broadcast_bot_status, bot_ws_handler, notify_bot_session_created, notify_bot_user_message, user_ws_handler},
    AppState,
};

pub fn build_router(state: Arc<AppState>) -> Router {
    let static_dir = state.static_dir.clone();

    Router::new()
        // WebSocket endpoints (support both /socket/websocket and /socket)
        .route("/socket/websocket", get(user_ws_handler))
        .route("/socket", get(user_ws_handler))
        .route("/bot/websocket", get(bot_ws_handler))
        .route("/bot", get(bot_ws_handler))
        // Public Auth API
        .route("/api/register", post(register_handler))
        .route("/api/login", post(login_handler))
        // User API
        .route("/api/ping", get(ping_handler))
        .route(
            "/api/bot-tokens",
            get(list_bot_tokens_handler).post(create_bot_token_handler),
        )
        .route("/api/bot-tokens/refresh-models", post(refresh_all_models_handler))
        .route("/api/bot-tokens/{id}", delete(delete_bot_token_handler))
        .route(
            "/api/bot-tokens/{bot_token_id}/regenerate",
            post(regenerate_bot_token_handler),
        )
        .route(
            "/api/bot-tokens/{bot_token_id}/channel",
            get(bot_token_channel_handler),
        )
        .route(
            "/api/bot-tokens/{bot_token_id}/models",
            get(list_bot_models_handler),
        )
        .route(
            "/api/bot-tokens/{bot_token_id}/refresh-models",
            post(refresh_bot_models_handler),
        )
        .route(
            "/api/conversations",
            get(list_conversations_handler).post(create_conversation_handler),
        )
        .route(
            "/api/conversations/{id}",
            get(get_conversation_handler)
                .patch(update_conversation_handler)
                .put(update_conversation_handler)
                .delete(archive_conversation_handler),
        )
        .route(
            "/api/conversations/{id}/archive",
            post(archive_conversation_handler),
        )
        .route(
            "/api/conversations/{id}/channel",
            get(conversation_channel_handler),
        )
        .route(
            "/api/conversations/{conversation_id}/messages",
            post(create_user_message_handler),
        )
        .route(
            "/api/conversations/{conversation_id}/messages/timeout",
            post(timeout_message_handler),
        )
        .route(
            "/api/conversations/{conversation_id}/assets",
            post(upload_user_asset_handler),
        )
        // Bot REST API
        .route(
            "/api/bot/messages",
            get(bot_list_messages_handler).post(bot_create_message_handler),
        )
        .route(
            "/api/bot/messages/{id}/acknowledge",
            put(bot_acknowledge_message_handler),
        )
        .route("/api/bot/status", put(bot_update_status_handler))
        .route(
            "/api/bot/capabilities",
            put(bot_update_capabilities_handler).post(bot_update_capabilities_handler),
        )
        .route("/api/bot/models", put(bot_set_models_handler))
        .route("/api/bot/channel", get(bot_channel_info_handler))
        .route(
            "/api/bot/conversations/{conversation_id}/assets",
            post(upload_bot_asset_handler),
        )
        // Signed upload downloads
        .route(
            "/uploads/{conversation_id}/{*filename}",
            get(serve_upload_handler),
        )
        // Frontend SPA shell & static assets
        .route("/", get(index_handler))
        .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(state)
}

// --- Auth Helpers ---

async fn require_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserRecord, (StatusCode, Json<Value>)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(token) = auth_header.strip_prefix("Bearer ") else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or missing user token" })),
        ));
    };

    match db::authenticate_user_token(&state.db, token.trim()).await {
        Ok(Some(user)) => Ok(user),
        _ => Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or missing user token" })),
        )),
    }
}

async fn require_bot(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<BotTokenRecord, (StatusCode, Json<Value>)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(token) = auth_header.strip_prefix("Bearer ") else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or missing bot token" })),
        ));
    };

    match db::authenticate_bot_token(&state.db, token.trim()).await {
        Ok(Some(bot)) => Ok(bot),
        _ => Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or missing bot token" })),
        )),
    }
}

// --- Public Auth Handlers ---

#[derive(Deserialize)]
struct AuthRequest {
    email: Option<String>,
    password: Option<String>,
}

async fn register_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthRequest>,
) -> impl IntoResponse {
    let email = payload.email.unwrap_or_default();
    let password = payload.password.unwrap_or_default();

    match db::register_user(&state.db, &email, &password).await {
        Ok((user, token)) => (
            StatusCode::CREATED,
            Json(json!({
                "token": token,
                "user": { "id": user.id, "email": user.email }
            })),
        ),
        Err(msg) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "errors": { "email": [msg] } })),
        ),
    }
}

async fn login_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthRequest>,
) -> impl IntoResponse {
    let email = payload.email.unwrap_or_default();
    let password = payload.password.unwrap_or_default();

    match db::login_user(&state.db, &email, &password).await {
        Ok(Some((user, token))) => (
            StatusCode::OK,
            Json(json!({
                "token": token,
                "user": { "id": user.id, "email": user.email }
            })),
        ),
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid email or password" })),
        ),
    }
}

async fn ping_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    Ok(Json(json!({
        "status": "ok",
        "protocol": "ahp",
        "protocol_version": ahp_types::PROTOCOL_VERSION,
        "user": { "id": user.id, "email": user.email }
    })))
}

// --- Bot Token Handlers ---

async fn list_bot_tokens_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let tokens = db::list_bot_tokens(&state.db, user.id)
        .await
        .unwrap_or_default();
    Ok(Json(json!({ "bot_tokens": tokens })))
}

async fn create_bot_token_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "errors": { "name": ["can't be blank"] } })),
        ));
    }

    let bot_type = payload.get("bot_type").and_then(|v| v.as_str());
    let metadata = payload.get("metadata").cloned();

    match db::create_bot_token(&state.db, user.id, name, bot_type, metadata).await {
        Ok((bot, raw_token)) => Ok((
            StatusCode::CREATED,
            Json(json!({
                "id": bot.id,
                "name": bot.name,
                "token": raw_token,
                "channel_code": bot.channel_code,
                "bot_type": bot.bot_type,
                "metadata": bot.metadata,
            })),
        )),
        Err(e) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": e.to_string() })),
        )),
    }
}

async fn regenerate_bot_token_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(bot_token_id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    match db::regenerate_bot_token(&state.db, bot_token_id, user.id).await {
        Ok(Some((bot, raw_token))) => Ok(Json(json!({
            "id": bot.id,
            "name": bot.name,
            "token": raw_token,
            "channel_code": bot.channel_code,
            "bot_type": bot.bot_type,
        }))),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn bot_token_channel_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(bot_token_id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    match db::get_bot_token(&state.db, bot_token_id, Some(user.id)).await {
        Ok(Some(bot)) => Ok(Json(json!({
            "bot_token_id": bot.id,
            "channel_code": bot.channel_code,
        }))),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn delete_bot_token_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    match db::revoke_bot_token(&state.db, id, user.id).await {
        Ok(true) => Ok(Json(json!({ "ok": true }))),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn list_bot_models_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(bot_token_id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(_bot) = db::get_bot_token(&state.db, bot_token_id, Some(user.id))
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };
    let models = db::list_bot_models(&state.db, bot_token_id)
        .await
        .unwrap_or_default();
    Ok(Json(json!({ "models": models })))
}

async fn refresh_bot_models_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(bot_token_id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(bot) = db::get_bot_token(&state.db, bot_token_id, Some(user.id))
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };
    state
        .hub
        .broadcast(format!("bot:{}", bot.id), "request_models", json!({}));
    Ok(Json(json!({
        "status": "refresh_requested",
        "bot_token_id": bot.id,
    })))
}

async fn refresh_all_models_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    if let Ok(bots) = db::list_bot_tokens(&state.db, user.id).await {
        for b in bots {
            state
                .hub
                .broadcast(format!("bot:{}", b.id), "request_models", json!({}));
        }
    }
    Ok(Json(json!({ "status": "refresh_requested_all" })))
}

// --- Conversation & AHP Session Handlers ---

#[derive(Deserialize)]
struct ListConversationsQuery {
    include_archived: Option<String>,
}

async fn list_conversations_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListConversationsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let include_archived = matches!(
        query.include_archived.as_deref(),
        Some("true") | Some("1")
    );
    let conversations = db::list_conversations(&state.db, user.id, include_archived)
        .await
        .unwrap_or_default();
    Ok(Json(json!({ "conversations": conversations })))
}

async fn create_conversation_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(bot_token_id) = payload.get("bot_token_id").and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
    }) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "bot_token_id is required" })),
        ));
    };

    let Some(bot) = db::get_bot_token(&state.db, bot_token_id, Some(user.id))
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    if bot.bot_type == "ahp" && !bot.is_connected {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The local AHP proxy is offline. Connect it before creating a session." })),
        ));
    }

    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&bot.name);
    let ext_id = payload.get("external_session_id").and_then(|v| v.as_str());
    let status = payload.get("status").and_then(|v| v.as_str());
    let mut meta = payload
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !meta.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "metadata must be an object" })),
        ));
    }
    let status = if bot.bot_type == "ahp" {
        meta["creation_status"] = json!("pending");
        meta["creation_error"] = Value::Null;
        Some("creating")
    } else {
        status
    };
    if let Some(parent_id) = payload
        .get("parent_session_id")
        .or_else(|| payload.get("parentSessionId"))
    {
        if let Some(obj) = meta.as_object_mut() {
            obj.insert("parent_session_id".to_string(), parent_id.clone());
        }
    }

    match db::create_conversation(&state.db, user.id, bot.id, title, ext_id, status, meta).await {
        Ok(conv) => {
            notify_bot_session_created(&state, &conv).await;
            Ok((
                StatusCode::CREATED,
                Json(serde_json::to_value(conv).unwrap_or_default()),
            ))
        }
        Err(e) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct ShowConversationQuery {
    after_id: Option<i64>,
    limit: Option<i64>,
}

async fn get_conversation_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(query): Query<ShowConversationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(conv) = db::get_conversation(&state.db, id, Some(user.id), None)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    let messages = db::list_messages(&state.db, conv.id, query.after_id, query.limit)
        .await
        .unwrap_or_default();

    Ok(Json(json!({
        "conversation": conv,
        "messages": messages,
    })))
}

async fn update_conversation_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(_existing) = db::get_conversation(&state.db, id, Some(user.id), None)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    let title = payload.get("title").and_then(|v| v.as_str());
    let status = payload.get("status").and_then(|v| v.as_str());
    let metadata = payload.get("metadata").cloned();

    match db::update_conversation(&state.db, id, title, status, metadata).await {
        Ok(Some(updated)) => {
            state.hub.broadcast(
                format!("conversation:{}", updated.id),
                "session_status_changed",
                json!({
                    "conversation_id": updated.id,
                    "status": updated.status,
                    "metadata": updated.metadata,
                }),
            );
            state.hub.broadcast(
                format!("bot_sessions:{}", updated.bot_token_id),
                "session_status_changed",
                json!({
                    "conversation_id": updated.id,
                    "status": updated.status,
                    "metadata": updated.metadata,
                }),
            );
            Ok(Json(serde_json::to_value(updated).unwrap_or_default()))
        }
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn archive_conversation_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    match db::archive_conversation(&state.db, id, user.id).await {
        Ok(Some(conv)) => {
            state.hub.broadcast(
                format!("conversation:{}", conv.id),
                "session_status_changed",
                json!({
                    "conversation_id": conv.id,
                    "status": "archived",
                    "metadata": conv.metadata,
                }),
            );
            state.hub.broadcast(
                format!("bot_sessions:{}", conv.bot_token_id),
                "session_status_changed",
                json!({
                    "conversation_id": conv.id,
                    "status": "archived",
                    "metadata": conv.metadata,
                }),
            );
            Ok(Json(json!({ "id": conv.id, "status": conv.status })))
        }
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn conversation_channel_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    match db::get_conversation(&state.db, id, Some(user.id), None).await {
        Ok(Some(conv)) => Ok(Json(json!({
            "conversation_id": conv.id,
            "topic": format!("conversation:{}", conv.id),
        }))),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        )),
    }
}

async fn create_user_message_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(conv) = db::get_conversation(&state.db, conversation_id, Some(user.id), None)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    if conv.bot_type.as_deref() == Some("ahp") {
        if matches!(conv.metadata["creation_status"].as_str(), Some("failed")) {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({ "error": conv.metadata["creation_error"].as_str()
                    .unwrap_or("The host session creation failed. Create a new session.") })),
            ));
        }
        if conv.metadata.get("creation_status").and_then(|v| v.as_str()) == Some("pending")
            || conv.status == "creating"
        {
            let _ = sqlx::query(
                "UPDATE conversations SET status = 'idle', metadata = metadata || '{\"creation_status\": \"ready\"}'::jsonb WHERE id = $1"
            )
            .bind(conv.id)
            .execute(&state.db)
            .await;
            state.hub.broadcast(
                format!("conversation:{}", conv.id),
                "session_status_changed",
                json!({
                    "conversation_id": conv.id,
                    "status": "idle",
                    "metadata": {
                        "creation_status": "ready"
                    }
                }),
            );
        }
    }

    let mut metadata = payload
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let asset_url = payload.get("asset_url").and_then(|v| v.as_str());
    let has_inline_attachments = metadata
        .get("attachments")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    let content_type = if asset_url.is_some() || has_inline_attachments {
        let ct = payload
            .get("asset_type")
            .and_then(|v| v.as_str())
            .unwrap_or("image");
        if let Some(url) = asset_url {
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert("url".to_string(), json!(url));
                if let Some(fname) = payload.get("asset_filename") {
                    obj.insert("filename".to_string(), fname.clone());
                }
            }
        }
        ct
    } else {
        "text"
    };

    let body = payload.get("body").and_then(|v| v.as_str());
    let model = payload.get("model").and_then(|v| v.as_str());
    let context_size = payload
        .get("context_size")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32);
    let is_suggestion = payload
        .get("is_suggestion")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match db::create_message(
        &state.db,
        conv.id,
        "user",
        content_type,
        body,
        metadata,
        model,
        context_size,
        is_suggestion,
    )
    .await
    {
        Ok(msg) => {
            notify_bot_user_message(&state, &conv, &msg).await;
            Ok((
                StatusCode::CREATED,
                Json(serde_json::to_value(msg).unwrap_or_default()),
            ))
        }
        Err(e) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "errors": { "body": [e] } })),
        )),
    }
}

async fn timeout_message_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(conv) = db::get_conversation(&state.db, conversation_id, Some(user.id), None)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    let msg_id = payload
        .get("message_id")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    match db::create_message(
        &state.db,
        conv.id,
        "system",
        "text",
        Some("The bot failed to respond."),
        json!({ "kind": "bot_timeout", "timeout_for_message_id": msg_id }),
        None,
        None,
        false,
    )
    .await
    {
        Ok(msg) => {
            state.hub.broadcast(
                format!("conversation:{}", conv.id),
                "new_message",
                json!({ "message": msg }),
            );
            Ok((
                StatusCode::CREATED,
                Json(serde_json::to_value(msg).unwrap_or_default()),
            ))
        }
        Err(e) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": e })),
        )),
    }
}

// --- Asset Upload & Download Handlers ---

async fn upload_user_asset_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user = require_user(&state, &headers).await?;
    let Some(conv) = db::get_conversation(&state.db, conversation_id, Some(user.id), None)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    save_multipart_asset(&state, conv.id, multipart).await
}

async fn upload_bot_asset_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let Some(conv) = db::get_conversation(&state.db, conversation_id, None, Some(bot.id))
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    save_multipart_asset(&state, conv.id, multipart).await
}

async fn save_multipart_asset(
    state: &AppState,
    conversation_id: i64,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let orig_filename = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "pasted-image.png".to_string());
        let reported_type = field.content_type().map(|s| {
            s.split(';')
                .next()
                .unwrap_or(s)
                .trim()
                .to_string()
        });
        let content_type = reported_type.unwrap_or_else(|| {
            mime_guess::from_path(&orig_filename)
                .first_or_octet_stream()
                .to_string()
        });

        let allowed = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/heic",
            "image/heif",
            "application/pdf",
            "text/plain",
            "text/markdown",
            "text/csv",
            "application/json",
        ];
        if !allowed.iter().any(|a| content_type.starts_with(a)) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "File type not allowed" })),
            ));
        }

        let bytes = field.bytes().await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Failed to read upload: {}", e) })),
            )
        })?;

        let path_obj = PathBuf::from(&orig_filename);
        let stem = path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("asset")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        let ext = path_obj
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_else(|| ".png".to_string());

        let ts = chrono::Utc::now().timestamp_millis();
        let unique_name = format!(
            "{}-{}{}",
            if stem.is_empty() { "image" } else { &stem },
            ts,
            ext
        );

        let conv_dir = state
            .static_dir
            .join("uploads")
            .join(conversation_id.to_string());
        tokio::fs::create_dir_all(&conv_dir).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to create upload dir: {}", e) })),
            )
        })?;

        let dest = conv_dir.join(&unique_name);
        tokio::fs::write(&dest, &bytes).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to write file: {}", e) })),
            )
        })?;

        let signed_url = sign_upload_url(&state.secret_key_base, conversation_id, &unique_name);
        return Ok((
            StatusCode::CREATED,
            Json(json!({
                "url": signed_url,
                "content_type": content_type,
                "filename": orig_filename,
            })),
        ));
    }

    Err((
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "Missing file field" })),
    ))
}

#[derive(Deserialize)]
struct UploadTokenQuery {
    token: Option<String>,
}

async fn serve_upload_handler(
    State(state): State<Arc<AppState>>,
    Path((conversation_id, filename)): Path<(i64, String)>,
    Query(query): Query<UploadTokenQuery>,
) -> Response {
    let clean_filename = filename.trim_start_matches('/');
    if clean_filename.contains("..") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid filename" })),
        )
            .into_response();
    }

    let Some(token) = query.token.as_deref() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or expired download token" })),
        )
            .into_response();
    };

    if !verify_upload_token(&state.secret_key_base, token, conversation_id, clean_filename) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or expired download token" })),
        )
            .into_response();
    }

    let file_path = state
        .static_dir
        .join("uploads")
        .join(conversation_id.to_string())
        .join(clean_filename);

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&file_path).first_or_octet_stream();
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                bytes,
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found" })),
        )
            .into_response(),
    }
}

// --- Bot REST API Handlers ---

async fn bot_list_messages_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let messages = db::get_pending_messages_for_bot(&state.db, bot.id)
        .await
        .unwrap_or_default();
    Ok(Json(json!({ "messages": messages })))
}

async fn bot_create_message_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let Some(conv) = db::resolve_bot_conversation(&state.db, &bot, &payload)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    let content_type = payload
        .get("content_type")
        .and_then(|v| v.as_str())
        .unwrap_or("text");
    let body = payload.get("body").and_then(|v| v.as_str());
    let metadata = payload
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let is_suggestion = payload
        .get("is_suggestion")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match db::create_message(
        &state.db,
        conv.id,
        "bot",
        content_type,
        body,
        metadata,
        None,
        None,
        is_suggestion,
    )
    .await
    {
        Ok(msg) => {
            state.hub.broadcast(
                format!("conversation:{}", conv.id),
                "new_message",
                json!({ "message": msg }),
            );
            Ok((
                StatusCode::CREATED,
                Json(serde_json::to_value(msg).unwrap_or_default()),
            ))
        }
        Err(e) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "errors": { "body": [e] } })),
        )),
    }
}

async fn bot_acknowledge_message_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let Some(conv) = db::resolve_bot_conversation(&state.db, &bot, &payload)
        .await
        .ok()
        .flatten()
    else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found" })),
        ));
    };

    if db::acknowledge_message(&state.db, id, conv.id)
        .await
        .unwrap_or(false)
    {
        state.hub.broadcast(
            format!("conversation:{}", conv.id),
            "message_acknowledged",
            json!({ "message_id": id }),
        );
    }
    Ok(Json(json!({ "acknowledged": true, "message_id": id })))
}

async fn bot_update_status_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let is_working = payload.get("is_working").and_then(|v| v.as_bool());
    match db::update_bot_status(&state.db, bot.id, None, is_working, Some(payload)).await {
        Ok(Some(updated)) => {
            broadcast_bot_status(&state, &updated);
            Ok(Json(json!({
                "is_connected": updated.is_connected,
                "is_working": updated.is_working,
                "metadata": updated.metadata,
            })))
        }
        _ => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": "Failed to update status" })),
        )),
    }
}

async fn bot_update_capabilities_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    match db::update_bot_status(&state.db, bot.id, None, None, Some(payload)).await {
        Ok(Some(updated)) => {
            broadcast_bot_status(&state, &updated);
            Ok(Json(json!({ "metadata": updated.metadata })))
        }
        _ => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": "Failed to update capabilities" })),
        )),
    }
}

async fn bot_set_models_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    let models = payload
        .get("models")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let saved = db::set_bot_models(&state.db, bot.id, &models)
        .await
        .unwrap_or_default();
    Ok(Json(json!({ "models": saved })))
}

async fn bot_channel_info_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let bot = require_bot(&state, &headers).await?;
    Ok(Json(json!({
        "bot_token_id": bot.id,
        "channel_code": bot.channel_code,
        "topic": format!("bot:{}", bot.channel_code.unwrap_or_else(|| bot.id.to_string())),
    })))
}

// --- Frontend Shell ---

async fn index_handler(State(state): State<Arc<AppState>>) -> Response {
    let index_path = state.static_dir.join("index.html");
    match tokio::fs::read_to_string(&index_path).await {
        Ok(html) => (
            StatusCode::OK,
            [
                (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
                (header::PRAGMA, "no-cache"),
                (header::EXPIRES, "0"),
            ],
            Html(html),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read index.html: {}", e),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ws::PubSubHub;

    #[tokio::test]
    #[ignore = "requires AIMS_TEST_DATABASE_URL pointing to an isolated test database"]
    async fn new_ahp_sessions_have_unique_ids_and_only_ready_sessions_accept_prompts() {
        let pool = sqlx::PgPool::connect(&std::env::var("AIMS_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        db::init_db(&pool).await.unwrap();
        let user_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO users (email) VALUES ($1::citext) RETURNING id",
        )
        .bind(format!("{}@example.test", uuid::Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .unwrap();
        let token = db::create_user_session(&pool, user_id).await.unwrap();
        let (bot, _) = db::create_bot_token(&pool, user_id, "Local host", Some("ahp"), None)
            .await
            .unwrap();
        let state = Arc::new(AppState {
            db: pool.clone(),
            hub: PubSubHub::new(),
            static_dir: PathBuf::new(),
            secret_key_base: "test-secret".into(),
        });
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        let mut events = state.hub.subscribe();
        let request = json!({
            "bot_token_id": bot.id, "title": "morpheus-ui Session",
            "metadata": {"working_directory": "/workspace/morpheus-ui"},
        });
        let error = create_conversation_handler(
            State(state.clone()),
            headers.clone(),
            Json(request.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
        assert!(
            events.try_recv().is_err(),
            "Offline creation must not queue phantom sessions"
        );
        db::update_bot_status(&pool, bot.id, Some(true), None, None)
            .await
            .unwrap();

        let mut sessions = Vec::new();
        for _ in 0..2 {
            let (status, Json(session)) = create_conversation_handler(
                State(state.clone()),
                headers.clone(),
                Json(request.clone()),
            )
            .await
            .unwrap();
            assert_eq!(status, StatusCode::CREATED);
            assert_eq!(session["status"], "creating");
            let external = session["external_session_id"].as_str().unwrap();
            assert!(uuid::Uuid::parse_str(external).is_ok());
            assert_eq!(session["metadata"]["creation_status"], "pending");
            assert_eq!(events.try_recv().unwrap().event, "conversation_created");
            let command = events.try_recv().unwrap();
            assert_eq!(command.event, "create_session");
            assert_eq!(
                command.payload["ahp_create_session"]["channel"],
                format!("ahp-session:/{external}")
            );
            assert!(command.payload.get("ahp_create_chat").is_none());
            let error = create_user_message_handler(
                State(state.clone()),
                headers.clone(),
                Path(session["id"].as_i64().unwrap()),
                Json(json!({"body": "Inspect the project"})),
            )
            .await
            .unwrap_err();
            assert_eq!(error.0, StatusCode::CONFLICT);
            sessions.push(session);
        }
        assert_ne!(
            sessions[0]["external_session_id"],
            sessions[1]["external_session_id"]
        );
        let first = &sessions[0];
        let id = first["id"].as_i64().unwrap();
        let external = first["external_session_id"].as_str().unwrap();
        db::reconcile_default_chat_identity(
            &pool,
            bot.id,
            "host-default",
            &format!("ahp-session:/{external}"),
        )
        .await
        .unwrap();
        let resolved =
            db::resolve_bot_conversation(&pool, &bot, &json!({"external_session_id": external}))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(resolved.id, id);
        assert_eq!(
            resolved.external_session_id.as_deref(),
            Some("host-default")
        );
        db::update_conversation(
            &pool,
            id,
            None,
            Some("idle"),
            Some(json!({
                "creation_status": "ready", "creation_error": null,
            })),
        )
        .await
        .unwrap();
        let (status, _) = create_user_message_handler(
            State(state.clone()),
            headers.clone(),
            Path(id),
            Json(json!({"body": "Inspect the project"})),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(events.try_recv().unwrap().event, "new_message");
        assert_eq!(events.try_recv().unwrap().event, "session_message_created");
        let dispatch = events.try_recv().unwrap();
        assert_eq!(dispatch.event, "user_message");
        assert_eq!(dispatch.payload["external_session_id"], "host-default");

        db::update_conversation(
            &pool,
            id,
            None,
            Some("error"),
            Some(json!({
                "creation_status": "failed", "creation_error": "Host rejected creation",
            })),
        )
        .await
        .unwrap();
        let error = create_user_message_handler(
            State(state.clone()),
            headers.clone(),
            Path(id),
            Json(json!({"body": "Do work"})),
        )
        .await
        .unwrap_err();
        assert_eq!(error.0, StatusCode::CONFLICT);
        assert_eq!(error.1 .0["error"], "Host rejected creation");

        let existing = db::create_conversation(
            &pool,
            user_id,
            bot.id,
            "Synced host chat",
            Some("existing-chat"),
            None,
            json!({}),
        )
        .await
        .unwrap();
        assert_eq!(
            existing.external_session_id.as_deref(),
            Some("existing-chat")
        );
        let (chat_bot, _) = db::create_bot_token(&pool, user_id, "Chat", Some("chat"), None)
            .await
            .unwrap();
        let ordinary = db::create_conversation(
            &pool,
            user_id,
            chat_bot.id,
            "Ordinary chat",
            None,
            None,
            json!({}),
        )
        .await
        .unwrap();
        assert!(ordinary.external_session_id.is_none());
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }
}
