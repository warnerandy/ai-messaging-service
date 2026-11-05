//! AHP (Agent Host Protocol) state mirror and wire protocol conversion layer.
//!
//! Leverages `ahp` and `ahp_types` to maintain live `RootState`, `SessionState`, and `ChatState`
//! per connected AHP bot proxy, apply deterministic reducers (`ahp::reducers`), and translate
//! between AHP `ActionEnvelope` / `StateAction` / `CreateSessionParams` / `MessageAttachment`
//! and the mobile-first web UI's session & chat state.

use std::collections::HashMap;

use ahp::hosts::HostId;
use ahp::reducers::{
    apply_action_to_chat, apply_action_to_root, apply_action_to_session, ReduceOutcome,
};
use ahp::MultiHostStateMirror;
use ahp_types::actions::{
    ActionEnvelope, ChatInputCompletedAction, ChatPendingMessageRemovedAction,
    ChatPendingMessageSetAction, ChatTurnCancelledAction, ChatTurnStartedAction,
    SessionConfigChangedAction, SessionWorkingDirectorySetAction, StateAction,
};
use ahp_types::commands::{CreateChatParams, CreateSessionParams, DispatchActionParams};
use ahp_types::common::AnyValue;
use ahp_types::state::{
    AgentSelection, ChatInputAnswer, ChatInputAnswerValue, ChatInputAnswered,
    ChatInputResponseKind, ChatInputTextAnswerValue, ChatState, Message, MessageAttachment,
    MessageEmbeddedResourceAttachment, MessageKind, MessageOrigin, MessageResourceAttachment,
    ModelSelection, PendingMessageKind, ResponsePart, RootState, SessionState, SessionStatus,
    Snapshot, SnapshotState, ToolCallState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

/// Per-bot AHP state mirror tracking `RootState`, `SessionState`s, and `ChatState`s,
/// backed by `ahp::MultiHostStateMirror` and `ahp::reducers`.
pub struct BotAhpMirror {
    pub host_id: HostId,
    pub multi_mirror: MultiHostStateMirror,
    pub root: RootState,
    pub sessions: HashMap<String, SessionState>,
    pub chats: HashMap<String, ChatState>,
    pub next_client_seq: u64,
}

impl BotAhpMirror {
    pub fn new(bot_token_id: i64) -> Self {
        let host_id = HostId::new(format!("bot-{}", bot_token_id));
        let mut multi_mirror = MultiHostStateMirror::new();
        let root = RootState {
            agents: Vec::new(),
            active_sessions: Some(0),
            terminals: None,
            config: None,
            meta: None,
        };
        multi_mirror.apply_snapshot(
            &host_id,
            &Snapshot {
                resource: ahp_types::ROOT_RESOURCE_URI.to_string(),
                state: SnapshotState::Root(Box::new(root.clone())),
                from_seq: 0,
            },
        );

        Self {
            host_id,
            multi_mirror,
            root,
            sessions: HashMap::new(),
            chats: HashMap::new(),
            next_client_seq: 1,
        }
    }

    pub fn next_seq(&mut self) -> u64 {
        let seq = self.next_client_seq;
        self.next_client_seq += 1;
        seq
    }

    /// Apply an incoming AHP `ActionEnvelope` using `ahp::reducers` and `MultiHostStateMirror`.
    pub fn apply_envelope(&mut self, envelope: &ActionEnvelope) -> ReduceOutcome {
        self.multi_mirror.apply_envelope(&self.host_id, envelope);

        if envelope.channel == ahp_types::ROOT_RESOURCE_URI {
            apply_action_to_root(&mut self.root, &envelope.action)
        } else if envelope.channel.starts_with("ahp-session:") {
            if let Some(session_state) = self.sessions.get_mut(&envelope.channel) {
                apply_action_to_session(session_state, &envelope.action)
            } else {
                ReduceOutcome::NoOp
            }
        } else if envelope.channel.starts_with("ahp-chat:") {
            if let Some(chat_state) = self.chats.get_mut(&envelope.channel) {
                apply_action_to_chat(chat_state, &envelope.action)
            } else {
                ReduceOutcome::NoOp
            }
        } else {
            let r = apply_action_to_root(&mut self.root, &envelope.action);
            if r == ReduceOutcome::Applied {
                return r;
            }
            if let Some(session_state) = self.sessions.get_mut(&envelope.channel) {
                let s = apply_action_to_session(session_state, &envelope.action);
                if s == ReduceOutcome::Applied {
                    return s;
                }
            }
            if let Some(chat_state) = self.chats.get_mut(&envelope.channel) {
                return apply_action_to_chat(chat_state, &envelope.action);
            }
            ReduceOutcome::NoOp
        }
    }

    /// Extract capabilities metadata (providers/agents, models, modes, worktree support) from `RootState`.
    pub fn capabilities_metadata(&self) -> Value {
        let mut agent_roles = Vec::new();
        let mut models = Vec::new();

        for agent in &self.root.agents {
            agent_roles.push(json!({
                "id": agent.provider,
                "name": agent.display_name,
                "description": agent.description,
            }));
            for m in &agent.models {
                models.push(json!({
                    "id": m.id,
                    "name": m.name,
                    "provider": m.provider,
                    "max_context_window": m.max_context_window,
                    "max_input_tokens": m.max_prompt_tokens.or(m.max_context_window),
                    "max_output_tokens": m.max_output_tokens,
                    "supports_vision": m.supports_vision.unwrap_or(true),
                    "supports_reasoning": true,
                    "supports_tool_calls": true,
                }));
            }
        }

        json!({
            "protocol": "ahp",
            "protocol_version": ahp_types::PROTOCOL_VERSION,
            "agent_roles": agent_roles,
            "models": models,
            "modes": [
                { "id": "interactive", "name": "Interactive", "description": "Standard interactive agent collaboration" },
                { "id": "plan", "name": "Plan", "description": "Architect & plan before executing edits" },
                { "id": "autopilot", "name": "Autopilot", "description": "Autonomous end-to-end execution" }
            ],
            "worktree_supported": true,
        })
    }
}

/// Convert an AHP `SessionStatus` bitset into the UI status string.
pub fn session_status_to_ui_status(status: SessionStatus) -> &'static str {
    if status.contains(SessionStatus::IsArchived) {
        "archived"
    } else if status.contains(SessionStatus::InputNeeded) {
        "waiting_for_input"
    } else if status.contains(SessionStatus::InProgress) {
        "running"
    } else if status.contains(SessionStatus::Error) {
        "error"
    } else {
        "idle"
    }
}

