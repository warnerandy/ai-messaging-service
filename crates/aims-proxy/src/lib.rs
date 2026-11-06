//! `aims-proxy` — Bidirectional Agent Host Protocol (AHP) proxy agent.
//!
//! Connects to a local AHP server on the host machine via `ahp` + `ahp-ws` (`WebSocketTransport`),
//! mirrors state with `ahp::MultiHostStateMirror`, and bridges all AHP sessions, chats, turns,
//! tool calls, reasoning streams, and mobile image/asset attachments to `aims-server`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use ahp::hosts::HostId;
use ahp::{Client, ClientConfig, MultiHostStateMirror, SubscriptionEvent};
use ahp_types::actions::StateAction;
use ahp_types::commands::{
    CreateSessionParams, DispatchActionParams, ListSessionsParams,
    ListSessionsResult,
};
use ahp_types::state::{
    ChatState, ChatSummary, ProjectInfo, RootState, SessionState, SessionSummary, SnapshotState,
};
use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{error, info, warn};

pub mod discovery;
pub mod admin;
mod visibility;

/// Transport adapter for any stream implementing `AsyncRead + AsyncWrite + Unpin + Send + 'static`
/// (such as `tokio::net::UnixStream` on macOS/Linux).
pub struct GenericWsTransport<S> {
    inner: tokio_tungstenite::WebSocketStream<S>,
}

impl<S> GenericWsTransport<S> {
    pub fn new(inner: tokio_tungstenite::WebSocketStream<S>) -> Self {
        Self { inner }
    }
}

