use serde::Serialize;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    url: String,
    token: String,
}

impl BridgeConfig {
    fn new() -> Self {
        let port = TcpListener::bind("127.0.0.1:0")
            .and_then(|listener| listener.local_addr())
            .map(|address| address.port())
            .unwrap_or(5199);
        Self {
            url: format!("http://127.0.0.1:{port}"),
            token: Uuid::new_v4().to_string(),
        }
    }

    fn port(&self) -> String {
        self.url.rsplit(':').next().unwrap_or("5199").to_string()
    }
}

pub struct BridgeState {
    pub config: BridgeConfig,
    child: Mutex<Option<Child>>,
}

impl BridgeState {
    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for BridgeState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn bridge_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server")
        .join("bridge.mjs")
}

fn resolve_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(bridge_script_path());
    }
    app.path()
        .resource_dir()
        .map(|path| path.join("server").join("bridge.mjs"))
        .map_err(|error| error.to_string())
}

pub fn start_bridge(app: &AppHandle) -> BridgeState {
    let config = BridgeConfig::new();
    let child = match resolve_bridge_script(app) {
        Ok(script) => {
            let working_dir = script.parent().map(PathBuf::from);
            let mut command = Command::new("node");
            command
                .arg(&script)
                .env("PETDECK_BRIDGE_TOKEN", &config.token)
                .env("PETDECK_BRIDGE_PORT", config.port())
                .env(
                    "PETDECK_BRIDGE_ORIGINS",
                    "http://tauri.localhost,http://localhost:5183",
                )
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if let Some(dir) = working_dir {
                command.current_dir(dir);
            }
            match command.spawn() {
                Ok(child) => Some(child),
                Err(error) => {
                    eprintln!("[petdeck] bridge start failed: {error}");
                    None
                }
            }
        }
        Err(error) => {
            eprintln!("[petdeck] bridge path unavailable: {error}");
            None
        }
    };
    BridgeState {
        config,
        child: Mutex::new(child),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_config_generates_secret_and_loopback_url() {
        let first = BridgeConfig::new();
        let second = BridgeConfig::new();
        assert_eq!(first.token.len(), 36);
        assert_ne!(first.token, second.token);
        assert!(first.url.starts_with("http://127.0.0.1:"));
        let port = first.url.rsplit(':').next().unwrap().parse::<u16>();
        assert!(port.is_ok());
    }

    #[test]
    fn development_bridge_script_is_the_existing_node_server() {
        let path = bridge_script_path();
        assert!(path.ends_with("server/bridge.mjs") || path.ends_with("server\\bridge.mjs"));
        assert!(path.is_file());
    }
}
