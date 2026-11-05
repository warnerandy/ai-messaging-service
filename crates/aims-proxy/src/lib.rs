//! `aims-proxy` — Bidirectional Agent Host Protocol (AHP) proxy agent.
//!
//! Connects to a local AHP server on the host machine via `ahp` + `ahp-ws` (`WebSocketTransport`),
//! mirrors state with `ahp::MultiHostStateMirror`, and bridges all AHP sessions, chats, turns,
//! tool calls, reasoning streams, and mobile image/asset attachments to `aims-server`.

use std::collections::HashSet;
use std::sync::Arc;

use ahp::hosts::HostId;
use ahp::{Client, ClientConfig, MultiHostStateMirror, SubscriptionEvent};
use ahp_types::actions::StateAction;
use ahp_types::commands::{
    CreateChatParams, CreateSessionParams, DispatchActionParams, ListSessionsParams,
    ListSessionsResult,
};
use ahp_types::state::{RootState, SnapshotState};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// Local AHP server WebSocket URL (e.g., `ws://127.0.0.1:12345`)
    pub local_ahp_url: String,
    /// Upstream `aims-server` WebSocket URL (e.g., `ws://127.0.0.1:4000/bot/websocket`)
    pub upstream_ws_url: String,
    /// Bot authentication token generated in the Web UI
    pub bot_token: String,
    /// Default working directory for new sessions if none specified
    pub default_working_directory: Option<String>,
}

/// Run a single proxy session bridging a local `ahp::Client` and the upstream `aims-server` WebSocket.
pub async fn run_proxy(config: ProxyConfig) -> Result<(), Box<dyn std::error::Error>> {
    info!(
        "Connecting to local AHP server at {}...",
        config.local_ahp_url
    );
    let ahp_transport = ahp_ws::WebSocketTransport::connect(&config.local_ahp_url).await?;
    let ahp_client = Arc::new(Client::connect(ahp_transport, ClientConfig::default()).await?);

    let init = ahp_client
        .initialize(
            format!("aims-proxy-{}", uuid::Uuid::new_v4()),
            vec![ahp_types::PROTOCOL_VERSION.to_string()],
            vec![ahp_types::ROOT_RESOURCE_URI.to_string()],
        )
        .await?;
    info!(
        "Connected to local AHP server (protocolVersion={})",
        init.protocol_version
    );

    let host_id = HostId::new("local");
    let mirror = Arc::new(Mutex::new(MultiHostStateMirror::new()));
    let mut initial_capabilities = json!({
        "protocol": "ahp",
        "protocol_version": init.protocol_version,
        "worktree_supported": true,
    });

    // Apply initial snapshots returned by `initialize`
    for snap in &init.snapshots {
        mirror.lock().await.apply_snapshot(&host_id, snap);
        if let SnapshotState::Root(ref root_state) = snap.state {
            initial_capabilities = extract_root_capabilities(root_state);
        }
    }

    // Subscribe to ahp-root:// on the local AHP server
    if let Ok((sub_res, _sub_handle)) = ahp_client
        .subscribe(ahp_types::ROOT_RESOURCE_URI.to_string())
        .await
    {
        if let Some(ref snap) = sub_res.snapshot {
            mirror.lock().await.apply_snapshot(&host_id, snap);
            if let SnapshotState::Root(ref root_state) = snap.state {
                initial_capabilities = extract_root_capabilities(root_state);
            }
        }
    }

    // Connect upstream to aims-server
    let sep = if config.upstream_ws_url.contains('?') {
        "&"
    } else {
        "?"
    };
    let full_upstream_url = format!(
        "{}{}token={}&vsn=1.0.0",
        config.upstream_ws_url, sep, config.bot_token
    );
    info!("Connecting upstream to aims-server...");
    let (upstream_ws, _) = tokio_tungstenite::connect_async(&full_upstream_url).await?;
    let (mut up_tx, mut up_rx) = upstream_ws.split();

    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<Value>();

    // Join bot channel and publish initial capabilities + models
    let _ = outbound_tx.send(json!({
        "topic": "bot:proxy",
        "event": "phx_join",
        "payload": {},
        "ref": "1"
    }));
    let _ = outbound_tx.send(json!({
        "topic": "bot:proxy",
        "event": "capabilities_sync",
        "payload": initial_capabilities,
        "ref": "2"
    }));
    if let Some(models) = initial_capabilities.get("models") {
        let _ = outbound_tx.send(json!({
            "topic": "bot:proxy",
            "event": "set_models",
            "payload": { "models": models },
            "ref": "3"
        }));
    }

    // Track subscribed AHP resource URIs so we auto-subscribe to new sessions and chats
    let subscribed_uris = Arc::new(Mutex::new(HashSet::<String>::new()));
    subscribed_uris
        .lock()
        .await
        .insert(ahp_types::ROOT_RESOURCE_URI.to_string());

    // Spawn root subscription forwarder
    spawn_resource_listener(
        Arc::clone(&ahp_client),
        Arc::clone(&mirror),
        Arc::clone(&subscribed_uris),
        ahp_types::ROOT_RESOURCE_URI.to_string(),
        outbound_tx.clone(),
    );

    // Discover and subscribe to all existing active AHP sessions and their chats
    let list_params = ListSessionsParams {
        channel: ahp_types::ROOT_RESOURCE_URI.to_string(),
        meta: None,
        limit: Some(100),
        cursor: None,
    };
    if let Ok(res) = ahp_client
        .request::<_, ListSessionsResult>("listSessions", list_params)
        .await
    {
        info!(
            "Discovered {} existing AHP sessions on startup",
            res.items.len()
        );
        for item in res.items {
            ensure_resource_subscribed(
                &ahp_client,
                &mirror,
                &subscribed_uris,
                &item.resource,
                &outbound_tx,
            )
            .await;
        }
    }

    loop {
        tokio::select! {
            Some(frame_val) = outbound_rx.recv() => {
                let text = serde_json::to_string(&frame_val)?;
                if up_tx.send(WsMessage::Text(text.into())).await.is_err() {
                    break;
                }
            }
            Some(Ok(ws_msg)) = up_rx.next() => {
                let WsMessage::Text(text) = ws_msg else {
                    if matches!(ws_msg, WsMessage::Close(_)) {
                        break;
                    }
                    continue;
                };

                let Ok(val) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                let event = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let payload = val.get("payload").cloned().unwrap_or_else(|| json!({}));

                handle_upstream_command(
                    &ahp_client,
                    &mirror,
                    &subscribed_uris,
                    &outbound_tx,
                    &config,
                    event,
                    &payload,
                )
                .await;
            }
            else => break,
        }
    }

    ahp_client.shutdown().await;
    Ok(())
}