/// Build an AHP `CreateSessionParams` struct from the Web UI's new-session metadata.
///
/// Supports all VS Code Agents Window session creation options:
/// - `working_directory` / workspace folder -> `working_directories`
/// - `provider` selects the host agent; `agent_type` remains agent configuration
/// - `model` / `agent_mode` / `use_worktree` / `base_branch` in `config` & `meta`
pub fn build_ahp_create_session_params(
    external_session_id: &str,
    metadata: &Value,
) -> CreateSessionParams {
    let session_uri = if external_session_id.starts_with("ahp-session:") {
        external_session_id.to_string()
    } else {
        format!("ahp-session:/{}", external_session_id)
    };

    let working_directories = metadata
        .get("working_directory")
        .or_else(|| metadata.get("workingDirectory"))
        .or_else(|| metadata.get("cwd"))
        .or_else(|| metadata.get("project").and_then(|p| p.get("path")))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()])
        .or_else(|| {
            metadata
                .get("working_directories")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .filter(|v| !v.is_empty())
        });

    let provider = metadata
        .get("provider")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut config_map = Map::new();
    let mut meta_map = Map::new();
    for key in [
        "agent_mode",
        "agent_type",
        "model",
        "use_worktree",
        "base_branch",
        "skill",
        "parent_session_id",
        "context_size",
        "working_directory",
    ] {
        if let Some(val) = metadata.get(key) {
            if !val.is_null() {
                config_map.insert(key.to_string(), AnyValue::from(val.clone()));
                meta_map.insert(key.to_string(), AnyValue::from(val.clone()));
            }
        }
    }

    CreateSessionParams {
        channel: session_uri,
        meta: if meta_map.is_empty() {
            None
        } else {
            Some(meta_map)
        },
        provider,
        working_directories,
        config: if config_map.is_empty() {
            None
        } else {
            Some(config_map)
        },
        active_client: None,
        progress_token: None,
    }
}

