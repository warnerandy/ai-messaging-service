//! Real-time WebSocket hub for frontend clients (`/socket/websocket`) and AHP proxy bots (`/bot/websocket`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use ahp_types::actions::ActionEnvelope;
use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, RwLock};
use tracing::info;
use uuid::Uuid;

use crate::{
    ahp_mirror::{
        build_ahp_cancel_turn_dispatch,
        build_ahp_create_session_params, build_ahp_input_completed_dispatch,
        build_ahp_remove_pending_message_dispatch, build_ahp_session_config_dispatch,
        build_ahp_user_turn_dispatch, translate_state_action, BotAhpMirror,
    },
    db, AppState,
};

#[derive(Debug, Clone)]
pub struct HubEvent {
    pub topic: String,
    pub event: String,
    pub payload: Value,
}

pub struct PubSubHub {
    tx: broadcast::Sender<HubEvent>,
    pub mirrors: RwLock<HashMap<i64, BotAhpMirror>>,
    /// Accumulates streaming markdown text per `(bot_token_id, turn_id)` so when `ChatTurnComplete` fires,
    /// the full assistant message is persisted to PostgreSQL.
    pub streaming_turns: RwLock<HashMap<(i64, String), String>>,
}

impl PubSubHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            tx,
            mirrors: RwLock::new(HashMap::new()),
            streaming_turns: RwLock::new(HashMap::new()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HubEvent> {
        self.tx.subscribe()
    }

    pub fn broadcast(&self, topic: impl Into<String>, event: impl Into<String>, payload: Value) {
        let _ = self.tx.send(HubEvent {
            topic: topic.into(),
            event: event.into(),
            payload,
        });
    }

    pub async fn next_bot_seq(&self, bot_token_id: i64) -> u64 {
        let mut mirrors = self.mirrors.write().await;
        let mirror = mirrors
            .entry(bot_token_id)
            .or_insert_with(|| BotAhpMirror::new(bot_token_id));
        mirror.next_seq()
    }
}

impl Default for PubSubHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Wire frame representation compatible with both Phoenix V1 JSON objects, Phoenix V2 arrays,
/// and raw AHP JSON-RPC / `ActionEnvelope` payloads.
#[derive(Debug, Clone)]
enum WireFormat {
    V1Object,
    V2Array,
}

#[derive(Debug, Clone)]
struct ParsedFrame {
    format: WireFormat,
    join_ref: Option<Value>,
    msg_ref: Option<Value>,
    topic: String,
    event: String,
    payload: Value,
}

fn parse_frame(text: &str) -> Option<ParsedFrame> {
    let val: Value = serde_json::from_str(text).ok()?;
    if let Some(arr) = val.as_array() {
        if arr.len() >= 5 {
            return Some(ParsedFrame {
                format: WireFormat::V2Array,
                join_ref: Some(arr[0].clone()),
                msg_ref: Some(arr[1].clone()),
                topic: arr[2].as_str().unwrap_or("").to_string(),
                event: arr[3].as_str().unwrap_or("").to_string(),
                payload: arr[4].clone(),
            });
        }
    }
    if let Some(obj) = val.as_object() {
        if let (Some(topic), Some(event)) = (
            obj.get("topic").and_then(|v| v.as_str()),
            obj.get("event").and_then(|v| v.as_str()),
        ) {
            return Some(ParsedFrame {
                format: WireFormat::V1Object,
                join_ref: obj.get("join_ref").cloned(),
                msg_ref: obj.get("ref").cloned(),
                topic: topic.to_string(),
                event: event.to_string(),
                payload: obj.get("payload").cloned().unwrap_or_else(|| json!({})),
            });
        }
    }
    None
}

fn encode_frame(
    format: &WireFormat,
    join_ref: Option<Value>,
    msg_ref: Option<Value>,
    topic: &str,
    event: &str,
    payload: Value,
) -> String {
    match format {
        WireFormat::V2Array => serde_json::to_string(&json!([
            join_ref.unwrap_or(Value::Null),
            msg_ref.unwrap_or(Value::Null),
            topic,
            event,
            payload
        ]))
        .unwrap_or_default(),
        WireFormat::V1Object => serde_json::to_string(&json!({
            "join_ref": join_ref.unwrap_or(Value::Null),
            "ref": msg_ref.unwrap_or(Value::Null),
            "topic": topic,
            "event": event,
            "payload": payload
        }))
        .unwrap_or_default(),
    }
}

#[derive(Debug, Deserialize)]
pub struct WsAuthParams {
    pub token: Option<String>,
    pub vsn: Option<String>,
}

// ============================================================================
// Frontend User WebSocket (`/socket/websocket`)
// ============================================================================

pub async fn user_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsAuthParams>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let Some(token) = params.token.as_deref() else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(user)) = db::authenticate_user_token(&state.db, token).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let default_format = if params.vsn.as_deref().unwrap_or("2.0.0").starts_with('2') {
        WireFormat::V2Array
    } else {
        WireFormat::V1Object
    };

    ws.on_upgrade(move |socket| handle_user_socket(socket, state, user, default_format))
}

