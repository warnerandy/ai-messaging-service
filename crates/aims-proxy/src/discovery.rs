//! Auto-discovery for local VS Code Agent Host Protocol (AHP) endpoints.
//!
//! Scans the filesystem registry written by VS Code and compatible editors
//! (VS Code, VS Code Insiders, Cursor, Windsurf, VSCodium) under:
//! `<userDataPath>/agent-host/local-endpoint/entries/<identity>.json`
//!
//! Reference: `src/vs/platform/agentHost/LOCAL_ENDPOINT.md` in `microsoft/vscode`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;
use tracing::{debug, info};

/// Discovered AHP endpoint target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AhpTarget {
    /// Unix domain socket path (macOS / Linux)
    UnixSocket(PathBuf),
    /// Local TCP endpoint (host and port)
    Tcp { host: String, port: u16 },
}

/// Metadata describing a discovered agent host endpoint.
#[derive(Debug, Clone)]
pub struct DiscoveredEndpoint {
    /// Source registry JSON file
    pub source_file: PathBuf,
    /// Last modified time of the registry file
    pub mtime: Option<SystemTime>,
    /// PID of the host process
    pub pid: Option<u32>,
    /// Entry type ("editor", "standalone", etc.)
    pub entry_type: String,
    /// Protocol version advertised by the endpoint
    pub protocol_version: Option<String>,
    /// Secret authentication token to append as `?tkn=<token>`
    pub token: Option<String>,
    /// Connection target
    pub target: AhpTarget,
}

#[derive(Debug, Deserialize)]
struct RegistryEntryJson {
    #[serde(rename = "schemaVersion")]
    schema_version: Option<u32>,
    #[serde(rename = "type")]
    entry_type: Option<String>,
    pid: Option<u32>,
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<String>,
    #[serde(rename = "connectionToken")]
    connection_token: Option<String>,
    token: Option<String>,
    endpoint: Option<EndpointDetailsJson>,
    #[serde(rename = "socketPath")]
    socket_path: Option<String>,
    path: Option<String>,
    port: Option<u16>,
    host: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EndpointDetailsJson {
    #[serde(rename = "type")]
    endpoint_type: Option<String>,
    path: Option<String>,
    host: Option<String>,
    port: Option<u16>,
}

/// Discovers candidate directories where VS Code and related IDEs write local AHP endpoint entries.
pub fn candidate_registry_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // 1. Environment variable overrides
    if let Ok(dir) = std::env::var("VSCODE_AGENT_HOST_DIR") {
        let p = PathBuf::from(dir);
        if p.join("entries").is_dir() {
            dirs.push(p.join("entries"));
        } else {
            dirs.push(p);
        }
    }
    if let Ok(dir) = std::env::var("AHP_ENDPOINT_DIR") {
        dirs.push(PathBuf::from(dir));
    }

    // 2. macOS candidates: ~/Library/Application Support/<Editor>/agent-host/local-endpoint/entries
    if let Ok(home) = std::env::var("HOME") {
        let home_path = Path::new(&home);
        let mac_app_support = home_path.join("Library/Application Support");
        let mac_editors = [
            "Code",
            "Code - Insiders",
            "Cursor",
            "Windsurf",
            "VSCodium",
            "Positron",
            "Trae",
        ];
        for editor in &mac_editors {
            dirs.push(
                mac_app_support
                    .join(editor)
                    .join("agent-host/local-endpoint/entries"),
            );
        }

        // 3. Linux candidates: ~/.config/<Editor>/agent-host/local-endpoint/entries
        let linux_config = if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            PathBuf::from(xdg)
        } else {
            home_path.join(".config")
        };
        for editor in &mac_editors {
            dirs.push(
                linux_config
                    .join(editor)
                    .join("agent-host/local-endpoint/entries"),
            );
        }
    }

    // 4. Windows candidates: %APPDATA%\<Editor>\agent-host\local-endpoint\entries
    if let Ok(appdata) = std::env::var("APPDATA") {
        let appdata_path = Path::new(&appdata);
        let win_editors = ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"];
        for editor in &win_editors {
            dirs.push(
                appdata_path
                    .join(editor)
                    .join(r"agent-host\local-endpoint\entries"),
            );
        }
    }

    dirs
}

