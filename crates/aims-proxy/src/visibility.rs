use std::collections::HashSet;

use serde_json::{json, Value};

pub(crate) fn subagent_uri(uri: &str) -> bool {
    uri.starts_with("ahp-chat://subagent/")
}

pub(crate) fn subagent_entry(entry: &Value) -> bool {
    ["session_id", "session_uri", "external_session_id"]
        .iter()
        .any(|key| entry[*key].as_str().is_some_and(subagent_uri))
        || entry["metadata"]["is_subagent"] == true
}

/// Keep subagents observable locally while preventing standalone AIMS rows.
/// Archived sync entries also hide rows on older AIMS servers.
pub(crate) fn for_aims(mut frame: Value, hidden: &mut HashSet<String>) -> Option<Value> {
    match frame["event"].as_str() {
        Some("sync_sessions") => {
            if let Some(entries) = frame["payload"]["sessions"].as_array_mut() {
                for entry in entries {
                    if subagent_entry(entry)
                        || entry["session_id"]
                            .as_str()
                            .is_some_and(|id| hidden.contains(id))
                    {
                        if let Some(id) = entry["session_id"].as_str() {
                            hidden.insert(id.to_string());
                        }
                        entry["status"] = json!("archived");
                        if !entry["metadata"].is_object() {
                            entry["metadata"] = json!({});
                        }
                        entry["metadata"]["is_subagent"] = json!(true);
                        entry["metadata"]["hidden_from_session_list"] = json!(true);
                    }
                }
            }
        }
        Some("ahp_envelope") => {
            let uri = frame["payload"]["channel"].as_str().unwrap_or("");
            let id = crate::extract_session_id_from_uri(uri).unwrap_or_else(|| uri.to_string());
            if subagent_uri(uri) || hidden.contains(&id) {
                return None;
            }
        }
        Some("sync_messages" | "session_messages" | "session_status") => {
            let payload = &frame["payload"];
            if ["chat_uri", "external_session_id", "session_id"]
                .iter()
                .any(|key| {
                    payload[*key]
                        .as_str()
                        .is_some_and(|id| subagent_uri(id) || hidden.contains(id))
                })
            {
                return None;
            }
        }
        _ => {}
    }
    Some(frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archives_only_confirmed_subagents_and_blocks_reactivation() {
        let child = "ahp-chat://subagent/parent/worker";
        let parent = "ahp-chat://default/parent";
        let mut hidden = HashSet::new();
        let frame = for_aims(
            json!({"event": "sync_sessions", "payload": {"sessions": [
                {"session_id": child, "status": "running"},
                {"session_id": parent, "status": "running", "title": "subagent investigation"},
                {"session_id": "tool-child", "status": "idle", "metadata": {"is_subagent": true}}
            ]}}),
            &mut hidden,
        )
        .unwrap();
        assert_eq!(frame["payload"]["sessions"][0]["status"], "archived");
        assert_eq!(
            frame["payload"]["sessions"][0]["metadata"]["is_subagent"],
            true
        );
        assert_eq!(frame["payload"]["sessions"][1]["status"], "running");
        assert_eq!(frame["payload"]["sessions"][2]["status"], "archived");
        let summary = for_aims(
            json!({"event": "sync_sessions", "payload": {"sessions": [
                {"session_id": "tool-child", "status": "running"}
            ]}}),
            &mut hidden,
        )
        .unwrap();
        assert_eq!(summary["payload"]["sessions"][0]["status"], "archived");
        for uri in [child, "tool-child"] {
            assert!(for_aims(
                json!({"event": "ahp_envelope", "payload": {
                    "channel": uri, "action": {"type": "chat/turnStarted"}
                }}),
                &mut hidden
            )
            .is_none());
            assert!(for_aims(
                json!({"event": "sync_messages", "payload": {
                    "external_session_id": uri, "messages": []
                }}),
                &mut hidden
            )
            .is_none());
        }
        assert!(for_aims(
            json!({"event": "ahp_envelope", "payload": {
                "channel": parent, "action": {"type": "chat/turnStarted"}
            }}),
            &mut hidden
        )
        .is_some());
    }
}