async fn handle_user_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    user: db::UserRecord,
    default_format: WireFormat,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut hub_rx = state.hub.subscribe();
    let mut joined_topics: HashMap<String, (WireFormat, Option<Value>)> = HashMap::new();
    let mut topic_bots: HashMap<String, i64> = HashMap::new();
    let mut topic_aliases: HashMap<String, String> = HashMap::new();

    loop {
        tokio::select! {
            Some(Ok(msg)) = ws_rx.next() => {
                let WsMessage::Text(text) = msg else {
                    if matches!(msg, WsMessage::Close(_)) {
                        break;
                    }
                    continue;
                };

                let Some(frame) = parse_frame(&text) else {
                    continue;
                };

                if frame.topic == "phoenix" && frame.event == "heartbeat" {
                    let reply = encode_frame(
                        &frame.format,
                        None,
                        frame.msg_ref,
                        "phoenix",
                        "phx_reply",
                        json!({ "status": "ok", "response": {} }),
                    );
                    let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
                    continue;
                }

                if frame.event == "phx_leave" {
                    joined_topics.remove(&frame.topic);
                    topic_aliases.remove(&frame.topic);
                    topic_bots.remove(&frame.topic);
                    let reply = encode_frame(
                        &frame.format,
                        frame.join_ref,
                        frame.msg_ref,
                        &frame.topic,
                        "phx_reply",
                        json!({ "status": "ok", "response": {} }),
                    );
                    let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
                    continue;
                }

                if frame.event == "phx_join" {
                    if let Some(conv_id_str) = frame.topic.strip_prefix("conversation:") {
                        if let Ok(conv_id) = conv_id_str.parse::<i64>() {
                            if let Ok(Some(conv)) = db::get_conversation(&state.db, conv_id, Some(user.id), None).await {
                                let bot = db::get_bot_token(&state.db, conv.bot_token_id, None).await.ok().flatten();
                                joined_topics.insert(frame.topic.clone(), (frame.format.clone(), frame.join_ref.clone()));
                                topic_bots.insert(frame.topic.clone(), conv.bot_token_id);
                                topic_aliases.insert(frame.topic.clone(), format!("conversation:{}", conv.id));

                                // Request AHP session sync from bot proxy
                                state.hub.broadcast(
                                    format!("bot:{}", conv.bot_token_id),
                                    "request_session_sync",
                                    json!({
                                        "conversation_id": conv.id,
                                        "session_id": conv.external_session_id,
                                        "external_session_id": conv.external_session_id,
                                        "metadata": conv.metadata,
                                        "title": conv.title,
                                        "requested_at": chrono::Utc::now().to_rfc3339(),
                                    }),
                                );

                                let reply = encode_frame(
                                    &frame.format,
                                    frame.join_ref,
                                    frame.msg_ref,
                                    &frame.topic,
                                    "phx_reply",
                                    json!({
                                        "status": "ok",
                                        "response": {
                                            "conversation_id": conv.id,
                                            "status": conv.status,
                                            "metadata": conv.metadata,
                                            "bot_metadata": bot.map(|b| b.metadata).unwrap_or_else(|| json!({})),
                                            "external_session_id": conv.external_session_id,
                                        }
                                    }),
                                );
                                let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
                                continue;
                            }
                        }
                    } else if let Some(bot_id_str) = frame.topic.strip_prefix("bot_sessions:") {
                        if let Ok(bot_id) = bot_id_str.parse::<i64>() {
                            if let Ok(Some(bot)) = db::get_bot_token(&state.db, bot_id, Some(user.id)).await {
                                let sessions = db::list_conversations_for_bot(&state.db, bot.id, false)
                                    .await
                                    .unwrap_or_default();
                                joined_topics.insert(frame.topic.clone(), (frame.format.clone(), frame.join_ref.clone()));
                                topic_bots.insert(frame.topic.clone(), bot.id);

                                let reply = encode_frame(
                                    &frame.format,
                                    frame.join_ref,
                                    frame.msg_ref,
                                    &frame.topic,
                                    "phx_reply",
                                    json!({
                                        "status": "ok",
                                        "response": {
                                            "bot_token_id": bot.id,
                                            "sessions": sessions,
                                            "bot": {
                                                "id": bot.id,
                                                "name": bot.name,
                                                "bot_type": bot.bot_type,
                                                "metadata": bot.metadata,
                                                "is_connected": bot.is_connected,
                                                "is_working": bot.is_working,
                                            }
                                        }
                                    }),
                                );
                                let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
                                continue;
                            }
                        }
                    }

                    let err_reply = encode_frame(
                        &frame.format,
                        frame.join_ref,
                        frame.msg_ref,
                        &frame.topic,
                        "phx_reply",
                        json!({ "status": "error", "response": { "reason": "not_found" } }),
                    );
                    let _ = ws_tx.send(WsMessage::Text(err_reply.into())).await;
                    continue;
                }

                // Handle conversation:<id> channel events
                if let Some(conv_id_str) = frame.topic.strip_prefix("conversation:") {
                    if let Ok(conv_id) = conv_id_str.parse::<i64>() {
                        let bot_id = topic_bots.get(&frame.topic).copied();
                        handle_conversation_client_event(
                            &state,
                            &mut ws_tx,
                            conv_id,
                            bot_id,
                            &frame,
                        )
                        .await;
                    }
                }
            }
            Ok(hub_ev) = hub_rx.recv() => {
                if hub_ev.event == "bot_sessions_updated" {
                    if let Some(bot_id) = hub_ev.topic.strip_prefix("bot_sessions:")
                        .and_then(|id| id.parse::<i64>().ok())
                    {
                        for (topic, _) in topic_bots.iter().filter(|(_, id)| **id == bot_id) {
                            if let Some(id) = topic.strip_prefix("conversation:")
                                .and_then(|id| id.parse::<i64>().ok())
                            {
                                if let Ok(Some(conv)) = db::get_conversation(&state.db, id, Some(user.id), Some(bot_id)).await {
                                    topic_aliases.insert(topic.clone(), format!("conversation:{}", conv.id));
                                }
                            }
                        }
                    }
                }
                let recipients: Vec<_> = joined_topics.iter().filter(|(topic, _)| {
                    *topic == &hub_ev.topic || topic_aliases.get(*topic) == Some(&hub_ev.topic)
                }).collect();
                if !recipients.is_empty() {
                    for (topic, (fmt, join_ref)) in recipients {
                        let text = encode_frame(
                            fmt,
                            join_ref.clone(),
                            None,
                            topic,
                            &hub_ev.event,
                            hub_ev.payload.clone(),
                        );
                        if ws_tx.send(WsMessage::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                } else if hub_ev.topic == format!("bot_status:{}", user.id) {
                    // Forward user-wide bot status changes to any joined conversation or bot_sessions topic
                    for (joined_topic, (fmt, join_ref)) in &joined_topics {
                        let text = encode_frame(
                            fmt,
                            join_ref.clone(),
                            None,
                            joined_topic,
                            &hub_ev.event,
                            hub_ev.payload.clone(),
                        );
                        let _ = ws_tx.send(WsMessage::Text(text.into())).await;
                    }
                }
            }
            else => break,
        }
    }
    let _ = default_format;
}

async fn handle_conversation_client_event(
    state: &Arc<AppState>,
    ws_tx: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    conv_id: i64,
    bot_id: Option<i64>,
    frame: &ParsedFrame,
) {
    let conv = db::get_conversation(&state.db, conv_id, None, None)
        .await
        .ok()
        .flatten();
    let conv_id = conv.as_ref().map_or(conv_id, |conversation| conversation.id);
    let ext_id = conv
        .as_ref()
        .and_then(|c| c.external_session_id.clone())
        .unwrap_or_else(|| conv_id.to_string());

    match frame.event.as_str() {
        "answer_question" => {
            if let Some(bid) = bot_id {
                let mut forward = frame.payload.clone();
                if let Some(obj) = forward.as_object_mut() {
                    obj.insert("conversation_id".to_string(), json!(conv_id));
                    obj.insert("session_id".to_string(), json!(ext_id));
                }

                let seq = state.hub.next_bot_seq(bid).await;
                let ahp_dispatch = build_ahp_input_completed_dispatch(
                    &ext_id,
                    frame
                        .payload
                        .get("turn_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("active"),
                    frame
                        .payload
                        .get("part_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("input"),
                    frame
                        .payload
                        .get("question_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0"),
                    &forward,
                    seq,
                );

                state.hub.broadcast(
                    format!("bot:{}", bid),
                    "answer_question",
                    json!({
                        "conversation_id": conv_id,
                        "session_id": ext_id,
                        "payload": forward,
                        "ahp_dispatch": ahp_dispatch,
                    }),
                );
            }
            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": {} }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        "steer" => {
            if let Some(bid) = bot_id {
                let mut forward = frame.payload.clone();
                if let Some(obj) = forward.as_object_mut() {
                    obj.insert("conversation_id".to_string(), json!(conv_id));
                    obj.insert("session_id".to_string(), json!(ext_id));
                    obj.remove("use_worktree");
                    obj.remove("useWorktree");
                    obj.remove("worktree");
                }

                let seq = state.hub.next_bot_seq(bid).await;
                let action_kind = forward
                    .get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("steer");
                let ahp_dispatch = if action_kind == "stop" {
                    build_ahp_cancel_turn_dispatch(&ext_id, "active", seq)
                } else {
                    let instr = forward
                        .get("instruction")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    build_ahp_user_turn_dispatch(
                        &ext_id,
                        "steer",
                        instr,
                        None,
                        &json!({ "is_steer": true }),
                        seq,
                    )
                };

                state.hub.broadcast(
                    format!("bot:{}", bid),
                    "steer",
                    json!({
                        "conversation_id": conv_id,
                        "session_id": ext_id,
                        "action": action_kind,
                        "instruction": forward.get("instruction"),
                        "ahp_dispatch": ahp_dispatch,
                    }),
                );
            }
            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": {} }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        "update_session_config" => {
            let mut config_patch = serde_json::Map::new();
            if let Some(obj) = frame.payload.as_object() {
                for (k, v) in obj {
                    config_patch.insert(k.clone(), v.clone());
                }
            }
            let updated = db::update_conversation(
                &state.db,
                conv_id,
                None,
                None,
                Some(Value::Object(config_patch.clone())),
            )
            .await
            .ok()
            .flatten();

            let meta = updated
                .as_ref()
                .map(|c| c.metadata.clone())
                .unwrap_or_else(|| json!(config_patch));

            state.hub.broadcast(
                format!("conversation:{}", conv_id),
                "session_status_changed",
                json!({
                    "conversation_id": conv_id,
                    "status": updated.as_ref().map(|c| c.status.as_str()).unwrap_or("idle"),
                    "metadata": meta,
                }),
            );

            if let Some(bid) = bot_id {
                state.hub.broadcast(
                    format!("bot_sessions:{}", bid),
                    "session_status_changed",
                    json!({
                        "conversation_id": conv_id,
                        "status": updated.as_ref().map(|c| c.status.as_str()).unwrap_or("idle"),
                        "metadata": meta,
                    }),
                );
                let seq = state.hub.next_bot_seq(bid).await;
                let ahp_dispatch =
                    build_ahp_session_config_dispatch(&ext_id, &frame.payload, seq);
                state.hub.broadcast(
                    format!("bot:{}", bid),
                    "session_config_changed",
                    json!({
                        "conversation_id": conv_id,
                        "session_id": ext_id,
                        "external_session_id": ext_id,
                        "config": frame.payload,
                        "metadata": meta,
                        "ahp_dispatch": ahp_dispatch,
                    }),
                );
            }

            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": { "metadata": meta } }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        "queue_prompt" => {
            let mut current_queue = conv
                .as_ref()
                .and_then(|c| c.metadata.get("prompt_queue"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let item = json!({
                "id": Uuid::new_v4().to_string(),
                "body": frame.payload.get("body").or(Some(&frame.payload)),
                "queued_at": chrono::Utc::now().to_rfc3339(),
            });
            current_queue.push(item.clone());
            let _ = db::update_conversation(
                &state.db,
                conv_id,
                None,
                None,
                Some(json!({ "prompt_queue": current_queue })),
            )
            .await;

            state.hub.broadcast(
                format!("conversation:{}", conv_id),
                "prompt_queue_updated",
                json!({ "prompt_queue": current_queue }),
            );

            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": { "prompt": item, "queue": current_queue } }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        "remove_queued_prompt" => {
            let prompt_id = frame
                .payload
                .get("prompt_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let current_queue: Vec<Value> = conv
                .as_ref()
                .and_then(|c| c.metadata.get("prompt_queue"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|item| item.get("id").and_then(|v| v.as_str()) != Some(prompt_id))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            let _ = db::update_conversation(
                &state.db,
                conv_id,
                None,
                None,
                Some(json!({ "prompt_queue": current_queue })),
            )
            .await;

            if let Some(bid) = bot_id {
                let seq = state.hub.next_bot_seq(bid).await;
                let ahp_dispatch =
                    build_ahp_remove_pending_message_dispatch(&ext_id, prompt_id, seq);
                state.hub.broadcast(
                    format!("bot:{}", bid),
                    "ahp_dispatch",
                    serde_json::to_value(ahp_dispatch).unwrap_or_default(),
                );
            }

            state.hub.broadcast(
                format!("conversation:{}", conv_id),
                "prompt_queue_updated",
                json!({ "prompt_queue": current_queue }),
            );

            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": { "queue": current_queue } }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        "sync_session" => {
            if let Some(bid) = bot_id {
                state.hub.broadcast(
                    format!("bot:{}", bid),
                    "request_session_sync",
                    json!({
                        "conversation_id": conv_id,
                        "session_id": ext_id,
                        "external_session_id": ext_id,
                        "requested_at": chrono::Utc::now().to_rfc3339(),
                    }),
                );
            }
            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": {} }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
        _ => {
            let reply = encode_frame(
                &frame.format,
                frame.join_ref.clone(),
                frame.msg_ref.clone(),
                &frame.topic,
                "phx_reply",
                json!({ "status": "ok", "response": {} }),
            );
            let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
        }
    }
}

// ============================================================================
// AHP Proxy Bot WebSocket (`/bot/websocket`)
// ============================================================================

pub async fn bot_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsAuthParams>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let Some(raw_token) = params.token.as_deref() else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(bot)) = db::authenticate_bot_token(&state.db, raw_token).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let default_format = if params.vsn.as_deref().unwrap_or("2.0.0").starts_with('2') {
        WireFormat::V2Array
    } else {
        WireFormat::V1Object
    };

    ws.on_upgrade(move |socket| handle_bot_socket(socket, state, bot, default_format))
}

async fn handle_bot_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    bot: db::BotTokenRecord,
    default_format: WireFormat,
) {
    // Mark bot connected
    if let Ok(Some(updated)) = db::update_bot_status(&state.db, bot.id, Some(true), None, None).await
    {
        broadcast_bot_status(&state, &updated);
    }

    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut hub_rx = state.hub.subscribe();
    let bot_topic = format!("bot:{}", bot.id);
    let mut active_format = default_format;
    let mut active_channel_topic = format!(
        "bot:{}",
        bot.channel_code
            .clone()
            .unwrap_or_else(|| bot.id.to_string())
    );
    let mut active_join_ref: Option<Value> = None;

    loop {
        tokio::select! {
            Some(Ok(msg)) = ws_rx.next() => {
                let WsMessage::Text(text) = msg else {
                    if matches!(msg, WsMessage::Close(_)) {
                        break;
                    }
                    continue;
                };

                // 1. Check if incoming text is a direct AHP `ActionEnvelope`
                if let Ok(envelope) = serde_json::from_str::<ActionEnvelope>(&text) {
                    handle_incoming_ahp_envelope(&state, &bot, envelope).await;
                    continue;
                }

                // 2. Otherwise parse as Phoenix V1/V2 channel frame
                let Some(frame) = parse_frame(&text) else {
                    continue;
                };
                active_format = frame.format.clone();

                if frame.topic == "phoenix" && frame.event == "heartbeat" {
                    let reply = encode_frame(
                        &frame.format,
                        None,
                        frame.msg_ref,
                        "phoenix",
                        "phx_reply",
                        json!({ "status": "ok", "response": {} }),
                    );
                    let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
                    continue;
                }

                if frame.event == "phx_join" {
                    active_channel_topic = frame.topic.clone();
                    active_join_ref = frame.join_ref.clone();
                    let archived_sessions: Vec<Value> = db::list_conversations_for_bot(&state.db, bot.id, true)
                        .await.unwrap_or_default().into_iter()
                        .filter(|session| session.metadata["explicitly_archived"] == true)
                        .map(|session| json!({
                            "external_session_id": session.external_session_id,
                            "title": session.title,
                        })).collect();

                    let reply = encode_frame(
                        &frame.format,
                        frame.join_ref.clone(),
                        frame.msg_ref.clone(),
                        &frame.topic,
                        "phx_reply",
                        json!({
                            "status": "ok",
                            "response": {
                                "bot_token_id": bot.id,
                                "bot_name": bot.name,
                                "protocol": "ahp",
                                "protocol_version": ahp_types::PROTOCOL_VERSION,
                                "archive_sessions_supported": true,
                                "archived_sessions": archived_sessions,
                            }
                        }),
                    );
                    let _ = ws_tx.send(WsMessage::Text(reply.into())).await;

                    // Send any pending unacknowledged messages
                    if let Ok(pending) = db::get_pending_messages_for_bot(&state.db, bot.id).await {
                        for m in pending {
                            let push = encode_frame(
                                &frame.format,
                                active_join_ref.clone(),
                                None,
                                &active_channel_topic,
                                "user_message",
                                json!({
                                    "id": m.id,
                                    "conversation_id": m.conversation_id,
                                    "content_type": m.content_type,
                                    "body": m.body,
                                    "metadata": m.metadata,
                                    "model": m.model,
                                    "context_size": m.context_size,
                                    "inserted_at": m.inserted_at,
                                }),
                            );
                            let _ = ws_tx.send(WsMessage::Text(push.into())).await;
                        }
                    }

                    // Request models & capabilities on join
                    let req_models = encode_frame(
                        &frame.format,
                        active_join_ref.clone(),
                        None,
                        &active_channel_topic,
                        "request_models",
                        json!({}),
                    );
                    let _ = ws_tx.send(WsMessage::Text(req_models.into())).await;
                    continue;
                }

                handle_bot_channel_event(&state, &mut ws_tx, &bot, &frame).await;
            }
            Ok(hub_ev) = hub_rx.recv() => {
                if hub_ev.topic == bot_topic {
                    let out = encode_frame(
                        &active_format,
                        active_join_ref.clone(),
                        None,
                        &active_channel_topic,
                        &hub_ev.event,
                        hub_ev.payload,
                    );
                    if ws_tx.send(WsMessage::Text(out.into())).await.is_err() {
                        break;
                    }
                }
            }
            else => break,
        }
    }

    // Mark bot disconnected
    if let Ok(Some(updated)) =
        db::update_bot_status(&state.db, bot.id, Some(false), Some(false), None).await
    {
        broadcast_bot_status(&state, &updated);
    }
}

async fn handle_incoming_ahp_envelope(
    state: &Arc<AppState>,
    bot: &db::BotTokenRecord,
    envelope: ActionEnvelope,
) {
    let caps_patch = {
        let mut mirrors = state.hub.mirrors.write().await;
        let mirror = mirrors
            .entry(bot.id)
            .or_insert_with(|| BotAhpMirror::new(bot.id));
        mirror.apply_envelope(&envelope);
        if matches!(
            envelope.action,
            ahp_types::actions::StateAction::RootAgentsChanged(_)
        ) {
            Some(mirror.capabilities_metadata())
        } else {
            None
        }
    };

    if let Some(caps) = caps_patch {
        if let Ok(Some(updated)) =
            db::update_bot_status(&state.db, bot.id, Some(true), None, Some(caps.clone())).await
        {
            broadcast_bot_status(state, &updated);
        }
        if let Some(models) = caps.get("models").and_then(|v| v.as_array()) {
            let _ = db::set_bot_models(&state.db, bot.id, models).await;
        }
    }

    let translated = translate_state_action(&envelope.channel, &envelope.action);
    let Some(ext_id) = translated.external_session_id.as_deref() else {
        return;
    };

    let conv = db::resolve_bot_conversation(
        &state.db,
        bot,
        &json!({ "external_session_id": ext_id }),
    )
    .await
    .ok()
    .flatten();

    let Some(conv) = conv else {
        return;
    };

    // If a turn started on the AHP side (e.g. user typed directly in VS Code), record the user message
    if let ahp_types::actions::StateAction::ChatTurnStarted(ref turn_action) = envelope.action {
        let user_prompt = turn_action.message.text.trim();
        if !user_prompt.is_empty() {
            let already_exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = $1 AND role = 'user' AND body = $2)",
            )
            .bind(conv.id)
            .bind(user_prompt)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);

            if !already_exists {
                if let Ok(msg) = db::create_message(
                    &state.db,
                    conv.id,
                    "user",
                    "text",
                    Some(user_prompt),
                    json!({ "turn_id": turn_action.turn_id, "synced_from_ahp": true }),
                    None,
                    None,
                    false,
                )
                .await
                {
                    state.hub.broadcast(
                        format!("conversation:{}", conv.id),
                        "new_message",
                        json!({ "message": msg }),
                    );
                }
            }
        }
    }

    // Accumulate streaming markdown deltas and finalize on turn_completed
    if let Some(ref delta) = translated.text_delta {
        let turn_id = translated
            .data
            .get("turn_id")
            .and_then(|v| v.as_str())
            .unwrap_or("default")
            .to_string();
        let mut turns = state.hub.streaming_turns.write().await;
        let entry = turns.entry((bot.id, turn_id)).or_default();
        entry.push_str(delta);
    }

    if translated.event_type == "turn_completed" {
        let turn_id = translated
            .data
            .get("turn_id")
            .and_then(|v| v.as_str())
            .unwrap_or("default")
            .to_string();
        let full_text = {
            let mut turns = state.hub.streaming_turns.write().await;
            turns.remove(&(bot.id, turn_id))
        };
        if let Some(body) = full_text.filter(|s| !s.trim().is_empty()) {
            if let Ok(msg) = db::create_message(
                &state.db,
                conv.id,
                "bot",
                "text",
                Some(&body),
                json!({}),
                None,
                None,
                false,
            )
            .await
            {
                state.hub.broadcast(
                    format!("conversation:{}", conv.id),
                    "new_message",
                    json!({ "message": msg }),
                );
            }
        }
    }

    if let Some(ref st) = translated.status {
        if let Ok(Some(updated_conv)) =
            db::update_conversation(
                &state.db, conv.id, None, Some(st),
                Some(json!({ "last_turn_complete": translated.event_type == "turn_completed" })),
            ).await
        {
            state.hub.broadcast(
                format!("conversation:{}", conv.id),
                "session_status_changed",
                json!({
                    "conversation_id": conv.id,
                    "status": updated_conv.status,
                    "metadata": updated_conv.metadata,
                }),
            );
            state.hub.broadcast(
                format!("bot_sessions:{}", bot.id),
                "session_status_changed",
                json!({
                    "conversation_id": conv.id,
                    "status": updated_conv.status,
                    "metadata": updated_conv.metadata,
                }),
            );
        }
    }

    state.hub.broadcast(
        format!("conversation:{}", conv.id),
        "ahp_event",
        json!({
            "event_type": translated.event_type,
            "data": translated.data,
        }),
    );
}

async fn handle_bot_channel_event(
    state: &Arc<AppState>,
    ws_tx: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    bot: &db::BotTokenRecord,
    frame: &ParsedFrame,
) {
    let mut reply_status = "ok";
    let mut reply_response = json!({});

    match frame.event.as_str() {
        "archive_sessions" => {
            if let Some(ids) = frame.payload.get("session_ids").and_then(Value::as_array)
                .filter(|ids| !ids.is_empty() && ids.len() <= 100 && ids.iter().all(Value::is_string))
            {
                let mut archived = Vec::new();
                let mut failed = Vec::new();
                for id in ids {
                    let id = id.as_str().unwrap();
                    match db::archive_completed_bot_session(&state.db, bot.id, id).await {
                        Ok(Some(conv)) => {
                            archived.push(id);
                            let payload = json!({
                                "conversation_id": conv.id,
                                "status": "archived",
                                "metadata": conv.metadata,
                            });
                            state.hub.broadcast(format!("conversation:{}", conv.id), "session_status_changed", payload.clone());
                            state.hub.broadcast(format!("bot_sessions:{}", bot.id), "session_status_changed", payload);
                        }
                        _ => failed.push(id),
                    }
                }
                reply_response = json!({
                    "archived_session_ids": archived,
                    "failed_session_ids": failed,
                });
            } else {
                reply_status = "error";
                reply_response = json!({ "error": "Select between 1 and 100 session IDs." });
            }
        }
        "ahp_envelope" => {
            if let Ok(env) = serde_json::from_value::<ActionEnvelope>(frame.payload.clone()) {
                handle_incoming_ahp_envelope(state, bot, env).await;
            }
        }
        "sync_messages" | "session_messages" => {
            if let Ok(Some(conv)) =
                db::resolve_bot_conversation(&state.db, bot, &frame.payload).await
            {
                if let Some(msgs_arr) = frame.payload.get("messages").and_then(|v| v.as_array()) {
                    let mut inserted = Vec::new();
                    for m in msgs_arr {
                        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("bot");
                        let body = m.get("body").and_then(|v| v.as_str()).unwrap_or("");
                        if body.trim().is_empty() {
                            continue;
                        }
                        let content_type = m
                            .get("content_type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("text");
                        let metadata = m
                            .get("metadata")
                            .cloned()
                            .unwrap_or_else(|| json!({}));

                        let exists = sqlx::query_scalar::<_, bool>(
                            "SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = $1 AND role = $2 AND body = $3)",
                        )
                        .bind(conv.id)
                        .bind(role)
                        .bind(body)
                        .fetch_one(&state.db)
                        .await
                        .unwrap_or(false);

                        if !exists {
                            if let Ok(msg) = db::create_message(
                                &state.db,
                                conv.id,
                                role,
                                content_type,
                                Some(body),
                                metadata,
                                None,
                                None,
                                false,
                            )
                            .await
                            {
                                inserted.push(msg);
                            }
                        }
                    }

                    if !inserted.is_empty() {
                        info!(
                            "Synced {} messages for conversation {}",
                            inserted.len(),
                            conv.id
                        );
                        state.hub.broadcast(
                            format!("conversation:{}", conv.id),
                            "messages_synced",
                            json!({
                                "conversation_id": conv.id,
                                "count": inserted.len(),
                                "messages": inserted,
                            }),
                        );
                    }
                    reply_response = json!({ "synced_count": inserted.len() });
                }
            }
        }
        "bot_message" | "new_message" => {
            if let Ok(Some(conv)) =
                db::resolve_bot_conversation(&state.db, bot, &frame.payload).await
            {
                let content_type = frame
                    .payload
                    .get("content_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("text");
                let body = frame.payload.get("body").and_then(|v| v.as_str());
                let metadata = frame
                    .payload
                    .get("metadata")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let is_suggestion = frame
                    .payload
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
                        reply_response = json!({
                            "id": msg.id,
                            "conversation_id": conv.id,
                            "inserted_at": msg.inserted_at,
                        });
                    }
                    Err(e) => {
                        reply_status = "error";
                        reply_response = json!({ "reason": e });
                    }
                }
            }
        }
        "acknowledge" | "ack" => {
            let msg_id = frame
                .payload
                .get("message_id")
                .or_else(|| frame.payload.get("id"))
                .and_then(|v| v.as_i64());
            if let (Some(mid), Ok(Some(conv))) = (
                msg_id,
                db::resolve_bot_conversation(&state.db, bot, &frame.payload).await,
            ) {
                if db::acknowledge_message(&state.db, mid, conv.id)
                    .await
                    .unwrap_or(false)
                {
                    state.hub.broadcast(
                        format!("conversation:{}", conv.id),
                        "message_acknowledged",
                        json!({ "message_id": mid }),
                    );
                }
                reply_response = json!({ "acknowledged": true, "message_id": mid });
            }
        }
        "status" | "working_status" | "update_status" => {
            let is_working = frame.payload.get("is_working").and_then(|v| v.as_bool());
            if let Ok(Some(updated)) = db::update_bot_status(
                &state.db,
                bot.id,
                Some(true),
                is_working,
                Some(frame.payload.clone()),
            )
            .await
            {
                broadcast_bot_status(state, &updated);
                reply_response = json!({
                    "is_working": updated.is_working,
                    "metadata": updated.metadata,
                });
            }
        }
        "capabilities"
        | "capabilities_sync"
        | "update_capabilities"
        | "register_capabilities"
        | "set_capabilities"
        | "sync_capabilities"
        | "bot_info" => {
            if let Ok(Some(updated)) = db::update_bot_status(
                &state.db,
                bot.id,
                Some(true),
                None,
                Some(frame.payload.clone()),
            )
            .await
            {
                broadcast_bot_status(state, &updated);
                reply_response = json!({ "metadata": updated.metadata });
            }
        }
        "set_models" | "models" => {
            if let Some(models) = frame.payload.get("models").and_then(|v| v.as_array()) {
                if let Ok(saved) = db::set_bot_models(&state.db, bot.id, models).await {
                    reply_response = json!({ "count": saved.len() });
                }
            }
        }
        "sync_sessions" | "sessions_list" | "reconcile_sessions" => {
            let existing_only = frame.event == "reconcile_sessions";
            if let Some(sessions_arr) = frame.payload.get("sessions").and_then(|v| v.as_array()) {
                let mut synced_ids = HashSet::new();
                for s in sessions_arr {
                    let Some(sid) = s
                        .get("session_id")
                        .or_else(|| s.get("id"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    else {
                        continue;
                    };
                    synced_ids.insert(sid.to_string());
                    let title = s
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("AHP Session");
                    let status = s.get("status").and_then(|v| v.as_str()).unwrap_or("idle");
                    let mut meta = s
                        .get("metadata")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    if let Some(obj) = meta.as_object_mut() {
                        obj.insert("synced_by_bot".to_string(), json!(true));
                        for k in [
                            "project",
                            "working_directory",
                            "working_directories",
                            "cwd",
                            "worktrees",
                            "worktree",
                            "worktree_supported",
                            "worktrees_supported",
                            "worktrees_enabled",
                            "worktree_enabled",
                            "supports_worktrees",
                            "supports_worktree",
                            "allow_worktree",
                            "use_worktree",
                            "base_branch",
                            "branches",
                            "agent_mode",
                            "agent_type",
                        ] {
                            if let Some(v) = s.get(k) {
                                obj.insert(k.to_string(), v.clone());
                            }
                        }
                    }
                    if let Some(parent) = meta["session_uri"].as_str() {
                        if let Err(error) = db::reconcile_default_chat_identity(
                            &state.db, bot.id, sid, parent,
                        ).await {
                            tracing::warn!("Default chat identity reconciliation failed: {error}");
                            continue;
                        }
                    }

                    if existing_only {
                        let _ = db::reconcile_conversation(
                            &state.db, bot.id, sid, title, status, meta,
                        ).await;
                    } else if let Ok(Some(existing)) =
                        db::get_conversation_by_external_session(&state.db, bot.id, sid).await
                    {
                        let _ = db::update_conversation(
                            &state.db,
                            existing.id,
                            Some(title),
                            Some(status),
                            Some(meta),
                        )
                        .await;
                    } else {
                        let _ = db::create_conversation(
                            &state.db,
                            bot.user_id,
                            bot.id,
                            title,
                            Some(sid),
                            Some(status),
                            meta,
                        )
                        .await;
                        if let Some(parent) = s["metadata"]["session_uri"].as_str() {
                            if let Err(error) = db::reconcile_default_chat_identity(
                                &state.db, bot.id, sid, parent,
                            ).await {
                                tracing::warn!("New default chat alias reconciliation failed: {error}");
                            }
                        }
                    }
                }

                let all_active = db::list_conversations_for_bot(&state.db, bot.id, false)
                    .await
                    .unwrap_or_default();
                state.hub.broadcast(
                    format!("bot_sessions:{}", bot.id),
                    "bot_sessions_updated",
                    json!({
                        "bot_token_id": bot.id,
                        "sessions": all_active,
                    }),
                );
                reply_response = json!({ "count": synced_ids.len() });
            }
        }
        "session_status" => {
            if let Ok(Some(conv)) =
                db::resolve_bot_conversation(&state.db, bot, &frame.payload).await
            {
                let status = frame
                    .payload
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("idle");
                let meta = frame
                    .payload
                    .get("metadata")
                    .cloned()
                    .unwrap_or_else(|| frame.payload.clone());
                if let Ok(Some(updated)) =
                    db::update_conversation(&state.db, conv.id, None, Some(status), Some(meta))
                        .await
                {
                    // If session advertised truthy worktree capability, ensure bot token metadata matches
                    let is_truthy = |v: &Value| {
                        matches!(v, Value::Bool(true))
                            || matches!(v, Value::String(s) if {
                                let l = s.trim().to_lowercase();
                                l == "true" || l == "enabled" || l == "supported"
                            })
                    };
                    if [
                        "worktree_supported",
                        "worktrees_supported",
                        "worktrees",
                        "worktrees_enabled",
                        "worktree_enabled",
                        "supports_worktrees",
                        "supports_worktree",
                    ]
                    .iter()
                    .any(|k| updated.metadata.get(*k).map(is_truthy).unwrap_or(false))
                    {
                        let _ = db::update_bot_status(
                            &state.db,
                            bot.id,
                            None,
                            None,
                            Some(json!({
                                "worktree_supported": true,
                                "worktrees_supported": true,
                                "worktrees_enabled": true,
                                "worktrees": true
                            })),
                        )
                        .await;
                    }

                    state.hub.broadcast(
                        format!("conversation:{}", conv.id),
                        "session_status_changed",
                        json!({
                            "conversation_id": conv.id,
                            "status": updated.status,
                            "metadata": updated.metadata,
                        }),
                    );
                    state.hub.broadcast(
                        format!("bot_sessions:{}", bot.id),
                        "session_status_changed",
                        json!({
                            "conversation_id": conv.id,
                            "status": updated.status,
                            "metadata": updated.metadata,
                        }),
                    );
                }
            }
        }
        "ahp_event" | "agent_event" | "thinking" | "thought" | "reasoning" | "step"
        | "tool_call" | "plan" | "changeset" | "question" | "subagent" | "subagents"
        | "process" | "processes" => {
            if let Ok(Some(conv)) =
                db::resolve_bot_conversation(&state.db, bot, &frame.payload).await
            {
                let ev_type = frame
                    .payload
                    .get("event_type")
                    .or_else(|| frame.payload.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(frame.event.as_str());
                let data = frame
                    .payload
                    .get("data")
                    .cloned()
                    .unwrap_or_else(|| frame.payload.clone());

                state.hub.broadcast(
                    format!("conversation:{}", conv.id),
                    "ahp_event",
                    json!({
                        "event_type": ev_type,
                        "data": data,
                    }),
                );
            }
        }
        _ => {}
    }

    if frame.msg_ref.is_some() {
        let reply = encode_frame(
            &frame.format,
            frame.join_ref.clone(),
            frame.msg_ref.clone(),
            &frame.topic,
            "phx_reply",
            json!({ "status": reply_status, "response": reply_response }),
        );
        let _ = ws_tx.send(WsMessage::Text(reply.into())).await;
    }
}

pub fn broadcast_bot_status(state: &Arc<AppState>, bot: &db::BotTokenRecord) {
    let payload = json!({
        "bot_token_id": bot.id,
        "is_connected": bot.is_connected,
        "is_working": bot.is_working,
        "bot": {
            "id": bot.id,
            "name": bot.name,
            "bot_type": bot.bot_type,
            "metadata": bot.metadata,
            "is_connected": bot.is_connected,
            "is_working": bot.is_working,
        }
    });
    state
        .hub
        .broadcast(format!("bot_sessions:{}", bot.id), "bot_updated", payload.clone());
    state.hub.broadcast(
        format!("bot_status:{}", bot.user_id),
        "bot_status_changed",
        payload,
    );
}

/// Ask the proxy to create a host session, which owns its default chat.
pub async fn notify_bot_session_created(state: &Arc<AppState>, conv: &db::ConversationRecord) {
    state.hub.broadcast(
        format!("bot_sessions:{}", conv.bot_token_id),
        "conversation_created",
        json!({ "conversation": conv }),
    );

    let ext_id = conv
        .external_session_id
        .as_deref()
        .unwrap_or("default-session");
    let create_session = build_ahp_create_session_params(ext_id, &conv.metadata);

    state.hub.broadcast(
        format!("bot:{}", conv.bot_token_id),
        "create_session",
        json!({
            "conversation_id": conv.id,
            "session_id": conv.external_session_id,
            "external_session_id": conv.external_session_id,
            "title": conv.title,
            "status": conv.status,
            "metadata": conv.metadata,
            "ahp_create_session": create_session,
        }),
    );
}

/// Broadcast a newly created user message and its AHP `ChatTurnStarted` / `MessageAttachment` dispatch to the connected AHP proxy.
pub async fn notify_bot_user_message(
    state: &Arc<AppState>,
    conv: &db::ConversationRecord,
    msg: &db::MessageRecord,
) {
    state.hub.broadcast(
        format!("conversation:{}", conv.id),
        "new_message",
        json!({ "message": msg }),
    );
    state.hub.broadcast(
        format!("bot_sessions:{}", conv.bot_token_id),
        "session_message_created",
        json!({
            "conversation_id": conv.id,
            "updated_at": msg.inserted_at,
        }),
    );

    let ext_id = conv
        .external_session_id
        .as_deref()
        .unwrap_or("default-session");
    let seq = state.hub.next_bot_seq(conv.bot_token_id).await;
    let turn_id = format!("turn-{}", msg.id);
    let ahp_dispatch = build_ahp_user_turn_dispatch(
        ext_id,
        &turn_id,
        msg.body.as_deref().unwrap_or(""),
        msg.model.as_deref(),
        &msg.metadata,
        seq,
    );

    state.hub.broadcast(
        format!("bot:{}", conv.bot_token_id),
        "user_message",
        json!({
            "id": msg.id,
            "conversation_id": conv.id,
            "session_id": conv.external_session_id,
            "external_session_id": conv.external_session_id,
            "content_type": msg.content_type,
            "body": msg.body,
            "metadata": msg.metadata,
            "model": msg.model,
            "context_size": msg.context_size,
            "is_suggestion": msg.is_suggestion,
            "inserted_at": msg.inserted_at,
            "ahp_dispatch": ahp_dispatch,
        }),
    );
}