/// Finds all valid, active AHP endpoints currently registered on the machine.
pub fn find_all_endpoints() -> Vec<DiscoveredEndpoint> {
    let mut discovered = Vec::new();
    let dirs = candidate_registry_dirs();

    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }

        debug!("Scanning endpoint registry directory: {}", dir.display());
        let read_dir = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let mtime = entry.metadata().ok().and_then(|m| m.modified().ok());
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let parsed: RegistryEntryJson = match serde_json::from_str(&content) {
                Ok(p) => p,
                Err(e) => {
                    debug!("Failed to parse {}: {}", path.display(), e);
                    continue;
                }
            };

            // Schema version checking (supports v2 and legacy v1)
            if let Some(ver) = parsed.schema_version {
                if ver > 2 {
                    debug!("Skipping {} due to unknown schemaVersion {}", path.display(), ver);
                    continue;
                }
            }

            let token = parsed.connection_token.or(parsed.token);
            let entry_type = parsed.entry_type.unwrap_or_else(|| "editor".to_string());

            // Extract target: check nested `endpoint` first, then root fallback fields
            let target = if let Some(ep) = parsed.endpoint {
                if ep.endpoint_type.as_deref() == Some("tcp") || ep.port.is_some() {
                    let host = ep.host.unwrap_or_else(|| "127.0.0.1".to_string());
                    let port = ep.port.unwrap_or(4034);
                    Some(AhpTarget::Tcp { host, port })
                } else if let Some(sock_path) = ep.path {
                    let p = PathBuf::from(sock_path);
                    // For unix socket, check that the socket file actually exists
                    if p.exists() {
                        Some(AhpTarget::UnixSocket(p))
                    } else {
                        debug!("Ignoring socket {} because it does not exist", p.display());
                        None
                    }
                } else {
                    None
                }
            } else if let Some(sock_path) = parsed.socket_path.or(parsed.path) {
                let p = PathBuf::from(sock_path);
                if p.exists() {
                    Some(AhpTarget::UnixSocket(p))
                } else {
                    None
                }
            } else if let Some(port) = parsed.port {
                let host = parsed.host.unwrap_or_else(|| "127.0.0.1".to_string());
                Some(AhpTarget::Tcp { host, port })
            } else {
                None
            };

            if let Some(target) = target {
                discovered.push(DiscoveredEndpoint {
                    source_file: path,
                    mtime,
                    pid: parsed.pid,
                    entry_type,
                    protocol_version: parsed.protocol_version,
                    token,
                    target,
                });
            }
        }
    }

    // Sort by mtime descending so newest session is first
    discovered.sort_by(|a, b| match (a.mtime, b.mtime) {
        (Some(ta), Some(tb)) => tb.cmp(&ta),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    discovered
}

/// Discovers the single most recent active AHP endpoint.
pub fn discover_active_endpoint() -> Option<DiscoveredEndpoint> {
    let endpoints = find_all_endpoints();
    if endpoints.is_empty() {
        None
    } else {
        let best = endpoints.into_iter().next().unwrap();
        info!(
            "Discovered active VS Code AHP endpoint: {:?} (pid={:?}, type={}) from {}",
            best.target,
            best.pid,
            best.entry_type,
            best.source_file.display()
        );
        Some(best)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidate_registry_dirs() {
        let dirs = candidate_registry_dirs();
        assert!(!dirs.is_empty(), "Should produce at least some candidate directories");
    }

    #[test]
    fn test_parse_tcp_entry_json() {
        let json_data = r#"{
            "schemaVersion": 2,
            "type": "standalone",
            "pid": 12345,
            "instanceId": "inst-1",
            "protocolVersion": "0.7.0",
            "connectionToken": "secret-token-123",
            "endpoint": {
                "type": "tcp",
                "host": "127.0.0.1",
                "port": 4034
            }
        }"#;

        let parsed: RegistryEntryJson = serde_json::from_str(json_data).unwrap();
        assert_eq!(parsed.schema_version, Some(2));
        assert_eq!(parsed.connection_token, Some("secret-token-123".to_string()));
        let ep = parsed.endpoint.unwrap();
        assert_eq!(ep.endpoint_type, Some("tcp".to_string()));
        assert_eq!(ep.port, Some(4034));
    }

    #[test]
    fn test_parse_unix_socket_entry_json() {
        let json_data = r#"{
            "schemaVersion": 2,
            "type": "editor",
            "pid": 54321,
            "connectionToken": "tkn-abc",
            "endpoint": {
                "type": "socket",
                "path": "/var/folders/dummy/vscode.sock"
            }
        }"#;

        let parsed: RegistryEntryJson = serde_json::from_str(json_data).unwrap();
        assert_eq!(parsed.pid, Some(54321));
        assert_eq!(parsed.connection_token, Some("tkn-abc".to_string()));
        let ep = parsed.endpoint.unwrap();
        assert_eq!(ep.endpoint_type, Some("socket".to_string()));
        assert_eq!(ep.path, Some("/var/folders/dummy/vscode.sock".to_string()));
    }
}