fn spawn_resource_listener(
    ahp_client: Arc<Client>,
    mirror: Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: Arc<Mutex<HashSet<String>>>,
    resource_uri: String,
    outbound_tx: mpsc::UnboundedSender<Value>,
) {
    tokio::spawn(async move {
        let mut rx = ahp_client.attach_subscription(&resource_uri).await;
        let host_id = HostId::new("local");

        while let Some(ev) = rx.recv().await {
            match ev {
                SubscriptionEvent::Action(envelope) => {
                    {
                        let mut m = mirror.lock().await;
                        m.apply_envelope(&host_id, &envelope);
                    }

                    // If a new chat was added to a session, subscribe to the chat channel
                    if let StateAction::SessionChatAdded(ref chat_added) = envelope.action {
                        ensure_resource_subscribed(
                            &ahp_client,
                            &mirror,
                            &subscribed_uris,
                            &chat_added.summary.resource,
                            &outbound_tx,
                        )
                        .await;
                    }

                    // Forward the raw AHP ActionEnvelope upstream to aims-server
                    let _ = outbound_tx.send(json!({
                        "topic": "bot:proxy",
                        "event": "ahp_envelope",
                        "payload": envelope,
                    }));
                }
                SubscriptionEvent::SessionAdded(notif) => {
                    ensure_resource_subscribed(
                        &ahp_client,
                        &mirror,
                        &subscribed_uris,
                        &notif.summary.resource,
                        &outbound_tx,
                    )
                    .await;
                }
                _ => {}
            }
        }
    });
}