/// Build an AHP `CreateChatParams` struct for a session.
pub fn build_ahp_create_chat_params(
    external_session_id: &str,
    title: Option<&str>,
    metadata: &Value,
) -> CreateChatParams {
    let session_uri = if external_session_id.starts_with("ahp-session:") {
        external_session_id.to_string()
    } else {
        format!("ahp-session:/{}", external_session_id)
    };
    let chat_uri = format!(
        "ahp-chat:/{}/main",
        external_session_id.trim_start_matches("ahp-session:/")
    );

    let working_directories = metadata
        .get("working_directory")
        .or_else(|| metadata.get("workingDirectory"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()]);

    let mut meta_map = Map::new();
    if let Some(t) = title {
        meta_map.insert("title".to_string(), AnyValue::from(json!(t)));
    }

    CreateChatParams {
        channel: session_uri,
        meta: if meta_map.is_empty() {
            None
        } else {
            Some(meta_map)
        },
        chat: chat_uri,
        initial_message: None,
        source: None,
        working_directories,
    }
}

/// Build an AHP `Message` (with `MessageAttachment`s for pasted mobile images or uploaded files)
/// and wrap it in a `ChatTurnStarted` or `ChatPendingMessageSet` `DispatchActionParams`.
pub fn build_ahp_user_turn_dispatch(
    external_session_id: &str,
    turn_id: &str,
    body: &str,
    model: Option<&str>,
    metadata: &Value,
    client_seq: u64,
) -> DispatchActionParams {
    let chat_uri = chat_dispatch_uri(external_session_id);

    let attachments = extract_ahp_attachments(metadata);
    let is_steer = metadata
        .get("is_steer")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut msg_meta = Map::new();
    for key in [
        "agent_mode",
        "agent_type",
        "use_worktree",
        "base_branch",
        "skill",
        "is_steer",
        "working_directory",
    ] {
        if let Some(v) = metadata.get(key) {
            if !v.is_null() {
                msg_meta.insert(key.to_string(), AnyValue::from(v.clone()));
            }
        }
    }

    let model_selection = model
        .or_else(|| metadata.get("model").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(|m| ModelSelection {
            id: m.to_string(),
            config: None,
        });

    let agent_selection = metadata
        .get("agent_type")
        .or_else(|| metadata.get("agentType"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|id| AgentSelection {
            uri: if id.contains(':') {
                id.to_string()
            } else {
                format!("ahp-agent:/{}", id)
            },
        });

    let ahp_message = Message {
        text: body.to_string(),
        origin: MessageOrigin {
            kind: MessageKind::User,
        },
        attachments: if attachments.is_empty() {
            None
        } else {
            Some(attachments)
        },
        model: model_selection,
        agent: agent_selection,
        meta: if msg_meta.is_empty() {
            None
        } else {
            Some(msg_meta)
        },
    };

    let action = if is_steer {
        StateAction::ChatPendingMessageSet(ChatPendingMessageSetAction {
            kind: PendingMessageKind::Steering,
            id: Uuid::new_v4().to_string(),
            message: ahp_message,
        })
    } else {
        StateAction::ChatTurnStarted(ChatTurnStartedAction {
            turn_id: turn_id.to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            message: ahp_message,
            queued_message_id: None,
            meta: None,
        })
    };

    DispatchActionParams {
        channel: chat_uri,
        action,
        client_seq: client_seq as i64,
    }
}

/// Extract AHP `MessageAttachment`s from message metadata.
///
/// Supports both:
/// 1. Inline base64-encoded images pasted from mobile clipboard (`data` / `data_url` -> `MessageEmbeddedResourceAttachment`)
/// 2. Uploaded asset URLs (`url` -> `MessageResourceAttachment`)
pub fn extract_ahp_attachments(metadata: &Value) -> Vec<MessageAttachment> {
    let mut result = Vec::new();

    if let Some(items) = metadata.get("attachments").and_then(|v| v.as_array()) {
        for item in items {
            let label = item
                .get("filename")
                .or_else(|| item.get("name"))
                .or_else(|| item.get("label"))
                .and_then(|v| v.as_str())
                .unwrap_or("attachment")
                .to_string();
            let content_type = item
                .get("content_type")
                .or_else(|| item.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("image/png")
                .to_string();
            let display_kind = if content_type.starts_with("image/") {
                Some("image".to_string())
            } else {
                Some("document".to_string())
            };

            // Check if base64 data or data URL is provided for zero-latency AHP EmbeddedResource
            if let Some(raw_data) = item
                .get("data")
                .or_else(|| item.get("base64"))
                .or_else(|| item.get("data_url"))
                .and_then(|v| v.as_str())
            {
                let clean_b64 = if let Some((_prefix, b64)) = raw_data.split_once(";base64,") {
                    b64.to_string()
                } else {
                    raw_data.to_string()
                };
                if !clean_b64.is_empty() {
                    result.push(MessageAttachment::EmbeddedResource(
                        MessageEmbeddedResourceAttachment {
                            label: label.clone(),
                            range: None,
                            display_kind: display_kind.clone(),
                            meta: None,
                            data: clean_b64,
                            content_type: content_type.clone(),
                            selection: None,
                        },
                    ));
                }
            }

            if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
                if !url.starts_with("blob:") {
                    result.push(MessageAttachment::Resource(MessageResourceAttachment {
                        label,
                        range: None,
                        display_kind,
                        meta: None,
                        uri: url.to_string(),
                        size_hint: item.get("size").and_then(|v| v.as_i64()),
                        content_type: Some(content_type),
                        nonce: None,
                        selection: None,
                    }));
                }
            }
        }
    } else if let Some(url) = metadata.get("url").and_then(|v| v.as_str()) {
        if !url.starts_with("blob:") {
            let label = metadata
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("attachment")
                .to_string();
            let content_type = metadata
                .get("content_type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let display_kind = if content_type
                .as_deref()
                .unwrap_or("")
                .starts_with("image/")
            {
                Some("image".to_string())
            } else {
                Some("document".to_string())
            };
            result.push(MessageAttachment::Resource(MessageResourceAttachment {
                label,
                range: None,
                display_kind,
                meta: None,
                uri: url.to_string(),
                size_hint: metadata.get("size").and_then(|v| v.as_i64()),
                content_type,
                nonce: None,
                selection: None,
            }));
        }
    }

    result
}

/// Build an AHP `ChatTurnCancelled` action dispatch when the user stops/interrupts an active turn.
pub fn build_ahp_cancel_turn_dispatch(
    external_session_id: &str,
    turn_id: &str,
    client_seq: u64,
) -> DispatchActionParams {
    let chat_uri = chat_dispatch_uri(external_session_id);
    DispatchActionParams {
        channel: chat_uri,
        action: StateAction::ChatTurnCancelled(ChatTurnCancelledAction {
            turn_id: turn_id.to_string(),
            duration: 0,
            meta: None,
        }),
        client_seq: client_seq as i64,
    }
}

/// Build an AHP `ChatInputCompleted` action dispatch when the user answers a question or approval card.
pub fn build_ahp_input_completed_dispatch(
    external_session_id: &str,
    _turn_id: &str,
    _part_id: &str,
    request_id: &str,
    answer_payload: &Value,
    client_seq: u64,
) -> DispatchActionParams {
    let chat_uri = chat_dispatch_uri(external_session_id);
    let mut answers = HashMap::new();
    let answer_text = answer_payload
        .get("answer")
        .and_then(|v| v.as_str())
        .or_else(|| answer_payload.get("raw_answer").and_then(|v| v.as_str()))
        .unwrap_or("approved");
    answers.insert(
        "answer".to_string(),
        ChatInputAnswer::Submitted(ChatInputAnswered {
            value: ChatInputAnswerValue::Text(ChatInputTextAnswerValue {
                value: answer_text.to_string(),
            }),
        }),
    );

    DispatchActionParams {
        channel: chat_uri,
        action: StateAction::ChatInputCompleted(ChatInputCompletedAction {
            request_id: request_id.to_string(),
            response: ChatInputResponseKind::Accept,
            answers: Some(answers),
        }),
        client_seq: client_seq as i64,
    }
}

/// Build an AHP `SessionConfigChanged` or `SessionWorkingDirectorySet` action dispatch.
pub fn build_ahp_session_config_dispatch(
    external_session_id: &str,
    config_payload: &Value,
    client_seq: u64,
) -> DispatchActionParams {
    let session_uri = if external_session_id.starts_with("ahp-session:") {
        external_session_id.to_string()
    } else {
        format!("ahp-session:/{}", external_session_id)
    };

    if let Some(wd) = config_payload
        .get("working_directory")
        .or_else(|| config_payload.get("workingDirectory"))
        .and_then(|v| v.as_str())
    {
        return DispatchActionParams {
            channel: session_uri,
            action: StateAction::SessionWorkingDirectorySet(SessionWorkingDirectorySetAction {
                directory: wd.to_string(),
            }),
            client_seq: client_seq as i64,
        };
    }

    let mut config = Map::new();
    if let Some(obj) = config_payload.as_object() {
        for (k, v) in obj {
            config.insert(k.clone(), AnyValue::from(v.clone()));
        }
    }

    DispatchActionParams {
        channel: session_uri,
        action: StateAction::SessionConfigChanged(SessionConfigChangedAction {
            config,
            replace: Some(false),
        }),
        client_seq: client_seq as i64,
    }
}

/// Build an AHP `ChatPendingMessageRemoved` action dispatch.
pub fn build_ahp_remove_pending_message_dispatch(
    external_session_id: &str,
    message_id: &str,
    client_seq: u64,
) -> DispatchActionParams {
    let chat_uri = chat_dispatch_uri(external_session_id);
    DispatchActionParams {
        channel: chat_uri,
        action: StateAction::ChatPendingMessageRemoved(ChatPendingMessageRemovedAction {
            kind: PendingMessageKind::Queued,
            id: message_id.to_string(),
        }),
        client_seq: client_seq as i64,
    }
}

fn chat_dispatch_uri(id: &str) -> String {
    if id.starts_with("ahp-chat:") {
        id.to_string()
    } else {
        // Legacy sessions created by AIMS use this chat name. The proxy resolves
        // host-provided session/chat IDs through the authoritative chat catalog.
        format!("ahp-chat:/{}/main", id.trim_start_matches("ahp-session:/"))
    }
}

/// Translate an incoming AHP `StateAction` into a UI broadcast event representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedAhpEvent {
    pub external_session_id: Option<String>,
    pub event_type: String,
    pub status: Option<String>,
    pub text_delta: Option<String>,
    pub reasoning_delta: Option<String>,
    pub data: Value,
}

pub fn translate_state_action(channel: &str, action: &StateAction) -> TranslatedAhpEvent {
    let ext_id = extract_session_id_from_uri(channel);

    match action {
        StateAction::RootAgentsChanged(a) => TranslatedAhpEvent {
            external_session_id: None,
            event_type: "capabilities_sync".to_string(),
            status: None,
            text_delta: None,
            reasoning_delta: None,
            data: serde_json::to_value(a).unwrap_or_default(),
        },
        StateAction::SessionReady(_a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "status".to_string(),
            status: Some("idle".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({ "status": "idle", "session": channel }),
        },
        StateAction::SessionTitleChanged(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "session_config".to_string(),
            status: None,
            text_delta: None,
            reasoning_delta: None,
            data: json!({ "title": a.title }),
        },
        StateAction::SessionWorkingDirectorySet(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "session_config".to_string(),
            status: None,
            text_delta: None,
            reasoning_delta: None,
            data: json!({ "working_directory": a.directory }),
        },
        StateAction::SessionConfigChanged(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "session_config".to_string(),
            status: None,
            text_delta: None,
            reasoning_delta: None,
            data: serde_json::to_value(&a.config).unwrap_or_default(),
        },
        StateAction::ChatTurnStarted(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "status".to_string(),
            status: Some("running".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({
                "status": "running",
                "turn_id": a.turn_id,
                "user_message": a.message,
            }),
        },
        StateAction::ChatDelta(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "text_delta".to_string(),
            status: Some("running".to_string()),
            text_delta: Some(a.content.clone()),
            reasoning_delta: None,
            data: json!({
                "turn_id": a.turn_id,
                "part_id": a.part_id,
                "delta": a.content,
            }),
        },
        StateAction::ChatReasoning(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "thinking".to_string(),
            status: Some("thinking".to_string()),
            text_delta: None,
            reasoning_delta: Some(a.content.clone()),
            data: json!({
                "turn_id": a.turn_id,
                "part_id": a.part_id,
                "chunk": a.content,
                "thinking": a.content,
            }),
        },
        StateAction::ChatResponsePart(a) => match &a.part {
            ResponsePart::Reasoning(r) => TranslatedAhpEvent {
                external_session_id: ext_id,
                event_type: "thinking".to_string(),
                status: Some("thinking".to_string()),
                text_delta: None,
                reasoning_delta: Some(r.content.clone()),
                data: json!({
                    "turn_id": a.turn_id,
                    "chunk": r.content,
                    "thinking": r.content,
                }),
            },
            ResponsePart::ToolCall(tc) => {
                let (id, name, status_str) = match &tc.tool_call {
                    ToolCallState::Streaming(s) => {
                        (s.tool_call_id.clone(), s.display_name.clone(), "running")
                    }
                    ToolCallState::PendingConfirmation(s) => (
                        s.tool_call_id.clone(),
                        s.display_name.clone(),
                        "waiting_for_input",
                    ),
                    ToolCallState::Running(s) => {
                        (s.tool_call_id.clone(), s.display_name.clone(), "running")
                    }
                    ToolCallState::AuthRequired(s) => (
                        s.tool_call_id.clone(),
                        s.display_name.clone(),
                        "waiting_for_input",
                    ),
                    ToolCallState::PendingResultConfirmation(s) => (
                        s.tool_call_id.clone(),
                        s.display_name.clone(),
                        "waiting_for_input",
                    ),
                    ToolCallState::Completed(s) => {
                        (s.tool_call_id.clone(), s.display_name.clone(), "completed")
                    }
                    ToolCallState::Cancelled(s) => {
                        (s.tool_call_id.clone(), s.display_name.clone(), "cancelled")
                    }
                    ToolCallState::Unknown(_) => {
                        ("tool".to_string(), "Tool Call".to_string(), "running")
                    }
                };
                TranslatedAhpEvent {
                    external_session_id: ext_id,
                    event_type: "tool_call".to_string(),
                    status: Some(status_str.to_string()),
                    text_delta: None,
                    reasoning_delta: None,
                    data: json!({
                        "id": id,
                        "name": name,
                        "tool": name,
                        "step": name,
                        "tool_call": tc.tool_call,
                        "status": status_str,
                    }),
                }
            }
            ResponsePart::InputRequest(ir) => TranslatedAhpEvent {
                external_session_id: ext_id,
                event_type: "question".to_string(),
                status: Some("waiting_for_input".to_string()),
                text_delta: None,
                reasoning_delta: None,
                data: serde_json::to_value(&ir.request).unwrap_or_default(),
            },
            ResponsePart::Markdown(md) => TranslatedAhpEvent {
                external_session_id: ext_id,
                event_type: "text_delta".to_string(),
                status: Some("running".to_string()),
                text_delta: Some(md.content.clone()),
                reasoning_delta: None,
                data: json!({
                    "turn_id": a.turn_id,
                    "part_id": md.id,
                    "delta": md.content,
                }),
            },
            _ => TranslatedAhpEvent {
                external_session_id: ext_id,
                event_type: "response_part".to_string(),
                status: None,
                text_delta: None,
                reasoning_delta: None,
                data: serde_json::to_value(a).unwrap_or_default(),
            },
        },
        StateAction::ChatToolCallStart(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "tool_call".to_string(),
            status: Some("running".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({
                "id": a.tool_call_id,
                "name": a.display_name,
                "tool": a.tool_name,
                "step": a.intention.clone().unwrap_or_else(|| format!("Running {}", a.display_name)),
                "status": "running",
            }),
        },
        StateAction::ChatToolCallComplete(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "tool_call".to_string(),
            status: Some("running".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({
                "id": a.tool_call_id,
                "result": a.result,
                "status": "completed",
            }),
        },
        StateAction::ChatInputRequested(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "question".to_string(),
            status: Some("waiting_for_input".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: serde_json::to_value(&a.request).unwrap_or_default(),
        },
        StateAction::ChatTurnComplete(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "turn_completed".to_string(),
            status: Some("idle".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({
                "status": "idle",
                "turn_id": a.turn_id,
                "duration": a.duration,
            }),
        },
        StateAction::ChatTurnCancelled(a) => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "status".to_string(),
            status: Some("idle".to_string()),
            text_delta: None,
            reasoning_delta: None,
            data: json!({
                "status": "idle",
                "turn_id": a.turn_id,
                "cancelled": true,
            }),
        },
        other => TranslatedAhpEvent {
            external_session_id: ext_id,
            event_type: "ahp_action".to_string(),
            status: None,
            text_delta: None,
            reasoning_delta: None,
            data: serde_json::to_value(other).unwrap_or_default(),
        },
    }
}

pub fn extract_session_id_from_uri(uri: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use ahp_types::actions::RootAgentsChangedAction;
    use ahp_types::state::{AgentInfo, SessionModelInfo};

    #[test]
    fn chat_commands_and_envelopes_preserve_real_chat_identity() {
        for uri in ["ahp-chat:/chat-uuid", "ahp-chat://default/session-uuid"] {
            for dispatch in [
                build_ahp_user_turn_dispatch(uri, "turn", "hello", None, &json!({}), 1),
                build_ahp_cancel_turn_dispatch(uri, "turn", 2),
                build_ahp_input_completed_dispatch(uri, "turn", "part", "request", &json!({}), 3),
                build_ahp_remove_pending_message_dispatch(uri, "message", 4),
            ] {
                assert_eq!(dispatch.channel, uri);
                let translated = translate_state_action(uri, &dispatch.action);
                assert_eq!(translated.external_session_id, extract_session_id_from_uri(uri));
            }
        }
    }

    #[test]
    fn compound_chat_resources_are_not_collapsed_to_their_kind() {
        for uri in ["ahp-chat://default/session-one", "ahp-chat://default/session-two", "ahp-chat://subagent/session-one/worker"] {
            assert_eq!(extract_session_id_from_uri(uri).as_deref(), Some(uri));
        }
    }

    #[test]
    fn test_bot_ahp_mirror_applies_root_agents_changed() {
        let mut mirror = BotAhpMirror::new(42);
        let env = ActionEnvelope {
            channel: ahp_types::ROOT_RESOURCE_URI.to_string(),
            action: StateAction::RootAgentsChanged(RootAgentsChangedAction {
                agents: vec![AgentInfo {
                    provider: "copilot".to_string(),
                    display_name: "GitHub Copilot".to_string(),
                    description: "VS Code Agent Host".to_string(),
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
            }),
            server_seq: 1,
            origin: None,
            rejection_reason: None,
        };

        let outcome = mirror.apply_envelope(&env);
        assert_eq!(outcome, ReduceOutcome::Applied);
        assert_eq!(mirror.root.agents.len(), 1);

        let caps = mirror.capabilities_metadata();
        assert_eq!(caps["protocol"], "ahp");
        assert_eq!(caps["agent_roles"][0]["id"], "copilot");
        assert_eq!(caps["models"][0]["id"], "claude-sonnet-4");
    }

    #[test]
    fn session_roles_do_not_become_host_provider_ids() {
        for role in ["workspace", "coder", "architect"] {
            let params = build_ahp_create_session_params(
                "new-session",
                &json!({
                    "agent_type": role,
                }),
            );
            assert_eq!(params.provider, None);
            assert_eq!(
                params.config.unwrap()["agent_type"],
                AnyValue::from(json!(role))
            );
        }
        let params = build_ahp_create_session_params(
            "new-session",
            &json!({
                "agent_type": "coder", "provider": "copilotcli",
            }),
        );
        assert_eq!(params.provider.as_deref(), Some("copilotcli"));
    }

    #[test]
    fn test_build_create_session_and_user_turn_with_mobile_pasted_image() {
        let meta = json!({
            "working_directory": "/workspace/my-app",
            "agent_type": "coder",
            "agent_mode": "autopilot",
            "use_worktree": true,
            "base_branch": "main",
            "model": "claude-sonnet-4",
            "attachments": [
                {
                    "name": "pasted-image.png",
                    "type": "image/png",
                    "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                    "url": "/uploads/1/pasted-image.png?token=abc"
                }
            ]
        });

        let session_params = build_ahp_create_session_params("sess-123", &meta);
        assert_eq!(session_params.channel, "ahp-session:/sess-123");
        assert_eq!(
            session_params.working_directories.as_ref().map(|v| v[0].as_str()),
            Some("/workspace/my-app")
        );
        assert_eq!(session_params.provider, None);

        let dispatch = build_ahp_user_turn_dispatch(
            "sess-123",
            "turn-1",
            "Fix this mobile UI screenshot",
            Some("claude-sonnet-4"),
            &meta,
            1,
        );
        assert_eq!(dispatch.channel, "ahp-chat:/sess-123/main");
        match dispatch.action {
            StateAction::ChatTurnStarted(turn) => {
                assert_eq!(turn.message.text, "Fix this mobile UI screenshot");
                assert_eq!(
                    turn.message.model.as_ref().map(|m| m.id.as_str()),
                    Some("claude-sonnet-4")
                );
                let atts = turn.message.attachments.expect("attachments present");
                assert_eq!(atts.len(), 2);
                assert!(matches!(atts[0], MessageAttachment::EmbeddedResource(_)));
                assert!(matches!(atts[1], MessageAttachment::Resource(_)));
            }
            _ => panic!("Expected ChatTurnStarted action"),
        }
    }
}