impl<S> ahp::Transport for GenericWsTransport<S>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    async fn send(&mut self, msg: ahp::TransportMessage) -> Result<(), ahp::TransportError> {
        let frame = match msg {
            ahp::TransportMessage::Parsed(m) => {
                let s = serde_json::to_string(&m)
                    .map_err(|e| ahp::TransportError::Protocol(e.to_string()))?;
                WsMessage::Text(s.into())
            }
            ahp::TransportMessage::Text(s) => WsMessage::Text(s.into()),
            ahp::TransportMessage::Binary(b) => WsMessage::Binary(b.into()),
        };
        self.inner
            .send(frame)
            .await
            .map_err(|e| ahp::TransportError::Io(e.to_string()))
    }

    async fn recv(&mut self) -> Result<Option<ahp::TransportMessage>, ahp::TransportError> {
        loop {
            match self.inner.next().await {
                None => return Ok(None),
                Some(Err(e)) => return Err(ahp::TransportError::Io(e.to_string())),
                Some(Ok(WsMessage::Text(s))) => {
                    return Ok(Some(ahp::TransportMessage::Text(s.to_string())))
                }
                Some(Ok(WsMessage::Binary(b))) => {
                    return Ok(Some(ahp::TransportMessage::Binary(b.into())))
                }
                Some(Ok(WsMessage::Close(_))) => return Ok(None),
                Some(Ok(_)) => continue,
            }
        }
    }

    async fn close(&mut self) -> Result<(), ahp::TransportError> {
        self.inner
            .close(None)
            .await
            .map_err(|e| ahp::TransportError::Io(e.to_string()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// Local AHP server WebSocket URL (e.g., `ws://127.0.0.1:4034/ahp/v1`)
    pub local_ahp_url: Option<String>,
    /// Local AHP Unix domain socket path (macOS / Linux)
    pub local_ahp_socket: Option<std::path::PathBuf>,
    /// Secret authentication token to append as `?tkn=<token>`
    pub local_ahp_token: Option<String>,
    /// Upstream `aims-server` WebSocket URL (e.g., `ws://127.0.0.1:4000/bot/websocket`)
    pub upstream_ws_url: String,
    /// Bot authentication token generated in the Web UI
    pub bot_token: String,
    /// Default working directory for new sessions if none specified
    pub default_working_directory: Option<String>,
}

/// Run a single proxy session bridging a local `ahp::Client` and the upstream `aims-server` WebSocket.
pub async fn run_proxy(config: ProxyConfig) -> Result<(), Box<dyn std::error::Error>> {
    let (_sender, mut commands) = mpsc::channel(1);
    run_proxy_with_admin(config, None, &mut commands).await
}

#[derive(Default)]
pub struct DeliveryReceipts {
    dispatched: Mutex<HashMap<(i64, i64), Arc<Mutex<bool>>>>,
}

pub async fn run_proxy_with_admin(
    config: ProxyConfig,
    admin: Option<admin::AdminState>,
    commands: &mut mpsc::Receiver<admin::AdminCommand>,
) -> Result<(), Box<dyn std::error::Error>> {
    run_proxy_with_admin_and_receipts(config, admin, commands, Arc::default()).await
}

pub async fn run_proxy_with_admin_and_receipts(
    config: ProxyConfig,
    admin: Option<admin::AdminState>,
    commands: &mut mpsc::Receiver<admin::AdminCommand>,
    receipts: Arc<DeliveryReceipts>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ahp_transport: ahp::transport::BoxedTransport = if let Some(ref socket_path) = config.local_ahp_socket {
        #[cfg(unix)]
        {
            info!("Connecting to local AHP Unix socket at {}...", socket_path.display());
            let stream = tokio::net::UnixStream::connect(socket_path).await
                .map_err(|e| format!("Failed to connect to Unix socket '{}': {}", socket_path.display(), e))?;
            let handshake_url = if let Some(ref tkn) = config.local_ahp_token {
                format!("ws://localhost/?tkn={}", tkn)
            } else {
                "ws://localhost/".to_string()
            };
            // VS Code AHP can send very large snapshots (e.g. a chat with many
            // turns and large tool outputs). tokio-tungstenite defaults cap a
            // frame at 16 MiB, and exceeding it tears down the whole AHP
            // connection ("Space limit exceeded: Message too long"), which then
            // makes every later subscribe/sync fail with "client shut down".
            // Raise the limits well above observed snapshot sizes.
            let ws_config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                .max_message_size(Some(256 << 20))
                .max_frame_size(Some(256 << 20));
            let (ws_stream, response) =
                tokio_tungstenite::client_async_with_config(handshake_url, stream, Some(ws_config))
                    .await
                    .map_err(|e| format!("WebSocket handshake over Unix socket failed: {}", e))?;
            info!("WebSocket handshake established over Unix socket (status={})", response.status());
            ahp::transport::BoxedTransport::new(GenericWsTransport::new(ws_stream))
        }
        #[cfg(not(unix))]
        {
            return Err("Unix domain sockets are only supported on Unix-like operating systems (macOS, Linux)".into());
        }
    } else {
        let base_url = config.local_ahp_url.as_deref().unwrap_or("ws://127.0.0.1:4034/ahp/v1");
        let mut url = base_url.to_string();
        if let Some(ref tkn) = config.local_ahp_token {
            if !url.contains("tkn=") {
                let sep = if url.contains('?') { "&" } else { "?" };
                url = format!("{}{}tkn={}", url, sep, tkn);
            }
        }
        info!("Connecting to local AHP server at {}...", url);
        let ws_transport = ahp_ws::WebSocketTransport::connect(&url).await?;
        ahp::transport::BoxedTransport::new(ws_transport)
    };

    let ahp_client = Arc::new(Client::connect(ahp_transport, ClientConfig::default()).await?);
    let mut local_events = ahp_client.events();

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
    let (incoming_tx, mut incoming_rx) = mpsc::unbounded_channel();
    let upstream_reader = tokio::spawn(async move {
        while let Some(message) = up_rx.next().await {
            if incoming_tx.send(message).is_err() {
                break;
            }
        }
    });

    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<Value>();

    // Join bot channel and publish initial capabilities + models
    up_tx.send(WsMessage::Text(json!({
        "topic": "bot:proxy",
        "event": "phx_join",
        "payload": {},
        "ref": "1"
    }).to_string().into())).await?;
    let mut upstream_joined = false;
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

    // Discover and subscribe to all existing active AHP sessions and their chats.
    // Page through the full list (the host caps page size) so active sessions
    // beyond the first page aren't silently missed.
    // Poll discovery alongside the upstream socket so large history imports
    // don't delay joining the bot channel or forwarding live updates.
    let discovery = async {
        let sessions = list_all_sessions(&ahp_client).await;
        if !sessions.is_empty() {
            info!(
                "Discovered {} existing AHP sessions on startup",
                sessions.len()
            );
            publish_session_summaries(&sessions, &outbound_tx);
            for item in sessions.iter().filter(|item| session_needs_live_subscription(item.status)) {
                let client = Arc::clone(&ahp_client);
                let mirror = Arc::clone(&mirror);
                let subscribed = Arc::clone(&subscribed_uris);
                let outbound = outbound_tx.clone();
                let uri = item.resource.clone();
                tokio::spawn(async move {
                    ensure_resource_subscribed(
                        &client, &mirror, &subscribed, &uri, &outbound, true,
                    ).await;
                });
            }
        }
    };
    tokio::pin!(discovery);
    let mut discovery_complete = false;
    let response_timeout = std::time::Duration::from_secs(10);
    let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(10));
    heartbeat.tick().await;
    let response_deadline = tokio::time::sleep(response_timeout);
    tokio::pin!(response_deadline);
    let mut pending_heartbeat: Option<String> = None;
    let mut heartbeat_seq = 0_u64;
    let reconciliation = {
        let client = Arc::clone(&ahp_client);
        let mirror = Arc::clone(&mirror);
        let subscribed = Arc::clone(&subscribed_uris);
        let outbound = outbound_tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            interval.tick().await;
            loop {
                interval.tick().await;
                let sessions = list_all_sessions(&client).await;
                publish_session_summaries(&sessions, &outbound);
                for item in sessions.iter().filter(|item| session_needs_live_subscription(item.status)) {
                    let client = Arc::clone(&client);
                    let mirror = Arc::clone(&mirror);
                    let subscribed = Arc::clone(&subscribed);
                    let outbound = outbound.clone();
                    let uri = item.resource.clone();
                    tokio::spawn(async move {
                        ensure_resource_subscribed(
                            &client, &mirror, &subscribed, &uri, &outbound, true,
                        ).await;
                    });
                }
            }
        })
    };
    let mut pending_archives = std::collections::HashMap::<
        String,
        tokio::sync::oneshot::Sender<Result<Value, String>>,
    >::new();
    let mut hidden_subagents = HashSet::new();
    let mut pending_subagent_syncs = std::collections::HashMap::<String, Vec<String>>::new();

    let disconnect_reason = loop {
        tokio::select! {
            _ = &mut response_deadline, if !upstream_joined || pending_heartbeat.is_some() => {
                break if upstream_joined {
                    "AIMS heartbeat response timed out; reconnecting.".to_string()
                } else {
                    "AIMS channel join response timed out; reconnecting.".to_string()
                };
            }
            event = local_events.recv() => {
                if event.is_none() {
                    break "Local AHP host disconnected; reconnecting.".to_string();
                }
            }
            () = &mut discovery, if !discovery_complete => {
                discovery_complete = true;
                if let Some(admin) = &admin {
                    admin.data.write().await.syncing = false;
                }
                info!("Initial AHP session synchronization queued");
            }
            Some(command) = commands.recv() => {
                if command.archive {
                    if let Some(admin) = &admin {
                        if !admin.eligible(&command.ids).await {
                            let _ = command.reply.send(Err("Session is no longer completed.".into()));
                            continue;
                        }
                    }
                    let request_id = format!("admin:{}", uuid::Uuid::new_v4());
                    let _ = outbound_tx.send(json!({
                        "topic": "bot:proxy",
                        "event": "archive_sessions",
                        "ref": request_id,
                        "payload": { "session_ids": command.ids },
                    }));
                    pending_archives.insert(request_id, command.reply);
                } else {
                    let client = Arc::clone(&ahp_client);
                    let mirror = Arc::clone(&mirror);
                    let subscribed = Arc::clone(&subscribed_uris);
                    let outbound = outbound_tx.clone();
                    let config = config.clone();
                    let admin_clone = admin.clone();
                    let receipts = receipts.clone();
                    tokio::spawn(async move {
                        for id in &command.ids {
                            handle_upstream_command(
                                &client, &mirror, &subscribed, &outbound, &config,
                                "request_session_sync", &json!({ "external_session_id": id }),
                                admin_clone.as_ref(), &receipts,
                            ).await;
                        }
                        let _ = command.reply.send(Ok(json!({ "message": "Session refresh queued for AIMS." })));
                    });
                }
            }
            _ = heartbeat.tick(), if upstream_joined && pending_heartbeat.is_none() => {
                pending_archives.retain(|_, reply| !reply.is_closed());
                heartbeat_seq += 1;
                let heartbeat_ref = format!("heartbeat:{heartbeat_seq}");
                let text = json!({
                    "topic": "phoenix",
                    "event": "heartbeat",
                    "payload": {},
                    "ref": heartbeat_ref,
                }).to_string();
                if let Err(error) = up_tx.send(WsMessage::Text(text.into())).await {
                    break format!("Upstream heartbeat failed: {error}");
                }
                pending_heartbeat = Some(heartbeat_ref);
                response_deadline.as_mut().reset(tokio::time::Instant::now() + response_timeout);
            }
            Some(frame_val) = outbound_rx.recv(), if upstream_joined => {
                if let Some(admin) = &admin {
                    admin.observe(&frame_val).await;
                }
                let Some(mut frame_val) = visibility::for_aims(frame_val, &mut hidden_subagents) else {
                    continue;
                };
                if matches!(frame_val["event"].as_str(), Some("sync_sessions" | "reconcile_sessions")) {
                    let ids: Vec<String> = frame_val["payload"]["sessions"].as_array().into_iter()
                        .flatten().filter(|entry| visibility::subagent_entry(entry))
                        .filter_map(|entry| entry["session_id"].as_str().map(str::to_string)).collect();
                    if !ids.is_empty() {
                        let request_id = format!("subagent-hide:{}", uuid::Uuid::new_v4());
                        frame_val["ref"] = json!(request_id);
                        pending_subagent_syncs.insert(request_id, ids);
                    }
                }
                let text = serde_json::to_string(&frame_val)?;
                if let Err(error) = up_tx.send(WsMessage::Text(text.into())).await {
                    break format!("Upstream send failed: {error}");
                }
            }
            ws_msg = incoming_rx.recv() => {
                let ws_msg = match ws_msg {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => break format!("Upstream receive failed: {error}"),
                    None => break "Upstream connection ended".to_string(),
                };
                let WsMessage::Text(text) = ws_msg else {
                    if matches!(ws_msg, WsMessage::Close(_)) {
                        break "Upstream connection closed".to_string();
                    }
                    continue;
                };

                let val = match serde_json::from_str::<Value>(&text) {
                    Ok(val) => val,
                    Err(error) => {
                        let snippet: String = text.chars().take(500).collect();
                        warn!("[AUDIT:INGRESS][ERROR] Failed to parse inbound AIMS frame: {error}");
                        if let Some(admin) = &admin {
                            admin.log_audit(
                                "ingress_parse_error",
                                "app_to_proxy",
                                "error",
                                None,
                                None,
                                format!("Failed to parse inbound AIMS frame: {error}"),
                                Some(json!({ "error": error.to_string(), "raw": snippet })),
                            ).await;
                        }
                        continue;
                    }
                };
                let event = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let payload = val.get("payload").cloned().unwrap_or_else(|| json!({}));

                // Record every inbound command frame at the ingress boundary so a
                // dropped or unrouted message is never invisible. phx_reply frames are
                // replies to our own sends (handled below) and are pure noise.
                if event != "phx_reply" {
                    if let Some(admin) = &admin {
                        let conv_id = payload.get("conversation_id").and_then(Value::as_i64);
                        let session_id = payload
                            .get("external_session_id")
                            .or_else(|| payload.get("session_id"))
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        admin.log_audit(
                            "inbound_frame",
                            "app_to_proxy",
                            "info",
                            conv_id,
                            session_id,
                            format!("Received '{event}' frame from AIMS"),
                            Some(json!({
                                "event": event,
                                "ref": val.get("ref"),
                                "topic": val.get("topic"),
                            })),
                        ).await;
                    }
                }

                if event == "phx_reply" {
                    if pending_heartbeat.as_deref().is_some_and(|expected| {
                        val["ref"].as_str() == Some(expected) && val["topic"] == "phoenix"
                    }) {
                        if payload["status"] != "ok" {
                            break "AIMS rejected heartbeat; reconnecting.".to_string();
                        }
                        pending_heartbeat = None;
                        continue;
                    }
                    if let Some(ids) = val.get("ref").and_then(Value::as_str)
                        .and_then(|id| pending_subagent_syncs.remove(id)) {
                        if payload["status"] == "ok" && payload["response"]["count"].is_number() {
                            info!("AIMS acknowledged hiding {} subagent resources", ids.len());
                            if let Some(admin) = &admin {
                                let mut data = admin.data.write().await;
                                for id in ids {
                                    if let Some(session) = data.sessions.get_mut(&id) {
                                        session.hidden_in_aims = true;
                                    }
                                }
                            }
                        } else {
                            warn!("AIMS did not acknowledge the subagent visibility update");
                        }
                        continue;
                    }
                    if let Some(reply) = val.get("ref").and_then(Value::as_str)
                        .and_then(|id| pending_archives.remove(id)) {
                        let response = &payload["response"];
                        if payload["status"] == "ok" && response["archived_session_ids"].is_array() {
                            if let Some(admin) = &admin {
                                let mut data = admin.data.write().await;
                                for id in response["archived_session_ids"].as_array().unwrap() {
                                    if let Some(session) = id.as_str().and_then(|id| data.sessions.get_mut(id)) {
                                        session.status = "archived".into();
                                        session.completed = false;
                                    }
                                }
                            }
                            let _ = reply.send(Ok(response.clone()));
                        } else {
                            let _ = reply.send(Err(response["error"].as_str()
                                .unwrap_or("AIMS did not acknowledge archiving. Deploy the updated aims-server before using this action.")
                                .to_string()));
                        }
                        continue;
                    }
                }
                if event == "phx_reply" && val.get("ref").and_then(Value::as_str) == Some("1") {
                    if payload.get("status").and_then(Value::as_str) != Some("ok") {
                        break "AIMS rejected the bot channel join".to_string();
                    }
                    upstream_joined = true;
                    if let Some(admin) = &admin {
                        let mut data = admin.data.write().await;
                        data.connected = true;
                        data.archive_supported = payload["response"]["archive_sessions_supported"] == true;
                        if let Some(sessions) = payload["response"]["archived_sessions"].as_array() {
                            for session in sessions {
                                if let Some(id) = session["external_session_id"].as_str() {
                                    let canonical_id = extract_session_id_from_uri(id).unwrap_or_else(|| id.to_string());
                                    data.sessions.insert(canonical_id.clone(), admin::AdminSession {
                                        id: canonical_id.clone(),
                                        title: session["title"].as_str().unwrap_or(id).to_string(),
                                        status: "archived".into(),
                                        completed: false,
                                        is_subagent: visibility::subagent_uri(&canonical_id),
                                        hidden_in_aims: visibility::subagent_uri(&canonical_id),
                                    });
                                }
                            }
                        }
                        data.syncing = !discovery_complete;
                        data.error = None;
                    }
                    info!("Joined AIMS bot channel");
                }

                let client = Arc::clone(&ahp_client);
                let mirror = Arc::clone(&mirror);
                let subscribed = Arc::clone(&subscribed_uris);
                let outbound = outbound_tx.clone();
                let config = config.clone();
                let event = event.to_string();
                let admin_clone = admin.clone();
                let receipts = receipts.clone();
                tokio::spawn(async move {
                    handle_upstream_command(
                        &client, &mirror, &subscribed, &outbound, &config, &event, &payload, admin_clone.as_ref(), &receipts,
                    ).await;
                });
            }
        }
    };

    reconciliation.abort();
    upstream_reader.abort();
    if let Some(admin) = &admin {
        admin.disconnected_with_reason(&disconnect_reason).await;
    }
    ahp_client.shutdown().await;
    Err(disconnect_reason.into())
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
                    if envelope.channel.starts_with("ahp-session:") {
                        let entries = mirror.lock().await.sessions().iter()
                            .find(|(key, _)| key.uri == envelope.channel)
                            .map(|(_, session)| session_chat_entries(&envelope.channel, session));
                        if let Some(entries) = entries {
                            let _ = outbound_tx.send(json!({
                                "topic": "bot:proxy",
                                "event": "sync_sessions",
                                "payload": { "sessions": entries },
                            }));
                        }
                    }

                    // If a new chat was added to a session, subscribe to the chat channel
                    if let StateAction::SessionChatAdded(ref chat_added) = envelope.action {
                        // Enrich the new chat conversation with its parent session's
                        // project/branch details (apply_envelope above already added
                        // the chat to the session's catalog in the mirror).
                        let enriched = {
                            let m = mirror.lock().await;
                            m.sessions()
                                .values()
                                .find(|s| {
                                    s.chats
                                        .iter()
                                        .any(|c| c.resource == chat_added.summary.resource)
                                })
                                .map(|s| {
                                    let mut entry = chat_summary_to_sync_entry(&chat_added.summary, s);
                                    set_chat_identity(&mut entry, &envelope.channel, s.default_chat.as_deref() == Some(chat_added.summary.resource.as_str()));
                                    entry
                                })
                        };
                        if let Some(entry) = enriched {
                            let _ = outbound_tx.send(json!({
                                "topic": "bot:proxy",
                                "event": "sync_sessions",
                                "payload": { "sessions": [entry] },
                            }));
                        }
                        ensure_resource_subscribed(
                            &ahp_client,
                            &mirror,
                            &subscribed_uris,
                            &chat_added.summary.resource,
                            &outbound_tx,
                            true,
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
                    publish_live_session_summary(&notif.summary, &outbound_tx);
                    if session_needs_live_subscription(notif.summary.status) {
                        ensure_resource_subscribed(
                            &ahp_client,
                            &mirror,
                            &subscribed_uris,
                            &notif.summary.resource,
                            &outbound_tx,
                            true,
                        )
                        .await;
                    }
                }
                SubscriptionEvent::SessionSummaryChanged(notif) => {
                    // Summary notifications are partial and may concern sessions
                    // we never subscribed to. Resolve their authoritative catalog
                    // entry without importing history or guessing missing fields.
                    let sessions = list_all_sessions(&ahp_client).await;
                    if let Some(summary) = sessions.iter().find(|s| s.resource == notif.session) {
                        publish_live_session_summary(summary, &outbound_tx);
                        if session_needs_live_subscription(summary.status) {
                            ensure_resource_subscribed(
                                &ahp_client,
                                &mirror,
                                &subscribed_uris,
                                &summary.resource,
                                &outbound_tx,
                                true,
                            )
                            .await;
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

/// Preserve compound chat URIs; their first segment is a kind, not an identity.
fn extract_session_id_from_uri(uri: &str) -> Option<String> {
    if let Some(rest) = uri.strip_prefix("ahp-session:/") {
        let id = rest.trim_matches('/');
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    if let Some(rest) = uri.strip_prefix("ahp-chat:/") {
        let id = rest.trim_matches('/');
        if !id.is_empty() {
            return Some(if id.contains('/') { uri.to_string() } else { id.to_string() });
        }
    }
    None
}

/// Archived flag of an AHP `SessionStatus` bitset (mirrors
/// `ahp_types::state::SessionStatus::IsArchived`).
const SESSION_STATUS_ARCHIVED: u32 = 64;

/// Whether an AHP session is archived. Archived sessions are historical and are
/// intentionally not surfaced in aims, so we skip subscribing/syncing them.
fn session_status_is_archived(status: u32) -> bool {
    status & SESSION_STATUS_ARCHIVED == SESSION_STATUS_ARCHIVED
}

fn session_needs_live_subscription(status: u32) -> bool {
    matches!(ahp_session_status_to_ui(status), "running" | "waiting_for_input")
}

fn publish_session_summaries(
    sessions: &[SessionSummary],
    outbound: &mpsc::UnboundedSender<Value>,
) {
    publish_session_catalog(sessions, outbound, "reconcile_sessions");
}

fn publish_live_session_summary(
    session: &SessionSummary,
    outbound: &mpsc::UnboundedSender<Value>,
) {
    publish_session_catalog(std::slice::from_ref(session), outbound, "sync_sessions");
}

fn publish_session_catalog(
    sessions: &[SessionSummary],
    outbound: &mpsc::UnboundedSender<Value>,
    event: &str,
) {
    let entries: Vec<Value> = sessions.iter().flat_map(|session| {
        let mut entries = Vec::new();
        if session.chats.as_ref().is_none_or(|chats| chats.is_empty()) && session.default_chat.is_none() {
            entries.push(session_summary_to_sync_entry(session));
        }
        for chat in session.chats.iter().flatten() {
            let mut entry = build_sync_entry(
                &chat.resource,
                if chat.title.trim().is_empty() { &session.title } else { &chat.title },
                chat.status.unwrap_or(session.status),
                session.project.as_ref(),
                session.working_directories.as_ref(),
                session.meta.as_ref(),
                None,
            );
            set_chat_identity(&mut entry, &session.resource, session.default_chat.as_deref() == Some(chat.resource.as_str()));
            entries.push(entry);
        }
        if let Some(default) = &session.default_chat {
            if !session.chats.iter().flatten().any(|chat| &chat.resource == default) {
                let mut entry = session_summary_to_sync_entry(session);
                entry["session_id"] = json!(extract_session_id_from_uri(default).unwrap_or_else(|| default.clone()));
                set_chat_identity(&mut entry, &session.resource, true);
                entries.push(entry);
            }
        }
        if session_status_is_archived(session.status) {
            for entry in &mut entries {
                entry["status"] = json!("archived");
            }
        }
        entries
    }).collect();
    for batch in entries.chunks(50) {
        let _ = outbound.send(json!({
            "topic": "bot:proxy",
            "event": event,
            "payload": { "sessions": batch },
        }));
    }
}

/// Map an AHP `SessionStatus` bitset to the UI status string used by `aims-server`.
/// Flag values mirror `ahp_types::state::SessionStatus`.
fn ahp_session_status_to_ui(status: u32) -> &'static str {
    const ERROR: u32 = 2;
    const IN_PROGRESS: u32 = 8;
    const INPUT_NEEDED: u32 = 24;
    const IS_ARCHIVED: u32 = SESSION_STATUS_ARCHIVED;
    if status & IS_ARCHIVED == IS_ARCHIVED {
        "archived"
    } else if status & INPUT_NEEDED == INPUT_NEEDED {
        "waiting_for_input"
    } else if status & IN_PROGRESS == IN_PROGRESS {
        "running"
    } else if status & ERROR == ERROR {
        "error"
    } else {
        "idle"
    }
}

/// Normalize a `file://` URI into a plain local filesystem path, percent-decoding
/// escapes (e.g. `%20` -> space) so project/working-directory paths display
/// correctly. Plain (non-`file://`) paths are returned unchanged.
fn local_path(raw: &str) -> String {
    let trimmed = raw.trim();
    match trimmed.strip_prefix("file://") {
        Some(rest) => percent_encoding::percent_decode_str(rest)
            .decode_utf8_lossy()
            .into_owned(),
        None => trimmed.to_string(),
    }
}

/// Git details resolved from a session's merged config/metadata values.
#[derive(Default)]
struct GitInfo {
    /// Current working branch.
    branch: Option<String>,
    /// Base branch the work targets (e.g. the PR base).
    base_branch: Option<String>,
    /// `owner/repo` when a GitHub remote is known.
    repository: Option<String>,
}

/// Resolve git branch/repository details from merged session config/metadata.
///
/// VS Code hosts expose rich data under `_meta.git` (`branchName`,
/// `baseBranchName`, `githubOwner`/`githubRepo`), while web-UI-created sessions
/// store `base_branch`/`branch` directly in the session config values. Both
/// shapes are tolerated.
fn git_info_from_metadata(values: &serde_json::Map<String, Value>) -> GitInfo {
    fn str_at(m: &serde_json::Map<String, Value>, k: &str) -> Option<String> {
        m.get(k)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    }

    let mut info = GitInfo {
        branch: str_at(values, "branch").or_else(|| str_at(values, "git_branch")),
        base_branch: str_at(values, "base_branch").or_else(|| str_at(values, "baseBranch")),
        repository: str_at(values, "repository").or_else(|| str_at(values, "repo")),
    };

    if let Some(git) = values.get("git").and_then(|v| v.as_object()) {
        if info.branch.is_none() {
            info.branch = str_at(git, "branchName")
                .or_else(|| str_at(git, "currentBranch"))
                .or_else(|| str_at(git, "branch"));
        }
        if info.base_branch.is_none() {
            info.base_branch =
                str_at(git, "baseBranchName").or_else(|| str_at(git, "defaultBranchName"));
        }
        if info.repository.is_none() {
            if let (Some(owner), Some(repo)) = (str_at(git, "githubOwner"), str_at(git, "githubRepo"))
            {
                info.repository = Some(format!("{owner}/{repo}"));
            }
        }
    }

    info
}

/// Build a `sync_sessions` entry from an AHP session snapshot, carrying the
/// details (title, status, project, branch, working directories) that
/// `aims-server` needs to create or enrich the corresponding conversation.
fn session_state_to_sync_entry(uri: &str, state: &SessionState) -> Value {
    build_sync_entry(
        uri,
        &state.title,
        state.status,
        state.project.as_ref(),
        state.working_directories.as_ref(),
        state.meta.as_ref(),
        state.config.as_ref().map(|c| &c.values),
    )
}

/// Build a `sync_sessions` entry from a lightweight `listSessions` summary.
/// Used to archive existing conversations without subscribing to or importing
/// an archived session's chat history.
fn session_summary_to_sync_entry(summary: &SessionSummary) -> Value {
    build_sync_entry(
        &summary.resource,
        &summary.title,
        summary.status,
        summary.project.as_ref(),
        summary.working_directories.as_ref(),
        summary.meta.as_ref(),
        None,
    )
}

/// Shared builder for a `sync_sessions` entry from the fields common to an AHP
/// `SessionState` snapshot and a `SessionSummary` list item.
fn build_sync_entry(
    uri: &str,
    title: &str,
    status: u32,
    project_info: Option<&ProjectInfo>,
    working_directories: Option<&Vec<String>>,
    meta: Option<&serde_json::Map<String, Value>>,
    config_values: Option<&serde_json::Map<String, Value>>,
) -> Value {
    let session_id = extract_session_id_from_uri(uri).unwrap_or_else(|| uri.to_string());

    // Merge provider `_meta` and current config values so the server can pick up
    // base_branch / model / agent_mode / etc.
    let mut metadata = serde_json::Map::new();
    if let Some(meta) = meta {
        for (k, v) in meta {
            metadata.insert(k.clone(), v.clone());
        }
    }
    if let Some(values) = config_values {
        for (k, v) in values {
            metadata.insert(k.clone(), v.clone());
        }
        if visibility::subagent_uri(uri) {
            metadata.insert("is_subagent".to_string(), json!(true));
            metadata.insert("hidden_from_session_list".to_string(), json!(true));
        }
    }

    let git = git_info_from_metadata(&metadata);
    // Current branch surfaces to the UI via metadata.branch / project.branch;
    // base branch (PR target) via base_branch.
    if let Some(ref b) = git.branch {
        metadata.insert("branch".to_string(), json!(b));
    }
    let effective_base = git.base_branch.clone().or_else(|| git.branch.clone());
    if let Some(ref b) = effective_base {
        metadata.insert("base_branch".to_string(), json!(b));
    }
    if let Some(ref repo) = git.repository {
        metadata.insert("repository".to_string(), json!(repo));
    }

    let mut entry = serde_json::Map::new();
    entry.insert("session_id".to_string(), json!(session_id));
    entry.insert("session_uri".to_string(), json!(uri));
    entry.insert("title".to_string(), json!(title));
    entry.insert(
        "status".to_string(),
        json!(ahp_session_status_to_ui(status)),
    );
    if let Some(ref b) = effective_base {
        entry.insert("base_branch".to_string(), json!(b));
    }

    if let Some(wds) = working_directories {
        entry.insert("working_directories".to_string(), json!(wds));
        if let Some(first) = wds.first() {
            entry.insert("working_directory".to_string(), json!(local_path(first)));
        }
    }

    let mut project = serde_json::Map::new();
    if let Some(p) = project_info {
        project.insert("name".to_string(), json!(p.display_name));
        project.insert("uri".to_string(), json!(p.uri));
        project.insert("path".to_string(), json!(local_path(&p.uri)));
    }
    if !project.contains_key("path") {
        if let Some(first) = working_directories.and_then(|w| w.first()) {
            let path = local_path(first);
            if !project.contains_key("name") {
                if let Some(name) = path.rsplit('/').find(|s| !s.is_empty()) {
                    project.insert("name".to_string(), json!(name));
                }
            }
            project.insert("path".to_string(), json!(path));
        }
    }
    if let Some(ref b) = git.branch {
        project.insert("branch".to_string(), json!(b));
    }
    if let Some(ref repo) = git.repository {
        project.insert("repository".to_string(), json!(repo));
    }
    if !project.is_empty() {
        entry.insert("project".to_string(), Value::Object(project));
    }

    entry.insert("metadata".to_string(), Value::Object(metadata));
    Value::Object(entry)
}

/// Build an enriched `sync_sessions` entry for an individual chat/thread.
///
/// A single AHP session contains many chats, and aims surfaces each chat as its
/// own conversation. The project, working directories, and git metadata only
/// live on the parent `SessionState`, so we key the entry by the chat's own URI,
/// title, and status while borrowing the session's details. Without this a chat
/// conversation shows up as a bare "Session <id>" with no project or branch.
fn chat_summary_to_sync_entry(chat: &ChatSummary, session: &SessionState) -> Value {
    let title = if chat.title.trim().is_empty() {
        session.title.as_str()
    } else {
        chat.title.as_str()
    };
    let working_dirs = chat
        .working_directories
        .as_ref()
        .filter(|w| !w.is_empty())
        .or(session.working_directories.as_ref());
    build_sync_entry(
        &chat.resource,
        title,
        chat.status,
        session.project.as_ref(),
        working_dirs,
        session.meta.as_ref(),
        session.config.as_ref().map(|c| &c.values),
    )
}

/// A session is a container, not an additional conversation. Only the explicit
/// default chat owns its session alias; catalog order and titles are unrelated.
fn set_chat_identity(entry: &mut Value, session_uri: &str, is_default: bool) {
    entry["metadata"]["parent_session_uri"] = json!(session_uri);
    entry["metadata"]["session_uri"] = if is_default { json!(session_uri) } else { Value::Null };
}

fn session_chat_entries(uri: &str, session: &SessionState) -> Vec<Value> {
    if session.chats.is_empty() && session.default_chat.is_none() {
        return vec![session_state_to_sync_entry(uri, session)];
    }
    let mut entries: Vec<Value> = session.chats.iter().map(|chat| {
        let mut entry = chat_summary_to_sync_entry(chat, session);
        set_chat_identity(&mut entry, uri, session.default_chat.as_deref() == Some(chat.resource.as_str()));
        if session_status_is_archived(session.status) {
            entry["status"] = json!("archived");
        }
        entry
    }).collect();
    if let Some(default) = &session.default_chat {
        if !session.chats.iter().any(|chat| &chat.resource == default) {
            let mut entry = session_state_to_sync_entry(uri, session);
            entry["session_id"] = json!(extract_session_id_from_uri(default).unwrap_or_else(|| default.clone()));
            set_chat_identity(&mut entry, uri, true);
            entries.push(entry);
        }
    }
    entries
}

/// Build a `sync_sessions` entry from a chat snapshot alone. Used when the
/// parent session can't be resolved (e.g. an orphaned running chat that is not
/// present in `listSessions`); project details are then derived from the chat's
/// own working directories where available.
fn chat_state_to_sync_entry(uri: &str, chat: &ChatState) -> Value {
    let mut entry = build_sync_entry(
        uri,
        &chat.title,
        chat.status,
        None,
        chat.working_directories.as_ref(),
        chat.meta.as_ref(),
        None,
    );
    entry["metadata"]["last_turn_complete"] = json!(
        chat.active_turn.is_none()
            && matches!(chat.turns.last().map(|turn| &turn.state),
                Some(ahp_types::state::TurnState::Complete))
    );
    if let Some(ahp_types::state::ChatOrigin::Tool { chat: parent, .. }) = &chat.origin {
        entry["metadata"]["is_subagent"] = json!(true);
        entry["metadata"]["hidden_from_session_list"] = json!(true);
        entry["metadata"]["parent_chat_uri"] = json!(parent);
    }
    entry
}

/// Convert a chat's turns into aims message payloads (user prompts plus bot
/// responses and any tool calls). Shared by the live subscription path and the
/// forced manual resync so both emit identical history.
fn build_chat_messages(chat_state: &ChatState) -> Vec<Value> {
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
    messages
}

/// Page through every session summary the host knows about, following the
/// pagination cursor. Hosts cap page sizes (and this user has 500+ sessions), so
/// a single `listSessions` call would silently drop active sessions beyond the
/// first page. A safety bound prevents an unbounded loop on a misbehaving host.
async fn list_all_sessions(ahp_client: &Arc<Client>) -> Vec<SessionSummary> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..50 {
        let params = ListSessionsParams {
            channel: ahp_types::ROOT_RESOURCE_URI.to_string(),
            meta: None,
            limit: Some(200),
            cursor: cursor.clone(),
        };
        match ahp_client
            .request::<_, ListSessionsResult>("listSessions", params)
            .await
        {
            Ok(res) => {
                all.extend(res.items);
                match res.next_cursor {
                    Some(c) if !c.is_empty() => cursor = Some(c),
                    _ => break,
                }
            }
            Err(e) => {
                warn!("listSessions page failed: {}", e);
                break;
            }
        }
    }
    all
}

/// Whether a session summary (its own URI, default chat, or any of its chats)
/// corresponds to `needle` — a bare UUID or URI from a conversation's stored
/// external session id.
fn session_summary_matches(summary: &SessionSummary, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    if resource_matches(&summary.resource, needle) {
        return true;
    }
    if summary
        .default_chat
        .as_deref()
        .is_some_and(|d| resource_matches(d, needle))
    {
        return true;
    }
    summary
        .chats
        .as_ref()
        .is_some_and(|cs| cs.iter().any(|c| resource_matches(&c.resource, needle)))
}

fn resource_matches(uri: &str, id: &str) -> bool {
    uri == id || extract_session_id_from_uri(uri).as_deref() == Some(id)
}

fn session_dispatch(dispatch: &DispatchActionParams) -> bool {
    serde_json::to_value(&dispatch.action).ok()
        .and_then(|action| action["type"].as_str().map(|kind| kind.starts_with("session/")))
        .unwrap_or(false)
}

fn mirrored_dispatch_channel(
    mirror: &MultiHostStateMirror,
    dispatch: &DispatchActionParams,
    target: &str,
) -> Option<String> {
    let clean_target = target
        .strip_prefix("ahp-chat:/")
        .or_else(|| target.strip_prefix("ahp-session:/"))
        .unwrap_or(target);
    let clean_target = clean_target.strip_suffix("/main").unwrap_or(clean_target);
    let fallback = target.strip_prefix("ahp-chat:/").and_then(|id| id.strip_suffix("/main"));
    let matches = |uri: &str| {
        resource_matches(uri, target)
            || resource_matches(uri, clean_target)
            || fallback.is_some_and(|id| resource_matches(uri, id))
    };
    if !session_dispatch(dispatch) {
        if let Some(key) = mirror.chats().keys().find(|key| matches(&key.uri)) {
            return Some(key.uri.clone());
        }
    }
    for (key, session) in mirror.sessions() {
        let chat = session.chats.iter().find(|chat| matches(&chat.resource));
        if matches(&key.uri) || chat.is_some()
            || session.default_chat.as_deref().is_some_and(matches)
        {
            return if session_dispatch(dispatch) {
                Some(key.uri.clone())
            } else {
                chat.map(|chat| chat.resource.clone())
                    .or_else(|| session.default_chat.clone())
                    .or_else(|| session.chats.first().map(|c| c.resource.clone()))
            };
        }
    }
    None
}

fn route_dispatch(
    dispatch: &mut DispatchActionParams,
    target: &str,
    sessions: &[SessionSummary],
) {
    let clean_target = target
        .strip_prefix("ahp-chat:/")
        .or_else(|| target.strip_prefix("ahp-session:/"))
        .unwrap_or(target);
    let clean_target = clean_target.strip_suffix("/main").unwrap_or(clean_target);
    let fallback = target.strip_prefix("ahp-chat:/").and_then(|id| id.strip_suffix("/main"));
    let Some(session) = sessions.iter().find(|session| {
        session_summary_matches(session, target)
            || session_summary_matches(session, clean_target)
            || fallback.is_some_and(|id| session_summary_matches(session, id))
    })
    else {
        if let Some(clean) = dispatch.channel.strip_suffix("/main") {
            dispatch.channel = clean.to_string();
        }
        return;
    };
    if session_dispatch(dispatch) {
        dispatch.channel = session.resource.clone();
    } else if let Some(chat) = session.chats.iter().flatten()
        .find(|chat| resource_matches(&chat.resource, target) || resource_matches(&chat.resource, clean_target) || fallback.is_some_and(|id| resource_matches(&chat.resource, id)))
    {
        dispatch.channel = chat.resource.clone();
    } else if let Some(chat) = session.default_chat.as_ref() {
        dispatch.channel = chat.clone();
    } else if let Some(chat) = session.chats.as_ref().and_then(|cs| cs.first()) {
        dispatch.channel = chat.resource.clone();
    } else if let Some(clean) = dispatch.channel.strip_suffix("/main") {
        dispatch.channel = clean.to_string();
    }
}

/// Re-fetch a chat's current snapshot and re-emit its history upstream, without
/// touching `subscribed_uris` or spawning a listener. Used by the manual sync so
/// messages reload even when the chat is already subscribed (the live path
/// dedups and would otherwise emit nothing).
async fn resync_chat_messages(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    uri: &str,
    conversation_id: Option<i64>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
) {
    match ahp_client.subscribe(uri.to_string()).await {
        Ok((res, _handle)) => {
            if let Some(ref snap) = res.snapshot {
                let host_id = HostId::new("local");
                mirror.lock().await.apply_snapshot(&host_id, snap);
                if let SnapshotState::Chat(ref chat_state) = snap.state {
                    let _ = outbound_tx.send(json!({
                        "topic": "bot:proxy",
                        "event": "sync_sessions",
                        "payload": { "sessions": [chat_state_to_sync_entry(uri, chat_state)] },
                    }));
                    let messages = build_chat_messages(chat_state);
                    if !messages.is_empty() {
                        info!("Resync sending {} messages for chat {}", messages.len(), uri);
                        let mut msg_payload = json!({
                            "chat_uri": uri,
                            "external_session_id": uri,
                            "messages": messages,
                        });
                        if let Some(cid) = conversation_id {
                            msg_payload["conversation_id"] = json!(cid);
                        }
                        let _ = outbound_tx.send(json!({
                            "topic": "bot:proxy",
                            "event": "sync_messages",
                            "payload": msg_payload,
                        }));
                    }
                }
            }
        }
        Err(e) => warn!("Resync of chat {} failed: {}", uri, e),
    }
}

/// Force a full resync of a session: re-emit enriched entries for its chats
/// (without publishing the parent container as a second conversation),
/// then reload chat history for the chat(s) matching `target` (or all chats when
/// `target` is `None` or matches only the session itself). Bypasses the live
/// subscription dedup so the manual sync button actually reloads content.
async fn force_resync_session(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    session_uri: &str,
    target: Option<&str>,
    conversation_id: Option<i64>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
) {
    let snap = match ahp_client.subscribe(session_uri.to_string()).await {
        Ok((res, _handle)) => res.snapshot,
        Err(e) => {
            warn!("Force resync of session {} failed: {}", session_uri, e);
            return;
        }
    };
    let Some(snap) = snap else { return };
    let host_id = HostId::new("local");
    mirror.lock().await.apply_snapshot(&host_id, &snap);
    let SnapshotState::Session(ref session_state) = snap.state else {
        return;
    };

    let entries = session_chat_entries(session_uri, session_state);
    let _ = outbound_tx.send(json!({
        "topic": "bot:proxy",
        "event": "sync_sessions",
        "payload": { "sessions": entries },
    }));

    if session_status_is_archived(session_state.status) {
        return;
    }

    let matching: Vec<&str> = match target.filter(|t| !t.is_empty()) {
        Some(t) => session_state
            .chats
            .iter()
            .filter(|c| resource_matches(&c.resource, t))
            .map(|c| c.resource.as_str())
            .collect(),
        None => Vec::new(),
    };
    // When the target is the session itself (no specific chat matched), reload
    // every chat so a session-level sync still pulls all history.
    if matching.is_empty() {
        for chat in &session_state.chats {
            resync_chat_messages(ahp_client, mirror, &chat.resource, conversation_id, outbound_tx).await;
        }
    } else {
        for chat_uri in matching {
            resync_chat_messages(ahp_client, mirror, chat_uri, conversation_id, outbound_tx).await;
        }
    }
}

/// Force a resync of a bare resource URI that could not be mapped to a parent
/// session (an orphaned chat). Emits a best-effort entry from the chat snapshot
/// and reloads its history.
async fn force_resync_orphan(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    uri: &str,
    conversation_id: Option<i64>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
) {
    match ahp_client.subscribe(uri.to_string()).await {
        Ok((res, _handle)) => {
            if let Some(ref snap) = res.snapshot {
                let host_id = HostId::new("local");
                mirror.lock().await.apply_snapshot(&host_id, snap);
                match &snap.state {
                    SnapshotState::Chat(chat_state) => {
                        let _ = outbound_tx.send(json!({
                            "topic": "bot:proxy",
                            "event": "sync_sessions",
                            "payload": { "sessions": [chat_state_to_sync_entry(uri, chat_state)] },
                        }));
                        let messages = build_chat_messages(chat_state);
                        if !messages.is_empty() {
                            info!("Resync sending {} messages for chat {}", messages.len(), uri);
                            let mut msg_payload = json!({
                                "chat_uri": uri,
                                "external_session_id": uri,
                                "messages": messages,
                            });
                            if let Some(cid) = conversation_id {
                                msg_payload["conversation_id"] = json!(cid);
                            }
                            let _ = outbound_tx.send(json!({
                                "topic": "bot:proxy",
                                "event": "sync_messages",
                                "payload": msg_payload,
                            }));
                        }
                    }
                    SnapshotState::Session(_) => {
                        force_resync_session(ahp_client, mirror, uri, None, conversation_id, outbound_tx).await;
                    }
                    _ => {}
                }
            }
        }
        Err(e) => warn!("Force resync of {} failed: {}", uri, e),
    }
}

/// Subscribe to an AHP resource (session or chat), forward its snapshot upstream,
/// and keep a live listener for updates.
///
/// Returns an explicitly boxed `Send` future: the function recurses (a session
/// cascades into its chats) and is also spawned from the transient-retry path,
/// and the compiler can't prove `Send` for a self-recursive `async fn` on its
/// own.
fn ensure_resource_subscribed<'a>(
    ahp_client: &'a Arc<Client>,
    mirror: &'a Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: &'a Arc<Mutex<HashSet<String>>>,
    uri: &'a str,
    outbound_tx: &'a mpsc::UnboundedSender<Value>,
    allow_retry_spawn: bool,
) -> BoxFuture<'a, ()> {
    Box::pin(async move {
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
                    // Archived sessions are historical; don't import their chats.
                    // Still forward a lightweight entry so aims-server marks any
                    // existing conversation archived (dropping it from the active
                    // list) rather than leaving a stale active row.
                    if session_status_is_archived(session_state.status) {
                        let _ = outbound_tx.send(json!({
                            "topic": "bot:proxy",
                            "event": "sync_sessions",
                            "payload": {
                                "sessions": session_chat_entries(uri, session_state),
                            }
                        }));
                        return;
                    }
                    // Enrich each chat with the container's project details,
                    // without creating an additional parent conversation.
                    let entries = session_chat_entries(uri, session_state);
                    let _ = outbound_tx.send(json!({
                        "topic": "bot:proxy",
                        "event": "sync_sessions",
                        "payload": { "sessions": entries },
                    }));
                    for (index, chat) in session_state.chats.iter().enumerate() {
                        if index != 0 && session_state.default_chat.as_deref() != Some(chat.resource.as_str()) && !session_needs_live_subscription(chat.status) {
                            continue;
                        }
                        ensure_resource_subscribed(
                            ahp_client,
                            mirror,
                            subscribed_uris,
                            &chat.resource,
                            outbound_tx,
                            true,
                        )
                        .await;
                    }
                } else if let SnapshotState::Chat(ref chat_state) = snap.state {
                    let _ = outbound_tx.send(json!({
                        "topic": "bot:proxy",
                        "event": "sync_sessions",
                        "payload": { "sessions": [chat_state_to_sync_entry(uri, chat_state)] },
                    }));
                    let messages = build_chat_messages(chat_state);
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
            // Leaving a failed URI in the set would wedge it permanently: every
            // later retry (startup races, the UI sync button, SessionAdded)
            // short-circuits on the "already subscribed" guard. Remove it so it
            // can be retried.
            subscribed_uris.lock().await.remove(uri);

            // "Provider … is not ready … it may still be starting" is a transient
            // startup race for running sessions. Schedule a few delayed retries so
            // their details self-heal without the user manually syncing.
            let msg = e.to_string();
            if allow_retry_spawn && (msg.contains("not ready") || msg.contains("still be starting"))
            {
                let ahp_client = Arc::clone(ahp_client);
                let mirror = Arc::clone(mirror);
                let subscribed_uris = Arc::clone(subscribed_uris);
                let outbound_tx = outbound_tx.clone();
                let uri = uri.to_string();
                tokio::spawn(async move {
                    for delay_secs in [2u64, 5, 10, 20] {
                        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
                        if subscribed_uris.lock().await.contains(&uri) {
                            return; // another path already subscribed it
                        }
                        // Pass allow_retry_spawn=false: this loop IS the retry, so
                        // nested spawns would compound into a storm of tasks.
                        ensure_resource_subscribed(
                            &ahp_client,
                            &mirror,
                            &subscribed_uris,
                            &uri,
                            &outbound_tx,
                            false,
                        )
                        .await;
                        if subscribed_uris.lock().await.contains(&uri) {
                            info!("Retry subscribed to previously not-ready session {}", uri);
                            return; // success: ensure_resource_subscribed kept it in the set
                        }
                    }
                    warn!("Gave up subscribing to not-ready session {} after retries", uri);
                });
            }
        }
    }
    })
}