async fn ensure_resource_subscribed(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: &Arc<Mutex<HashSet<String>>>,
    uri: &str,
    outbound_tx: &mpsc::UnboundedSender<Value>,
) {
    {
        let mut set = subscribed_uris.lock().await;
        if !set.insert(uri.to_string()) {
            return;
        }
    }

    match ahp_client.subscribe(uri.to_string()).await {
        Ok((res, _sub_handle)) => {
            if let Some(ref snap) = res.snapshot {
                let host_id = HostId::new("local");
                mirror.lock().await.apply_snapshot(&host_id, snap);
                if let SnapshotState::Session(ref session_state) = snap.state {
                    for chat in &session_state.chats {
                        Box::pin(ensure_resource_subscribed(
                            ahp_client,
                            mirror,
                            subscribed_uris,
                            &chat.resource,
                            outbound_tx,
                        ))
                        .await;
                    }
                } else if let SnapshotState::Chat(ref chat_state) = snap.state {
                    let mut messages = Vec::new();
                    for turn in &chat_state.turns {
                        let user_prompt = turn.message.text.trim();
                        if !user_prompt.is_empty() {
                            messages.push(json!({
                                "role": "user",
                                "content_type": "text",
                                "body": user_prompt,
                                "inserted_at": turn.started_at,
                                "metadata": {
                                    "turn_id": turn.id,
                                }
                            }));
                        }

                        let mut bot_text_parts = Vec::new();
                        let mut tool_calls = Vec::new();
                        for part in &turn.response_parts {
                            match part {
                                ahp_types::state::ResponsePart::Markdown(ref m) => {
                                    if !m.content.trim().is_empty() {
                                        bot_text_parts.push(m.content.clone());
                                    }
                                }
                                ahp_types::state::ResponsePart::ToolCall(ref tc) => {
                                    if let Ok(tc_val) = serde_json::to_value(&tc.tool_call) {
                                        tool_calls.push(tc_val);
                                    }
                                }
                                _ => {}
                            }
                        }

                        let bot_body = bot_text_parts.join("\n\n");
                        if !bot_body.trim().is_empty() || !tool_calls.is_empty() {
                            let mut meta = json!({ "turn_id": turn.id });
                            if !tool_calls.is_empty() {
                                meta["tool_calls"] = json!(tool_calls);
                            }
                            messages.push(json!({
                                "role": "bot",
                                "content_type": "text",
                                "body": if bot_body.trim().is_empty() { " " } else { &bot_body },
                                "inserted_at": turn.started_at,
                                "metadata": meta,
                            }));
                        }
                    }

                    if !messages.is_empty() {
                        info!(
                            "Sending {} historical messages for chat {}",
                            messages.len(),
                            uri
                        );
                        let _ = outbound_tx.send(json!({
                            "topic": "bot:proxy",
                            "event": "sync_messages",
                            "payload": {
                                "chat_uri": uri,
                                "external_session_id": uri,
                                "messages": messages,
                            }
                        }));
                    }
                }
            }
            spawn_resource_listener(
                Arc::clone(ahp_client),
                Arc::clone(mirror),
                Arc::clone(subscribed_uris),
                uri.to_string(),
                outbound_tx.clone(),
            );
        }
        Err(e) => {
            warn!("Failed to subscribe to AHP resource {}: {}", uri, e);
        }
    }
}