async fn subscribe_created_resource(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: &Arc<Mutex<HashSet<String>>>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
    uri: &str,
) -> Result<SnapshotState, String> {
    // A SessionAdded listener may already be subscribing. Fetch a confirmed
    // snapshot rather than treating its in-flight dedup marker as readiness.
    let (result, _subscription) = ahp_client
        .subscribe(uri.to_string())
        .await
        .map_err(|error| format!("Could not subscribe to the new host resource {uri}: {error}"))?;
    let snapshot = result
        .snapshot
        .ok_or_else(|| format!("The local host returned no snapshot for {uri}"))?;
    mirror
        .lock()
        .await
        .apply_snapshot(&HostId::new("local"), &snapshot);
    if subscribed_uris.lock().await.insert(uri.to_string()) {
        spawn_resource_listener(
            Arc::clone(ahp_client),
            Arc::clone(mirror),
            Arc::clone(subscribed_uris),
            uri.to_string(),
            outbound_tx.clone(),
        );
    }
    Ok(snapshot.state)
}

async fn create_host_session(
    ahp_client: &Arc<Client>,
    mirror: &Arc<Mutex<MultiHostStateMirror>>,
    subscribed_uris: &Arc<Mutex<HashSet<String>>>,
    outbound_tx: &mpsc::UnboundedSender<Value>,
    config: &ProxyConfig,
    payload: &Value,
    admin: Option<&admin::AdminState>,
) -> Result<String, String> {
    let mut params: CreateSessionParams =
        serde_json::from_value(payload["ahp_create_session"].clone())
            .map_err(|error| format!("Invalid session creation request: {error}"))?;
    if params.provider.is_none() {
        let role = payload["metadata"]["agent_type"].as_str();
        params.provider = mirror
            .lock()
            .await
            .root_states()
            .values()
            .flat_map(|root| &root.agents)
            .find(|agent| Some(agent.provider.as_str()) == role)
            .map(|agent| agent.provider.clone());
    }
    if params.working_directories.is_none() {
        params.working_directories = config
            .default_working_directory
            .as_ref()
            .map(|directory| vec![directory.clone()]);
    }
    if let Some(directories) = &mut params.working_directories {
        for directory in directories {
            if !directory.starts_with("file:") {
                *directory = url::Url::from_directory_path(&*directory)
                    .map_err(|_| {
                        format!(
                            "Working directory must be an absolute path or file URI: {directory}"
                        )
                    })?
                    .to_string();
            }
        }
    }
    let session_uri = params.channel.clone();
    let conv_id = payload.get("conversation_id").and_then(|v| v.as_i64());
    let project_name = payload["metadata"]["project"]["name"].as_str().or_else(|| payload["metadata"]["project"].as_str()).unwrap_or("unnamed");
    let branch = payload["metadata"]["git_branch"].as_str().or_else(|| payload["metadata"]["base_branch"].as_str()).unwrap_or("default");
    let role = payload["metadata"]["agent_type"].as_str().unwrap_or("default");

    info!(
        "[AUDIT:CREATE_SESSION] Calling local host createSession: channel='{}', project='{}', branch='{}', role='{}', conv_id={:?}",
        session_uri, project_name, branch, role, conv_id
    );
    if let Some(adm) = admin {
        adm.log_audit(
            "create_session",
            "proxy_to_host",
            "info",
            conv_id,
            Some(session_uri.clone()),
            format!("Calling local host createSession: project='{project_name}', branch='{branch}', role='{role}'"),
            Some(json!({ "channel": session_uri, "working_directories": params.working_directories })),
        ).await;
    }

    if let Err(error) = ahp_client.request::<_, Value>("createSession", params).await {
        let err_msg = format!("The local host rejected session creation: {error}");
        error!("[AUDIT:CREATE_SESSION][ERROR] {}", err_msg);
        if let Some(adm) = admin {
            adm.log_audit(
                "create_session",
                "proxy_to_host",
                "error",
                conv_id,
                Some(session_uri.clone()),
                format!("Host rejected session creation: {error}"),
                Some(json!({ "error": error.to_string(), "channel": session_uri })),
            ).await;
        }
        return Err(err_msg);
    }
    let session = subscribe_created_resource(
        ahp_client,
        mirror,
        subscribed_uris,
        outbound_tx,
        &session_uri,
    )
    .await?;
    let SnapshotState::Session(session) = session else {
        return Err("The host did not return a session snapshot for the new session.".to_string());
    };
    let default_chat = session
        .default_chat
        .as_deref()
        .or_else(|| session.chats.first().map(|c| c.resource.as_str()))
        .unwrap_or(&session_uri);
    info!("[AUDIT:CREATE_SESSION][SUCCESS] Host session '{}' created. Default chat assigned: '{}'", session_uri, default_chat);
    if let Some(adm) = admin {
        adm.log_audit(
            "create_session",
            "proxy_to_host",
            "success",
            conv_id,
            Some(default_chat.to_string()),
            format!("Session created on local host. Assigned default chat: '{default_chat}'"),
            Some(json!({ "session_uri": session_uri, "default_chat": default_chat })),
        ).await;
    }
    outbound_tx
        .send(json!({
            "topic": "bot:proxy", "event": "sync_sessions",
            "payload": {"sessions": session_chat_entries(&session_uri, &session)},
        }))
        .map_err(|error| format!("Could not publish the new host session: {error}"))?;
    let chat = subscribe_created_resource(
        ahp_client,
        mirror,
        subscribed_uris,
        outbound_tx,
        default_chat,
    )
    .await?;
    let SnapshotState::Chat(chat) = chat else {
        return Err("The host did not return a chat snapshot for the default chat.".to_string());
    };
    outbound_tx
        .send(json!({
            "topic": "bot:proxy", "event": "sync_sessions",
            "payload": {"sessions": [chat_state_to_sync_entry(default_chat, &chat)]},
        }))
        .map_err(|error| format!("Could not publish the new host chat: {error}"))?;
    Ok(default_chat.to_string())
}

fn report_message_delivery_error(
    outbound: &mpsc::UnboundedSender<Value>,
    message_id: Option<i64>,
    conversation_id: Option<i64>,
    error: &str,
) {
    if let Some(conversation_id) = conversation_id {
        if let Err(send_error) = outbound.send(json!({
            "topic": "bot:proxy",
            "event": "session_status",
            "payload": {
                "conversation_id": conversation_id,
                "status": "error",
                "metadata": { "delivery_error": error, "failed_message_id": message_id },
            },
        })) {
            error!("Failed to report delivery error for message {message_id:?}: {send_error}");
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
    admin: Option<&admin::AdminState>,
    receipts: &DeliveryReceipts,
) {
    let mut payload = payload.clone();
    let dispatch_key = if event == "ahp_dispatch" { None } else { Some("ahp_dispatch") };
    let dispatch_value = dispatch_key.map_or(&payload, |key| &payload[key]);
    if let Ok(mut dispatch) = serde_json::from_value::<DispatchActionParams>(dispatch_value.clone()) {
        let target = payload.get("default_chat_uri")
            .or_else(|| payload.get("metadata").and_then(|m| m.get("default_chat_uri")))
            .or_else(|| payload.get("metadata").and_then(|m| m.get("chat_uri")))
            .or_else(|| payload.get("external_session_id"))
            .or_else(|| payload.get("session_id"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| dispatch.channel.clone());
        let channel = mirrored_dispatch_channel(&*mirror.lock().await, &dispatch, &target);
        if let Some(channel) = channel {
            dispatch.channel = channel;
        } else {
            let sessions = list_all_sessions(ahp_client).await;
            route_dispatch(&mut dispatch, &target, &sessions);
        }
        if let Some(clean) = dispatch.channel.strip_suffix("/main") {
            dispatch.channel = clean.to_string();
        }
        if let Some(key) = dispatch_key {
            payload[key] = serde_json::to_value(dispatch).unwrap();
        } else {
            payload = serde_json::to_value(dispatch).unwrap();
        }
    }
    let payload = &payload;
    match event {
        "create_session" => {
            let conv_id = payload.get("conversation_id").and_then(|v| v.as_i64());
            let ext_id_req = payload.get("external_session_id").or_else(|| payload.get("session_id")).and_then(|v| v.as_str()).map(str::to_string);
            let proj = payload["metadata"]["project"]["name"].as_str().or_else(|| payload["metadata"]["project"].as_str()).unwrap_or("unknown");
            let branch = payload["metadata"]["git_branch"].as_str().or_else(|| payload["metadata"]["base_branch"].as_str()).unwrap_or("default");

            info!("[AUDIT:CREATE_SESSION] Received create_session from app: conv_id={:?}, project='{}', branch='{}'", conv_id, proj, branch);
            if let Some(adm) = admin {
                adm.log_audit(
                    "create_session",
                    "app_to_proxy",
                    "info",
                    conv_id,
                    ext_id_req.clone(),
                    format!("Received create_session request for project '{proj}' (branch: '{branch}')"),
                    Some(payload.clone()),
                ).await;
            }

            let result = create_host_session(
                ahp_client, mirror, subscribed_uris, outbound_tx, config, payload, admin,
            ).await;
            let (status, external_session_id, metadata) = match result {
                Ok(default_chat) => {
                    let ext_id = payload["external_session_id"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| default_chat.clone());
                    ("idle", Some(ext_id), json!({
                        "creation_status": "ready",
                        "creation_error": null,
                        "default_chat_uri": default_chat,
                    }))
                }
                Err(error) => {
                    error!("Host session creation failed: {error}");
                    ("error", payload["external_session_id"].as_str().map(str::to_string), json!({
                        "creation_status": "failed", "creation_error": error,
                    }))
                }
            };
            let status_payload = json!({
                "conversation_id": payload.get("conversation_id"),
                "external_session_id": external_session_id,
                "status": status, "metadata": metadata,
            });
            info!("[AUDIT:SESSION_STATUS] Sending session_status='{}' to AIMS (conv_id={:?}, ext_id={:?})", status, conv_id, external_session_id);
            if let Some(adm) = admin {
                adm.log_audit(
                    "session_status",
                    "proxy_to_app",
                    if status == "error" { "error" } else { "info" },
                    conv_id,
                    external_session_id.clone(),
                    format!("Reporting session status '{status}' to AIMS"),
                    Some(status_payload.clone()),
                ).await;
            }
            if let Err(error) = outbound_tx.send(json!({
                "topic": "bot:proxy",
                "event": "session_status",
                "payload": status_payload,
            })) {
                error!("Failed to report session creation result: {error}");
            }
        }
        "user_message" => {
            let mid = payload.get("id").and_then(|v| v.as_i64());
            let cid = payload.get("conversation_id").and_then(|v| v.as_i64());
            let (Some(message_id), Some(conversation_id)) = (mid, cid) else {
                error!("Refusing user message without numeric message and conversation IDs");
                report_message_delivery_error(outbound_tx, mid, cid, "Message is missing its delivery identity");
                return;
            };
            let receipt = receipts.dispatched.lock().await
                .entry((conversation_id, message_id)).or_default().clone();
            let mut dispatched = receipt.lock().await;
            if *dispatched {
                if let Err(error) = outbound_tx.send(json!({
                    "topic": "bot:proxy", "event": "acknowledge",
                    "payload": { "message_id": message_id, "conversation_id": conversation_id },
                })) {
                    error!("Failed to re-acknowledge previously dispatched message {message_id}: {error}");
                }
                info!("Suppressed replay of already dispatched message {message_id}");
                return;
            }
            let ext_id = payload.get("external_session_id").or_else(|| payload.get("session_id")).and_then(|v| v.as_str()).map(str::to_string);
            let body_preview = payload.get("body").and_then(|v| v.as_str()).map(|s| {
                if s.chars().count() > 80 { format!("{}...", s.chars().take(80).collect::<String>()) } else { s.to_string() }
            }).unwrap_or_else(|| "(empty body)".to_string());

            info!("[AUDIT:USER_MESSAGE] Received user prompt #{:?} (conv={:?}, ext_id={:?}): '{}'", mid, cid, ext_id, body_preview);
            if let Some(adm) = admin {
                adm.log_audit(
                    "user_message",
                    "app_to_proxy",
                    "info",
                    cid,
                    ext_id.clone(),
                    format!("Received user message #{:?}: '{}'", mid.unwrap_or(0), body_preview),
                    Some(payload.clone()),
                ).await;
            }

            if let Some(disp_val) = payload.get("ahp_dispatch") {
                match serde_json::from_value::<DispatchActionParams>(disp_val.clone()) {
                    Ok(mut dispatch_params) => {
                        if let Some(clean) = dispatch_params.channel.strip_suffix("/main") {
                            dispatch_params.channel = clean.to_string();
                        }
                        ensure_resource_subscribed(
                            ahp_client,
                            mirror,
                            subscribed_uris,
                            &dispatch_params.channel,
                            outbound_tx,
                            true,
                        )
                        .await;

                        info!("[AUDIT:USER_MESSAGE] Dispatching turn to local host channel '{}'...", dispatch_params.channel);
                        match ahp_client.dispatch(dispatch_params.channel.clone(), dispatch_params.action).await {
                            Ok(_) => {
                                *dispatched = true;
                                if let (Some(message_id), Some(conversation_id)) = (mid, cid) {
                                    if let Err(error) = outbound_tx.send(json!({
                                        "topic": "bot:proxy",
                                        "event": "acknowledge",
                                        "payload": { "message_id": message_id, "conversation_id": conversation_id },
                                    })) {
                                        error!("Failed to queue acknowledgement for message {message_id}: {error}");
                                    }
                                }
                                info!("[AUDIT:USER_MESSAGE][SUCCESS] Message #{:?} dispatched to local host channel '{}'", mid, dispatch_params.channel);
                                if let Some(adm) = admin {
                                    adm.log_audit(
                                        "user_message",
                                        "proxy_to_host",
                                        "success",
                                        cid,
                                        Some(dispatch_params.channel.clone()),
                                        format!("Message #{:?} dispatched to local host channel '{}'", mid.unwrap_or(0), dispatch_params.channel),
                                        None,
                                    ).await;
                                }
                            }
                            Err(e) => {
                                report_message_delivery_error(outbound_tx, mid, cid, &e.to_string());
                                error!("[AUDIT:USER_MESSAGE][ERROR] Failed to dispatch user turn to local host: {}", e);
                                if let Some(adm) = admin {
                                    adm.log_audit(
                                        "user_message",
                                        "proxy_to_host",
                                        "error",
                                        cid,
                                        Some(dispatch_params.channel.clone()),
                                        format!("Failed to dispatch message #{:?} to local host: {e}", mid.unwrap_or(0)),
                                        Some(json!({ "error": e.to_string(), "channel": dispatch_params.channel })),
                                    ).await;
                                }
                            }
                        }
                    }
                    Err(err) => {
                        report_message_delivery_error(outbound_tx, mid, cid, &format!("Invalid AHP dispatch: {err}"));
                        error!("[AUDIT:USER_MESSAGE][ERROR] Failed to parse ahp_dispatch for message #{:?}: {}", mid, err);
                        if let Some(adm) = admin {
                            adm.log_audit(
                                "user_message",
                                "internal",
                                "error",
                                cid,
                                ext_id.clone(),
                                format!("Failed to parse ahp_dispatch for message #{:?}: {err}", mid.unwrap_or(0)),
                                Some(json!({ "error": err.to_string(), "ahp_dispatch": disp_val })),
                            ).await;
                        }
                    }
                }
            } else {
                report_message_delivery_error(outbound_tx, mid, cid, "Message is missing its AHP dispatch payload");
                warn!("[AUDIT:USER_MESSAGE][WARN] User message #{:?} has no 'ahp_dispatch' field", mid);
                if let Some(adm) = admin {
                    adm.log_audit(
                        "user_message",
                        "internal",
                        "warn",
                        cid,
                        ext_id.clone(),
                        format!("User message #{:?} missing ahp_dispatch field", mid.unwrap_or(0)),
                        Some(payload.clone()),
                    ).await;
                }

            }
        }
        "steer" | "answer_question" | "session_config_changed" => {
            let cid = payload.get("conversation_id").and_then(|v| v.as_i64());
            let ext_id = payload.get("external_session_id").or_else(|| payload.get("session_id")).and_then(|v| v.as_str()).map(str::to_string);
            info!("[AUDIT:{}] Received from app (conv={:?}, ext_id={:?})", event.to_uppercase(), cid, ext_id);
            if let Some(adm) = admin {
                adm.log_audit(
                    event,
                    "app_to_proxy",
                    "info",
                    cid,
                    ext_id.clone(),
                    format!("Received '{event}' command from app"),
                    Some(payload.clone()),
                ).await;
            }
            if let Some(disp_val) = payload.get("ahp_dispatch") {
                if let Ok(dispatch_params) =
                    serde_json::from_value::<DispatchActionParams>(disp_val.clone())
                {
                    match ahp_client
                        .dispatch(dispatch_params.channel.clone(), dispatch_params.action)
                        .await
                    {
                        Ok(_) => {
                            info!("[AUDIT:{}][SUCCESS] Dispatched to local host channel '{}'", event.to_uppercase(), dispatch_params.channel);
                            if let Some(adm) = admin {
                                adm.log_audit(
                                    event,
                                    "proxy_to_host",
                                    "success",
                                    cid,
                                    Some(dispatch_params.channel.clone()),
                                    format!("Dispatched '{event}' action to host channel '{}'", dispatch_params.channel),
                                    None,
                                ).await;
                            }
                        }
                        Err(e) => {
                            warn!("[AUDIT:{}][ERROR] Failed to dispatch to local host: {}", event.to_uppercase(), e);
                            if let Some(adm) = admin {
                                adm.log_audit(
                                    event,
                                    "proxy_to_host",
                                    "error",
                                    cid,
                                    Some(dispatch_params.channel.clone()),
                                    format!("Failed to dispatch '{event}' to host: {e}"),
                                    Some(json!({ "error": e.to_string() })),
                                ).await;
                            }
                        }
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
            let conv_id = payload.get("conversation_id").and_then(|v| v.as_i64());
            let mut ext_id = payload
                .get("external_session_id")
                .or_else(|| payload.get("session_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if ext_id.is_empty() {
                if let Some(meta) = payload.get("metadata") {
                    if let Some(uri) = meta.get("default_chat_uri")
                        .or_else(|| meta.get("chat_uri"))
                        .or_else(|| meta.get("session_uri"))
                        .and_then(|v| v.as_str())
                    {
                        ext_id = uri.to_string();
                    }
                }
            }
            info!(
                "[AUDIT:SYNC] Received request_session_sync for external_session_id={}",
                ext_id
            );
            if let Some(adm) = admin {
                adm.log_audit(
                    "request_session_sync",
                    "app_to_proxy",
                    "info",
                    None,
                    Some(ext_id.to_string()),
                    format!("App requested resync for session '{ext_id}'"),
                    Some(payload.clone()),
                ).await;
            }
            if ext_id.is_empty() {
                return;
            }

            // Resolve the clicked conversation to its parent AHP session so we can
            // re-emit full details (project/branch) and reload chat history. The
            // stored ext_id may be a session URI, a chat URI, or a bare UUID of
            // either. A conversation's history lives in chat resources, so the old
            // "re-list and re-subscribe" approach did nothing useful: the live
            // subscription dedup short-circuits, and the session's child chats were
            // never force-refreshed. force_resync_* bypasses that dedup.
            let needle = extract_session_id_from_uri(&ext_id).unwrap_or_else(|| ext_id.to_string());
            let sessions = list_all_sessions(ahp_client).await;
            if let Some(parent) = sessions.iter().find(|s| session_summary_matches(s, &needle)) {
                for chat in parent.chats.iter().flatten().filter(|chat| {
                    extract_session_id_from_uri(&chat.resource).as_deref() == Some(needle.as_str())
                        || chat.resource == needle
                }) {
                    ensure_resource_subscribed(
                        ahp_client, mirror, subscribed_uris, &chat.resource, outbound_tx, true,
                    ).await;
                }
                ensure_resource_subscribed(
                    ahp_client, mirror, subscribed_uris, &parent.resource, outbound_tx, true,
                ).await;
                force_resync_session(
                    ahp_client,
                    mirror,
                    &parent.resource,
                    Some(needle.as_str()),
                    conv_id,
                    outbound_tx,
                )
                .await;
            } else {
                // Orphan: not present in listSessions (e.g. a detached running
                // thread). Resync the specific resource directly.
                let direct = if ext_id.contains("ahp-chat:") {
                    let start = ext_id.find("ahp-chat:").unwrap_or(0);
                    ext_id[start..].split('&').next().unwrap_or(&ext_id).to_string()
                } else if ext_id.contains("ahp-session:") || ext_id.contains("copilotcli:") {
                    ext_id.to_string()
                } else {
                    // Bare UUID: these have been observed to be chat IDs.
                    format!("ahp-chat:/{needle}")
                };
                force_resync_orphan(ahp_client, mirror, &direct, conv_id, outbound_tx).await;
            }
        }
        other => {
            // phx_reply frames are channel acks consumed in the ingress loop; they
            // intentionally have no command handler here and must not be logged as
            // unhandled (they would flood the audit log).
            if other == "phx_reply" {
                return;
            }
            let cid = payload.get("conversation_id").and_then(|v| v.as_i64());
            let ext_id = payload
                .get("external_session_id")
                .or_else(|| payload.get("session_id"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            warn!("[AUDIT:UNHANDLED] No handler for event '{other}' from AIMS (conv={cid:?}, ext_id={ext_id:?})");
            if let Some(adm) = admin {
                adm.log_audit(
                    "unhandled_event",
                    "internal",
                    "warn",
                    cid,
                    ext_id,
                    format!("Unhandled event '{other}' received from AIMS"),
                    Some(payload.clone()),
                ).await;
            }
        }
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

    fn identity_fixture() -> Value {
        json!({
            "provider": "copilotcli", "title": "Same title", "status": 8,
            "resource": "ahp-session:/parent",
            "createdAt": "2026-11-05T03:00:00Z",
            "modifiedAt": "2026-11-05T04:00:00Z",
            "lifecycle": "ready", "activeClients": [],
            "defaultChat": "ahp-chat:/default-chat",
            "chats": [{
                "resource": "ahp-chat:/default-chat", "title": "Same title",
                "status": 8, "modifiedAt": "2026-11-05T04:00:00Z"
            }]
        })
    }

    fn published_entries(fixture: &Value) -> Vec<Value> {
        let summary = serde_json::from_value(fixture.clone()).unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        publish_session_summaries(&[summary], &tx);
        rx.try_recv().unwrap()["payload"]["sessions"].as_array().unwrap().clone()
    }

    #[test]
    fn parent_and_default_chat_publish_one_conversation_on_every_sync_path() {
        let fixture = identity_fixture();
        let state: SessionState = serde_json::from_value(fixture.clone()).unwrap();
        let entries = session_chat_entries("ahp-session:/parent", &state);
        for entries in [entries, published_entries(&fixture)] {
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0]["session_id"], "default-chat");
            assert_eq!(entries[0]["metadata"]["session_uri"], "ahp-session:/parent");
            assert_eq!(entries[0]["status"], "running");
        }
        let mut archived = fixture.clone();
        archived["status"] = json!(64);
        assert_eq!(published_entries(&archived)[0]["status"], "archived");
        let state = serde_json::from_value(archived).unwrap();
        assert_eq!(session_chat_entries("ahp-session:/parent", &state)[0]["status"], "archived");
    }

    #[test]
    fn distinct_same_title_chats_survive_and_default_is_not_catalog_order() {
        let mut fixture = identity_fixture();
        fixture["chats"].as_array_mut().unwrap().insert(0, json!({
            "resource": "ahp-chat:/other-chat", "title": "Same title",
            "status": 0, "modifiedAt": "2026-11-05T04:00:00Z"
        }));
        let state: SessionState = serde_json::from_value(fixture.clone()).unwrap();
        for entries in [
            session_chat_entries("ahp-session:/parent", &state),
            published_entries(&fixture),
        ] {
            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0]["session_id"], "other-chat");
            assert!(entries[0]["metadata"]["session_uri"].is_null());
            assert_eq!(entries[1]["metadata"]["session_uri"], "ahp-session:/parent");
        }
        fixture["defaultChat"] = json!("ahp-chat:/other-chat");
        let entries = published_entries(&fixture);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["metadata"]["session_uri"], "ahp-session:/parent");
        assert!(entries[1]["metadata"]["session_uri"].is_null());
        fixture["defaultChat"] = Value::Null;
        assert!(published_entries(&fixture).iter()
            .all(|entry| entry["metadata"]["session_uri"].is_null()));
    }

    #[test]
    fn default_chat_without_catalog_still_uses_chat_identity() {
        let mut fixture = identity_fixture();
        fixture["chats"] = json!([]);
        let state = serde_json::from_value(fixture.clone()).unwrap();
        for entries in [
            session_chat_entries("ahp-session:/parent", &state),
            published_entries(&fixture),
        ] {
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0]["session_id"], "default-chat");
        }
        let summary = serde_json::from_value(fixture).unwrap();
        assert!(session_summary_matches(&summary, "default-chat"));
        assert!(!session_summary_matches(&summary, "default"));
        assert!(!session_summary_matches(&summary, "pare"));
    }

    #[test]
    fn commands_route_to_default_or_selected_chat_and_config_to_parent() {
        let mut fixture = identity_fixture();
        fixture["chats"].as_array_mut().unwrap().insert(0, json!({
            "resource": "ahp-chat:/other-chat", "title": "Same title",
            "status": 0, "modifiedAt": "2026-11-05T04:00:00Z"
        }));
        let summary: SessionSummary = serde_json::from_value(fixture.clone()).unwrap();
        let state: SessionState = serde_json::from_value(fixture).unwrap();
        let mut mirror = MultiHostStateMirror::new();
        mirror.apply_snapshot(&HostId::new("local"), &ahp_types::state::Snapshot {
            resource: summary.resource.clone(), state: SnapshotState::Session(Box::new(state)), from_seq: 0,
        });
        for (target, expected) in [
            ("parent", "ahp-chat:/default-chat"),
            ("default-chat", "ahp-chat:/default-chat"),
            ("ahp-chat:/other-chat", "ahp-chat:/other-chat"),
            ("ahp-chat:/other-chat/main", "ahp-chat:/other-chat"),
        ] {
            let mut dispatch: DispatchActionParams = serde_json::from_value(json!({
                "channel": "ahp-chat:/parent/main", "clientSeq": 1,
                "action": {"type": "chat/turnCancelled", "turnId": "turn"}
            })).unwrap();
            assert_eq!(mirrored_dispatch_channel(&mirror, &dispatch, target).as_deref(), Some(expected));
            route_dispatch(&mut dispatch, target, std::slice::from_ref(&summary));
            assert_eq!(dispatch.channel, expected);
            dispatch.action = serde_json::from_value(json!({
                "type": "session/configChanged", "config": {}
            })).unwrap();
            assert_eq!(mirrored_dispatch_channel(&mirror, &dispatch, target).as_deref(), Some("ahp-session:/parent"));
            route_dispatch(&mut dispatch, target, std::slice::from_ref(&summary));
            assert_eq!(dispatch.channel, "ahp-session:/parent");
        }

        // Test fallback to first chat when defaultChat is None
        let mut no_default_fixture = identity_fixture();
        no_default_fixture["defaultChat"] = serde_json::Value::Null;
        let no_default_summary: SessionSummary = serde_json::from_value(no_default_fixture).unwrap();
        let mut dispatch_no_default: DispatchActionParams = serde_json::from_value(json!({
            "channel": "ahp-chat:/parent/main", "clientSeq": 2,
            "action": {"type": "chat/turnStarted", "turnId": "t", "startedAt": "2026-11-05T00:00:00Z", "message": {"text": "hi", "origin": {"kind": "user"}}}
        })).unwrap();
        route_dispatch(&mut dispatch_no_default, "parent", std::slice::from_ref(&no_default_summary));
        assert_eq!(dispatch_no_default.channel, "ahp-chat:/default-chat");
    }

    #[test]
    fn lightweight_sync_includes_idle_status_without_loading_history() {
        let summaries: Vec<SessionSummary> = [0, 8, 24, 64].into_iter().map(|status| {
            serde_json::from_value(json!({
                "provider": "copilotcli",
                "title": "Session",
                "status": status,
                "resource": format!("ahp-session:/session-{status}"),
                "createdAt": "2026-11-05T03:00:00Z",
                "modifiedAt": "2026-11-05T04:00:00Z"
            })).unwrap()
        }).collect();
        let (tx, mut rx) = mpsc::unbounded_channel();
        publish_session_summaries(&summaries, &tx);
        let frame = rx.try_recv().unwrap();
        assert_eq!(frame["event"], "reconcile_sessions");
        let entries = frame["payload"]["sessions"].as_array().unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0]["status"], "idle");
        assert_eq!(entries[3]["status"], "archived");
        assert!(rx.try_recv().is_err());
        let active: Vec<u32> = summaries.iter()
            .filter(|s| session_needs_live_subscription(s.status)).map(|s| s.status).collect();
        assert_eq!(active, [8, 24]);
        assert!(!session_needs_live_subscription(72));
        assert!(!session_needs_live_subscription(2));
    }

    #[tokio::test]
    async fn root_notifications_publish_new_idle_sessions_and_status_changes_immediately() {
        let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ProxyConfig {
            local_ahp_url: Some(format!("ws://{}", local.local_addr().unwrap())),
            local_ahp_socket: None, local_ahp_token: None,
            upstream_ws_url: format!("ws://{}/", upstream.local_addr().unwrap()),
            bot_token: "test-token".into(), default_working_directory: None,
        };
        let host = async move {
            let (stream, _) = local.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut announced = false;
            let mut completed = false;
            let mut fixture = identity_fixture();
            fixture["status"] = json!(0);
            fixture["chats"][0]["status"] = json!(0);
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let request: Value = serde_json::from_str(&text).unwrap();
                let first_list = request["method"] == "listSessions" && !announced;
                let result = match request["method"].as_str() {
                    Some("initialize") => json!({
                        "protocolVersion": ahp_types::PROTOCOL_VERSION, "serverSeq": 0, "snapshots": []
                    }),
                    Some("subscribe") => json!({}),
                    Some("listSessions") if first_list => json!({"items": []}),
                    Some("listSessions") => json!({"items": [fixture]}),
                    _ => continue,
                };
                socket.send(WsMessage::Text(json!({
                    "jsonrpc": "2.0", "id": request["id"], "result": result,
                }).to_string().into())).await.unwrap();
                if first_list {
                    announced = true;
                    socket.send(WsMessage::Text(json!({
                        "jsonrpc": "2.0", "method": "root/sessionAdded",
                        "params": {"channel": ahp_types::ROOT_RESOURCE_URI, "summary": fixture},
                    }).to_string().into())).await.unwrap();
                    fixture["status"] = json!(8);
                    fixture["chats"][0]["status"] = json!(8);
                    socket.send(WsMessage::Text(json!({
                        "jsonrpc": "2.0", "method": "root/sessionSummaryChanged",
                        "params": {
                            "channel": ahp_types::ROOT_RESOURCE_URI,
                            "session": "ahp-session:/parent",
                            "changes": {"status": 8, "chats": fixture["chats"]},
                        },
                    }).to_string().into())).await.unwrap();
                } else if request["method"] == "listSessions" && !completed {
                    completed = true;
                    fixture["status"] = json!(0);
                    fixture["chats"][0]["status"] = json!(0);
                    socket.send(WsMessage::Text(json!({
                        "jsonrpc": "2.0", "method": "root/sessionSummaryChanged",
                        "params": {
                            "channel": ahp_types::ROOT_RESOURCE_URI,
                            "session": "ahp-session:/parent",
                            "changes": {"status": 0, "chats": fixture["chats"]},
                        },
                    }).to_string().into())).await.unwrap();
                }
            }
        };
        let server = async move {
            let (stream, _) = upstream.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            socket.next().await.unwrap().unwrap();
            socket.send(WsMessage::Text(json!({
                "topic": "bot:proxy", "event": "phx_reply", "ref": "1",
                "payload": {"status": "ok", "response": {}}
            }).to_string().into())).await.unwrap();
            let mut statuses = Vec::new();
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let frame: Value = serde_json::from_str(&text).unwrap();
                if frame["event"] == "sync_sessions" {
                    let entry = &frame["payload"]["sessions"][0];
                    assert_eq!(entry["session_id"], "default-chat");
                    statuses.push(entry["status"].as_str().unwrap().to_string());
                    if statuses.len() == 3 {
                        assert_eq!(statuses, ["idle", "running", "idle"]);
                        socket.close(None).await.unwrap();
                        return;
                    }
                }
            }
            panic!("root notification updates never reached AIMS");
        };
        let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(run_proxy(config), host, server)
        }).await.expect("live updates must arrive before periodic reconciliation");
        assert!(outcome.0.is_err());
    }

    #[test]
    fn tool_spawned_chats_are_subagents_but_user_forks_are_not() {
        let mut snapshot = json!({
            "resource": "ahp-chat:/worker",
            "title": "Investigate",
            "status": 8,
            "modifiedAt": "2026-11-05T16:00:00Z",
            "turns": [],
            "origin": { "kind": "tool", "chat": "ahp-chat:/parent", "toolCallId": "call-1" }
        });
        let chat: ChatState = serde_json::from_value(snapshot.clone()).unwrap();
        let entry = chat_state_to_sync_entry(&chat.resource, &chat);
        assert_eq!(entry["metadata"]["is_subagent"], true);
        assert_eq!(entry["metadata"]["parent_chat_uri"], "ahp-chat:/parent");
        snapshot["origin"] = json!({"kind": "fork", "chat": "ahp-chat:/parent", "turnId": "turn-1"});
        let chat: ChatState = serde_json::from_value(snapshot).unwrap();
        assert_ne!(chat_state_to_sync_entry(&chat.resource, &chat)["metadata"]["is_subagent"], true);
    }

    #[test]
    fn compound_chat_resources_keep_their_full_identity() {
        assert_eq!(extract_session_id_from_uri("ahp-chat:/chat-id").as_deref(), Some("chat-id"));
        for uri in ["ahp-chat://default/session-one", "ahp-chat://default/session-two", "ahp-chat://subagent/session-one/worker"] {
            assert_eq!(extract_session_id_from_uri(uri).as_deref(), Some(uri));
        }
    }

    #[tokio::test]
    async fn session_creation_uses_host_default_chat_and_reports_rejections() {
        for (fail_stage, subscription_in_flight) in [
            (None, false),
            (None, true),
            (Some("createSession"), false),
            (Some("subscribe"), false),
        ] {
            let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("ws://{}", local.local_addr().unwrap());
            let (requests_tx, mut requests_rx) = mpsc::unbounded_channel();
            let host = tokio::spawn(async move {
                let (stream, _) = local.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                    let request: Value = serde_json::from_str(&text).unwrap();
                    requests_tx.send(request.clone()).unwrap();
                    let method = request["method"].as_str().unwrap();
                    if Some(method) == fail_stage {
                        socket
                            .send(WsMessage::Text(
                                json!({
                                    "jsonrpc": "2.0", "id": request["id"],
                                    "error": { "code": -32603, "message": "Host unavailable" }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await
                            .unwrap();
                        continue;
                    }
                    let result = match method {
                        "createSession" => {
                            assert_eq!(request["params"]["channel"], "ahp-session:/new-session");
                            assert_eq!(
                                request["params"]["workingDirectories"][0],
                                "file:///workspace/morpheus-ui/"
                            );
                            assert!(request["params"].get("provider").is_none());
                            json!({})
                        }
                        "subscribe" => {
                            let uri = request["params"]["channel"].as_str().unwrap();
                            let state = match uri {
                                "ahp-session:/new-session" => {
                                    let mut fixture = identity_fixture();
                                    fixture["resource"] = json!(uri);
                                    fixture["defaultChat"] = json!("ahp-chat:/host-default");
                                    fixture["chats"] = json!([]);
                                    fixture["status"] = json!(0);
                                    SnapshotState::Session(Box::new(
                                        serde_json::from_value(fixture).unwrap(),
                                    ))
                                }
                                "ahp-chat:/host-default" => SnapshotState::Chat(Box::new(
                                    serde_json::from_value(json!({
                                        "resource": uri, "title": "New session", "status": 0,
                                        "modifiedAt": "2026-11-05T04:00:00Z", "turns": [],
                                    }))
                                    .unwrap(),
                                )),
                                _ => panic!("Unexpected subscription: {uri}"),
                            };
                            json!({"snapshot": ahp_types::state::Snapshot {
                                resource: uri.to_string(), state, from_seq: 0,
                            }})
                        }
                        "dispatchAction" => {
                            assert_eq!(request["params"]["channel"], "ahp-chat:/host-default");
                            continue;
                        }
                        _ => panic!("Unexpected host command: {method}"),
                    };
                    socket
                        .send(WsMessage::Text(
                            json!({
                                "jsonrpc": "2.0", "id": request["id"], "result": result,
                            })
                            .to_string()
                            .into(),
                        ))
                        .await
                        .unwrap();
                }
            });
            let client = Arc::new(
                Client::connect(
                    ahp_ws::WebSocketTransport::connect(&url).await.unwrap(),
                    ClientConfig::default(),
                )
                .await
                .unwrap(),
            );
            let mirror = Arc::new(Mutex::new(MultiHostStateMirror::new()));
            let subscribed = Arc::new(Mutex::new(HashSet::new()));
            if subscription_in_flight {
                subscribed.lock().await.extend([
                    "ahp-session:/new-session".to_string(),
                    "ahp-chat:/host-default".to_string(),
                ]);
            }
            let (tx, mut rx) = mpsc::unbounded_channel();
            let config = ProxyConfig {
                local_ahp_url: Some(url),
                local_ahp_socket: None,
                local_ahp_token: None,
                upstream_ws_url: String::new(),
                bot_token: String::new(),
                default_working_directory: Some("/workspace/morpheus-ui".into()),
            };
            let payload = json!({
                "conversation_id": 1, "external_session_id": "new-session",
                "metadata": {"agent_type": "workspace"},
                "ahp_create_session": {"channel": "ahp-session:/new-session"},
                "ahp_create_chat": {
                    "channel": "ahp-session:/new-session", "chat": "ahp-chat:/new-session/main",
                },
            });
            tokio::time::timeout(
                std::time::Duration::from_secs(2),
                handle_upstream_command(
                    &client,
                    &mirror,
                    &subscribed,
                    &tx,
                    &config,
                    "create_session",
                    &payload,
                    None,
                    &DeliveryReceipts::default(),
                ),
            )
            .await
            .expect("Creation result must not hang");
            let mut frames = Vec::new();
            while let Ok(frame) = rx.try_recv() {
                frames.push(frame);
            }
            let status = frames
                .iter()
                .find(|frame| frame["event"] == "session_status")
                .unwrap();
            assert_eq!(status["payload"]["external_session_id"], "new-session");
            if fail_stage.is_some() {
                assert_eq!(status["payload"]["status"], "error");
                assert_eq!(status["payload"]["metadata"]["creation_status"], "failed");
                assert!(!status["payload"]["metadata"]["creation_error"]
                    .as_str()
                    .unwrap()
                    .is_empty());
                if fail_stage == Some("createSession") {
                    assert!(subscribed.lock().await.is_empty());
                    assert_eq!(frames.len(), 1);
                }
            } else {
                assert_eq!(status["payload"]["metadata"]["creation_status"], "ready");
                assert!(frames
                    .iter()
                    .any(|frame| frame["payload"]["sessions"][0]["session_id"] == "host-default"));
                let receipts = DeliveryReceipts::default();
                handle_upstream_command(
                    &client,
                    &mirror,
                    &subscribed,
                    &tx,
                    &config,
                    "user_message",
                    &json!({
                        "id": 2, "conversation_id": 1, "external_session_id": "new-session",
                        "ahp_dispatch": {
                            "channel": "ahp-chat:/new-session/main", "clientSeq": 1,
                            "action": {
                                "type": "chat/turnStarted", "turnId": "turn-2",
                                "startedAt": "2026-11-05T04:00:00Z",
                                "message": {"text": "Inspect the project", "origin": {"kind": "user"}},
                            },
                        },
                    }),
                    None,
                    &receipts,
                )
                .await;
                assert_eq!(rx.try_recv().unwrap()["event"], "acknowledge");
                loop {
                    let request =
                        tokio::time::timeout(std::time::Duration::from_secs(2), requests_rx.recv())
                            .await
                            .unwrap()
                            .unwrap();
                    if request["method"] == "dispatchAction" {
                        assert_eq!(request["params"]["channel"], "ahp-chat:/host-default");
                        break;
                    }
                }
                client.shutdown().await;
                handle_upstream_command(
                    &client, &mirror, &subscribed, &tx, &config, "user_message",
                    &json!({"id": 2, "conversation_id": 1}),
                    None, &receipts,
                ).await;
                assert_eq!(rx.try_recv().unwrap()["event"], "acknowledge");
                assert!(rx.try_recv().is_err());
            }
            client.shutdown().await;
            tokio::time::timeout(std::time::Duration::from_secs(2), host)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test]
    async fn invalid_or_disconnected_message_dispatch_is_not_acknowledged() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let host = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while socket.next().await.is_some() {}
        });
        let transport = ahp_ws::WebSocketTransport::connect(&format!("ws://{address}")).await.unwrap();
        let client = Arc::new(Client::connect(transport, ClientConfig::default()).await.unwrap());
        client.shutdown().await;
        let mirror = Arc::new(Mutex::new(MultiHostStateMirror::new()));
        let subscribed = Arc::new(Mutex::new(HashSet::new()));
        let config = ProxyConfig {
            local_ahp_url: None, local_ahp_socket: None, local_ahp_token: None,
            upstream_ws_url: "ws://unused".into(), bot_token: "test".into(), default_working_directory: None,
        };
        for dispatch in [None, Some(json!({})), Some(json!({
            "channel": "ahp-chat:/test", "clientSeq": 1,
            "action": {
                "type": "chat/turnStarted", "turnId": "turn-42",
                "startedAt": "2026-11-06T15:00:00Z",
                "message": {"text": "Hello", "origin": {"kind": "user"}},
            },
        }))] {
            let mut payload = json!({"id": 42, "conversation_id": 1});
            if let Some(dispatch) = dispatch {
                payload["ahp_dispatch"] = dispatch;
            }
            let (tx, mut rx) = mpsc::unbounded_channel();
            let receipts = DeliveryReceipts::default();
            handle_upstream_command(&client, &mirror, &subscribed, &tx, &config, "user_message", &payload, None, &receipts).await;
            let receipt = receipts.dispatched.lock().await.get(&(1, 42)).unwrap().clone();
            assert!(!*receipt.lock().await);
            let frames: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
            assert!(!frames.iter().any(|frame| frame["event"] == "acknowledge"));
            assert!(frames.iter().any(|frame| frame["event"] == "session_status"
                && frame["payload"]["metadata"]["failed_message_id"] == 42));
        }
        host.await.unwrap();
    }

    #[tokio::test]
    async fn wire_sync_messages_notifications_commands_and_resync_share_chat_identity() {
        let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ProxyConfig {
            local_ahp_url: Some(format!("ws://{}", local.local_addr().unwrap())),
            local_ahp_socket: None, local_ahp_token: None,
            upstream_ws_url: format!("ws://{}/", upstream.local_addr().unwrap()),
            bot_token: "test-token".into(), default_working_directory: None,
        };
        let fixture = identity_fixture();
        let session: SessionState = serde_json::from_value(fixture.clone()).unwrap();
        let chat: ChatState = serde_json::from_value(json!({
            "resource": "ahp-chat:/default-chat", "title": "Same title", "status": 8,
            "modifiedAt": "2026-11-05T04:00:00Z",
            "turns": [{
                "id": "turn", "state": "complete",
                "message": {"text": "Historical prompt", "origin": {"kind": "user"}},
                "responseParts": [{"kind": "markdown", "id": "reply", "content": "Historical reply"}]
            }]
        })).unwrap();
        let host = async move {
            let (stream, _) = local.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let request: Value = serde_json::from_str(&text).unwrap();
                let result = match request["method"].as_str() {
                    Some("initialize") => json!({
                        "protocolVersion": ahp_types::PROTOCOL_VERSION, "serverSeq": 0, "snapshots": []
                    }),
                    Some("listSessions") => json!({"items": [fixture]}),
                    Some("subscribe") => {
                        let uri = request["params"]["channel"].as_str().unwrap();
                        let state = match uri {
                            "ahp-session:/parent" => Some(SnapshotState::Session(Box::new(session.clone()))),
                            "ahp-chat:/default-chat" => Some(SnapshotState::Chat(Box::new(chat.clone()))),
                            _ => None,
                        };
                        match state {
                            Some(state) => json!({"snapshot": ahp_types::state::Snapshot {
                                resource: uri.to_string(), state, from_seq: 0,
                            }}),
                            None => json!({}),
                        }
                    }
                    Some("dispatchAction") => {
                        assert_eq!(request["params"]["channel"], "ahp-chat:/default-chat");
                        socket.send(WsMessage::Text(json!({
                            "jsonrpc": "2.0", "method": "action", "params": {
                                "channel": "ahp-chat:/default-chat", "serverSeq": 1,
                                "action": request["params"]["action"]
                            }
                        }).to_string().into())).await.unwrap();
                        continue;
                    }
                    _ => continue,
                };
                socket.send(WsMessage::Text(json!({
                    "jsonrpc": "2.0", "id": request["id"], "result": result,
                }).to_string().into())).await.unwrap();
            }
        };
        let server = async move {
            let (stream, _) = upstream.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let join = socket.next().await.unwrap().unwrap();
            let join: Value = serde_json::from_str(join.to_text().unwrap()).unwrap();
            assert_eq!(join["event"], "phx_join");
            socket.send(WsMessage::Text(json!({
                "topic": "bot:proxy", "event": "phx_reply", "ref": "1",
                "payload": {"status": "ok", "response": {}}
            }).to_string().into())).await.unwrap();
            let mut histories = 0;
            let mut notification_received = false;
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let frame: Value = serde_json::from_str(&text).unwrap();
                match frame["event"].as_str() {
                    Some("sync_sessions" | "reconcile_sessions") => {
                        let entries = frame["payload"]["sessions"].as_array().unwrap();
                        assert_eq!(entries.len(), 1);
                        assert_eq!(entries[0]["session_id"], "default-chat");
                    }
                    Some("sync_messages") => {
                        assert_eq!(frame["payload"]["external_session_id"], "ahp-chat:/default-chat");
                        assert_eq!(frame["payload"]["messages"].as_array().unwrap().len(), 2);
                        histories += 1;
                        if histories == 1 {
                            socket.send(WsMessage::Text(json!({
                                "topic": "bot:proxy", "event": "steer", "payload": {
                                    "session_id": "parent", "ahp_dispatch": {
                                        "channel": "ahp-chat:/parent/main", "clientSeq": 1,
                                        "action": {"type": "chat/turnCancelled", "turnId": "turn"}
                                    }
                                }
                            }).to_string().into())).await.unwrap();
                        }
                    }
                    Some("ahp_envelope") => {
                        assert_eq!(frame["payload"]["channel"], "ahp-chat:/default-chat");
                        notification_received = true;
                        socket.send(WsMessage::Text(json!({
                            "topic": "bot:proxy", "event": "request_session_sync",
                            "payload": {"external_session_id": "default-chat"}
                        }).to_string().into())).await.unwrap();
                    }
                    _ => {}
                }
                if histories == 2 && notification_received {
                    socket.close(None).await.unwrap();
                    return;
                }
            }
            panic!("proxy disconnected before completing the identity round trip");
        };
        let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(run_proxy(config), host, server)
        }).await.expect("identity synchronization must complete without blocking");
        assert!(outcome.0.is_err(), "upstream disconnect should end this proxy run");
    }

    #[tokio::test]
    async fn silent_upstream_times_out_even_with_open_transports() {
        for join in [false, true] {
            let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let config = ProxyConfig {
                local_ahp_url: Some(format!("ws://{}", local.local_addr().unwrap())),
                local_ahp_socket: None, local_ahp_token: None,
                upstream_ws_url: format!("ws://{}/", upstream.local_addr().unwrap()),
                bot_token: "test-token".into(), default_working_directory: None,
            };
            let host = async move {
                let (stream, _) = local.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                    let request: Value = serde_json::from_str(&text).unwrap();
                    let result = match request["method"].as_str() {
                        Some("initialize") => json!({
                            "protocolVersion": ahp_types::PROTOCOL_VERSION, "serverSeq": 0, "snapshots": []
                        }),
                        Some("subscribe") => json!({}),
                        Some("listSessions") => json!({"items": []}),
                        _ => continue,
                    };
                    socket.send(WsMessage::Text(json!({
                        "jsonrpc": "2.0", "id": request["id"], "result": result,
                    }).to_string().into())).await.unwrap();
                }
            };
            let server = async move {
                let (stream, _) = upstream.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                socket.next().await.unwrap().unwrap();
                if join {
                    socket.send(WsMessage::Text(json!({
                        "topic": "bot:proxy", "event": "phx_reply", "ref": "1",
                        "payload": {"status": "ok", "response": {}}
                    }).to_string().into())).await.unwrap();
                }
                let mut heartbeats = 0;
                while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                    let request: Value = serde_json::from_str(&text).unwrap();
                    if request["event"] == "heartbeat" {
                        heartbeats += 1;
                        socket.send(WsMessage::Text(json!({
                            "topic": "phoenix", "event": "phx_reply",
                            "ref": if heartbeats == 1 { request["ref"].clone() } else { json!("stale-heartbeat") },
                            "payload": {"status": "ok", "response": {}}
                        }).to_string().into())).await.unwrap();
                    }
                }
                if join {
                    assert_eq!(heartbeats, 2, "valid reply permits another heartbeat, stale reply must not keep connection healthy");
                }
            };
            let (result, (), ()) = tokio::time::timeout(std::time::Duration::from_secs(40), async {
                tokio::join!(run_proxy(config), host, server)
            }).await.expect("unresponsive upstream must not remain connected indefinitely");
            let reason = result.unwrap_err().to_string();
            assert!(reason.contains(if join { "heartbeat response timed out" } else { "join response timed out" }), "{reason}");
        }
    }

    #[tokio::test]
    async fn local_host_disconnect_ends_proxy_even_when_upstream_stays_open() {
        let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ProxyConfig {
            local_ahp_url: Some(format!("ws://{}", local.local_addr().unwrap())),
            local_ahp_socket: None, local_ahp_token: None,
            upstream_ws_url: format!("ws://{}/", upstream.local_addr().unwrap()),
            bot_token: "test-token".into(), default_working_directory: None,
        };
        let (joined_tx, joined_rx) = tokio::sync::oneshot::channel();
        let host = async move {
            let (stream, _) = local.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let request: Value = serde_json::from_str(&text).unwrap();
                let result = match request["method"].as_str() {
                    Some("initialize") => json!({
                        "protocolVersion": ahp_types::PROTOCOL_VERSION, "serverSeq": 0, "snapshots": []
                    }),
                    Some("subscribe") => json!({}),
                    Some("listSessions") => {
                        joined_rx.await.unwrap();
                        socket.close(None).await.unwrap();
                        return;
                    }
                    _ => continue,
                };
                socket.send(WsMessage::Text(json!({
                    "jsonrpc": "2.0", "id": request["id"], "result": result,
                }).to_string().into())).await.unwrap();
            }
        };
        let server = async move {
            let (stream, _) = upstream.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            socket.next().await.unwrap().unwrap();
            socket.send(WsMessage::Text(json!({
                "topic": "bot:proxy", "event": "phx_reply", "ref": "1",
                "payload": {"status": "ok", "response": {}}
            }).to_string().into())).await.unwrap();
            joined_tx.send(()).unwrap();
            while socket.next().await.is_some() {}
        };
        let (result, (), ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(run_proxy(config), host, server)
        }).await.expect("local disconnect must not wait for upstream or reconciliation");
        assert!(result.unwrap_err().to_string().contains("Local AHP host disconnected"));
    }

    #[tokio::test]
    async fn test_upstream_join_and_disconnect_while_discovery_is_pending() {
        let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ProxyConfig {
            local_ahp_url: Some(format!("ws://{}", local.local_addr().unwrap())),
            local_ahp_socket: None,
            local_ahp_token: None,
            upstream_ws_url: format!("ws://{}/", upstream.local_addr().unwrap()),
            bot_token: "test-token".to_string(),
            default_working_directory: None,
        };
        let (discovery_tx, discovery_rx) = tokio::sync::oneshot::channel();
        let host = tokio::spawn(async move {
            let (stream, _) = local.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut discovery_tx = Some(discovery_tx);
            while let Some(Ok(WsMessage::Text(text))) = socket.next().await {
                let request: Value = serde_json::from_str(&text).unwrap();
                let result = match request.get("method").and_then(Value::as_str) {
                    Some("initialize") => json!({
                        "protocolVersion": ahp_types::PROTOCOL_VERSION,
                        "serverSeq": 0,
                        "snapshots": [],
                    }),
                    Some("subscribe") => json!({}),
                    Some("listSessions") => {
                        if let Some(tx) = discovery_tx.take() {
                            let _ = tx.send(());
                        }
                        continue;
                    }
                    _ => continue,
                };
                socket
                    .send(WsMessage::Text(
                        json!({
                            "jsonrpc": "2.0",
                            "id": request["id"],
                            "result": result,
                        })
                        .to_string()
                        .into(),
                    ))
                    .await
                    .unwrap();
            }
        });
        let server = async move {
            let (stream, _) = upstream.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            discovery_rx.await.unwrap();
            let frame = socket.next().await.unwrap().unwrap();
            let join: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
            assert_eq!(join["event"], "phx_join");
            socket.close(None).await.unwrap();
        };

        let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(run_proxy(config), server)
        })
        .await;
        host.abort();
        let (proxy_result, ()) = outcome.expect("discovery must not block upstream I/O");
        assert!(proxy_result.is_err(), "disconnect must trigger reconnection");
    }

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

    #[test]
    fn test_session_state_to_sync_entry_carries_name_project_branch() {
        let uri = "ahp-session:/9c051ba7-dcd6-4e8e-bf96-6fb3f6ea0876";
        let state: SessionState = serde_json::from_value(json!({
            "provider": "copilotcli",
            "title": "overflow-x: auto issue",
            "status": 1,
            "lifecycle": "ready",
            "activeClients": [],
            "chats": [],
            "project": { "uri": "file:///Users/andy/repos/app", "displayName": "app" },
            "workingDirectories": ["file:///Users/andy/repos/app.worktrees/fix"],
            "config": {
                "schema": { "type": "object", "properties": {} },
                "values": { "model": "claude-sonnet-4" }
            },
            "_meta": {
                "git": {
                    "branchName": "agents/fix-overflow",
                    "baseBranchName": "dev-9.2",
                    "defaultBranchName": "dev-9.2",
                    "githubOwner": "HPE-EMU",
                    "githubRepo": "morpheus-ui"
                }
            }
        }))
        .expect("valid session state");

        let entry = session_state_to_sync_entry(uri, &state);

        assert_eq!(entry["session_id"], "9c051ba7-dcd6-4e8e-bf96-6fb3f6ea0876");
        assert_eq!(entry["title"], "overflow-x: auto issue");
        assert_eq!(entry["status"], "idle");
        assert_eq!(entry["project"]["name"], "app");
        assert_eq!(entry["project"]["branch"], "agents/fix-overflow");
        assert_eq!(entry["project"]["repository"], "HPE-EMU/morpheus-ui");
        assert_eq!(entry["base_branch"], "dev-9.2");
        assert_eq!(entry["metadata"]["branch"], "agents/fix-overflow");
        assert_eq!(entry["metadata"]["base_branch"], "dev-9.2");
        assert_eq!(entry["working_directory"], "/Users/andy/repos/app.worktrees/fix");
        assert_eq!(entry["metadata"]["model"], "claude-sonnet-4");
    }

    #[test]
    fn test_ahp_session_status_to_ui_prioritizes_input_needed_over_in_progress() {
        assert_eq!(ahp_session_status_to_ui(1), "idle");
        assert_eq!(ahp_session_status_to_ui(8), "running");
        assert_eq!(ahp_session_status_to_ui(24), "waiting_for_input");
        assert_eq!(ahp_session_status_to_ui(64), "archived");
    }

    #[test]
    fn test_session_status_is_archived_matches_real_statuses() {
        // Observed live statuses: archived entries carry bit 64 (65 = 64|1,
        // 97 = 64|32|1); active entries (1 idle, 33 read+idle, 40 read+running)
        // do not.
        assert!(session_status_is_archived(65));
        assert!(session_status_is_archived(97));
        assert!(session_status_is_archived(64));
        assert!(!session_status_is_archived(1));
        assert!(!session_status_is_archived(33));
        assert!(!session_status_is_archived(40));
    }

    #[test]
    fn test_local_path_decodes_percent_encoding() {
        assert_eq!(
            local_path("file:///Users/andy/repos/My%20Project"),
            "/Users/andy/repos/My Project"
        );
        // Plain paths are returned unchanged (no spurious decoding).
        assert_eq!(local_path("/Users/andy/plain"), "/Users/andy/plain");
    }

    #[test]
    fn test_chat_summary_to_sync_entry_inherits_parent_project_keeps_chat_identity() {
        // A session holds many chats; aims shows each chat as its own
        // conversation. Project/branch live on the session, so a chat entry must
        // borrow them while keyed by the chat's own URI, title, and status.
        let state: SessionState = serde_json::from_value(json!({
            "provider": "copilotcli",
            "title": "Plan Groups React migration",
            "status": 40,
            "lifecycle": "ready",
            "activeClients": [],
            "project": { "uri": "file:///Users/andy/repos/morpheus-ui", "displayName": "morpheus-ui" },
            "workingDirectories": ["file:///Users/andy/repos/morpheus-ui"],
            "_meta": { "git": { "branchName": "main", "githubOwner": "HPE", "githubRepo": "morpheus-ui" } },
            "chats": [{
                "resource": "ahp-chat:/fe31e002-5f0d-490d-90e3-debcb1f9531e",
                "title": "Implement Groups list backend",
                "status": 8,
                "modifiedAt": "2026-11-05T04:00:00.000Z"
            }]
        }))
        .expect("valid session state");

        let entry = chat_summary_to_sync_entry(&state.chats[0], &state);

        // Keyed by the chat, not the session.
        assert_eq!(entry["session_id"], "fe31e002-5f0d-490d-90e3-debcb1f9531e");
        assert_eq!(
            entry["session_uri"],
            "ahp-chat:/fe31e002-5f0d-490d-90e3-debcb1f9531e"
        );
        assert_eq!(entry["title"], "Implement Groups list backend");
        // Chat's own status (running), not the session's.
        assert_eq!(entry["status"], "running");
        // Details inherited from the parent session.
        assert_eq!(entry["project"]["name"], "morpheus-ui");
        assert_eq!(entry["project"]["branch"], "main");
        assert_eq!(entry["project"]["repository"], "HPE/morpheus-ui");
    }

    #[test]
    fn test_session_summary_matches_by_session_chat_and_bare_uuid() {
        let summary: SessionSummary = serde_json::from_value(json!({
            "provider": "copilotcli",
            "title": "Plan Groups React migration",
            "status": 40,
            "resource": "ahp-session:/7bf34ef0-baa0-47a5-82be-c24113ff263d",
            "createdAt": "2026-11-05T03:00:00.000Z",
            "modifiedAt": "2026-11-05T04:00:00.000Z",
            "defaultChat": "ahp-chat:/fe31e002-5f0d-490d-90e3-debcb1f9531e",
            "chats": [{
                "resource": "ahp-chat:/fe31e002-5f0d-490d-90e3-debcb1f9531e",
                "title": "Plan Groups React migration"
            }]
        }))
        .expect("valid session summary");

        // Matches the session's own id, a child chat id, and bare UUIDs of each.
        assert!(session_summary_matches(&summary, "7bf34ef0-baa0-47a5-82be-c24113ff263d"));
        assert!(session_summary_matches(&summary, "fe31e002-5f0d-490d-90e3-debcb1f9531e"));
        assert!(session_summary_matches(
            &summary,
            "ahp-session:/7bf34ef0-baa0-47a5-82be-c24113ff263d"
        ));
        // Unrelated id does not match; empty needle never matches.
        assert!(!session_summary_matches(&summary, "deadbeef-0000-0000-0000-000000000000"));
        assert!(!session_summary_matches(&summary, ""));
    }
}