async fn handle_upstream_command(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: &Arc<Mutex<HashSet<String>>>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
    config: &ProxyConfig,
    event: &str,
    payload: &Value,
) {
    match event {
        "create_session" => {
            if let Some(cs_val) = payload.get("ahp_create_session") {
                if let Ok(mut cs_params) =
                    serde_json::from_value::<CreateSessionParams>(cs_val.clone())
                {
                    if cs_params.working_directories.is_none() {
                        cs_params.working_directories = config
                            .default_working_directory
                            .as_ref()
                            .map(|wd| vec![wd.clone()]);
                    }
                    let session_uri = cs_params.channel.clone();
                    if let Err(e) = ahp_client
                        .request::<_, Value>("createSession", cs_params)
                        .await
                    {
                        warn!("AHP createSession returned: {}", e);
                    }
                    ensure_resource_subscribed(
                        ahp_client,
                        mirror,
                        subscribed_uris,
                        &session_uri,
                        outbound_tx,
                    )
                    .await;
                }
            }
            if let Some(cc_val) = payload.get("ahp_create_chat") {
                if let Ok(cc_params) = serde_json::from_value::<CreateChatParams>(cc_val.clone()) {
                    let chat_uri = cc_params.chat.clone();
                    if let Err(e) = ahp_client
                        .request::<_, Value>("createChat", cc_params)
                        .await
                    {
                        warn!("AHP createChat returned: {}", e);
                    }
                    ensure_resource_subscribed(
                        ahp_client,
                        mirror,
                        subscribed_uris,
                        &chat_uri,
                        outbound_tx,
                    )
                    .await;
                }
            }
        }
        "user_message" => {
            // Acknowledge receipt immediately
            if let (Some(mid), Some(cid)) = (
                payload.get("id").and_then(|v| v.as_i64()),
                payload.get("conversation_id").and_then(|v| v.as_i64()),
            ) {
                let _ = outbound_tx.send(json!({
                    "topic": "bot:proxy",
                    "event": "acknowledge",
                    "payload": { "message_id": mid, "conversation_id": cid },
                }));
            }

            if let Some(disp_val) = payload.get("ahp_dispatch") {
                if let Ok(dispatch_params) =
                    serde_json::from_value::<DispatchActionParams>(disp_val.clone())
                {
                    ensure_resource_subscribed(
                        ahp_client,
                        mirror,
                        subscribed_uris,
                        &dispatch_params.channel,
                        outbound_tx,
                    )
                    .await;

                    if let Err(e) = ahp_client
                        .dispatch(dispatch_params.channel, dispatch_params.action)
                        .await
                    {
                        error!("Failed to dispatch AHP user turn action: {}", e);
                    }
                }
            }
        }
        "steer" | "answer_question" | "session_config_changed" => {
            if let Some(disp_val) = payload.get("ahp_dispatch") {
                if let Ok(dispatch_params) =
                    serde_json::from_value::<DispatchActionParams>(disp_val.clone())
                {
                    if let Err(e) = ahp_client
                        .dispatch(dispatch_params.channel, dispatch_params.action)
                        .await
                    {
                        warn!("Failed to dispatch AHP {} action: {}", event, e);
                    }
                }
            }
        }
        "ahp_dispatch" => {
            if let Ok(dispatch_params) =
                serde_json::from_value::<DispatchActionParams>(payload.clone())
            {
                let _ = ahp_client
                    .dispatch(dispatch_params.channel, dispatch_params.action)
                    .await;
            }
        }
        "request_session_sync" => {
            let ext_id = payload
                .get("external_session_id")
                .or_else(|| payload.get("session_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            info!(
                "AHP proxy handling request_session_sync for external_session_id={}",
                ext_id
            );

            // Re-list sessions to discover any newly created or existing sessions
            let list_params = ListSessionsParams {
                channel: ahp_types::ROOT_RESOURCE_URI.to_string(),
                meta: None,
                limit: Some(100),
                cursor: None,
            };
            if let Ok(res) = ahp_client
                .request::<_, ListSessionsResult>("listSessions", list_params)
                .await
            {
                for item in res.items {
                    // Force re-fetch snapshot turns by removing from set first
                    subscribed_uris.lock().await.remove(&item.resource);
                    ensure_resource_subscribed(
                        ahp_client,
                        mirror,
                        subscribed_uris,
                        &item.resource,
                        outbound_tx,
                    )
                    .await;
                }
            }

            // If ext_id contains a chat URI, also directly re-subscribe to fetch turns
            if ext_id.contains("ahp-chat:") {
                let chat_uri = if ext_id.starts_with("ahp-chat:") {
                    ext_id.to_string()
                } else if let Some(idx) = ext_id.find("ahp-chat:") {
                    ext_id[idx..].split('&').next().unwrap_or("").to_string()
                } else {
                    ext_id.to_string()
                };
                subscribed_uris.lock().await.remove(&chat_uri);
                ensure_resource_subscribed(
                    ahp_client,
                    mirror,
                    subscribed_uris,
                    &chat_uri,
                    outbound_tx,
                )
                .await;
            }
        }
        _ => {}
    }
}

pub fn extract_root_capabilities(root: &RootState) -> Value {
    let mut agent_roles = Vec::new();
    let mut models = Vec::new();

    for agent in &root.agents {
        agent_roles.push(json!({
            "id": agent.provider,
            "name": agent.display_name,
            "description": agent.description,
        }));
        for m in &agent.models {
            models.push(json!({
                "name": m.id,
                "display_name": m.name,
                "provider": m.provider,
                "input_cost_per_token": "0",
                "output_cost_per_token": "0",
                "context_sizes": m.max_prompt_tokens.or(m.max_context_window).map(|t| vec![t]).unwrap_or_else(|| vec![200_000]),
            }));
        }
    }

    json!({
        "protocol": "ahp",
        "protocol_version": ahp_types::PROTOCOL_VERSION,
        "agent_roles": agent_roles,
        "models": models,
        "modes": [
            { "id": "interactive", "name": "Interactive" },
            { "id": "plan", "name": "Plan" },
            { "id": "autopilot", "name": "Autopilot" }
        ],
        "worktree_supported": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ahp_types::state::{AgentInfo, SessionModelInfo};

    #[test]
    fn test_extract_root_capabilities_from_ahp_root_state() {
        let root = RootState {
            agents: vec![AgentInfo {
                provider: "copilot".to_string(),
                display_name: "GitHub Copilot".to_string(),
                description: "VS Code AHP Agent".to_string(),
                models: vec![SessionModelInfo {
                    id: "claude-sonnet-4".to_string(),
                    provider: "copilot".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    max_context_window: Some(200_000),
                    max_output_tokens: Some(16_384),
                    max_prompt_tokens: Some(200_000),
                    supports_vision: Some(true),
                    policy_state: None,
                    config_schema: None,
                    meta: None,
                }],
                protected_resources: None,
                customizations: None,
                capabilities: None,
            }],
            active_sessions: Some(1),
            terminals: None,
            config: None,
            meta: None,
        };

        let caps = extract_root_capabilities(&root);
        assert_eq!(caps["protocol"], "ahp");
        assert_eq!(caps["worktree_supported"], true);
        assert_eq!(caps["agent_roles"][0]["id"], "copilot");
        assert_eq!(caps["models"][0]["name"], "claude-sonnet-4");
    }
}
