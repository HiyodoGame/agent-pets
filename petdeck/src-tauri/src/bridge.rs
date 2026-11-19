use serde::Serialize;
use std::net::TcpListener;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    url: String,
    token: String,
    error: Option<String>,
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
            error: None,
        }
    }

    fn port(&self) -> String {
        self.url.rsplit(':').next().unwrap_or("5199").to_string()
    }
}

pub struct BridgeState {
    config: Mutex<BridgeConfig>,
    child: Mutex<Option<Child>>,
}

impl BridgeState {
    pub fn config(&self) -> BridgeConfig {
        self.config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn needs_restart(&self) -> bool {
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        match guard.as_mut() {
            Some(child) => !matches!(child.try_wait(), Ok(None)),
            None => true,
        }
    }

    pub fn restart(&self, app: &AppHandle) {
        self.shutdown();
        let replacement = start_bridge(app);
        let config = replacement.config();
        let child = replacement
            .child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        *self
            .config
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = config;
        *self.child.lock().unwrap_or_else(|error| error.into_inner()) = child;
    }

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

fn node_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    if let Some(path) = path.to_string_lossy().strip_prefix("\\\\?\\") {
        return PathBuf::from(path);
    }
    path
}

fn resolve_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(node_compatible_path(bridge_script_path()));
    }
    app.path()
        .resource_dir()
        .map(|path| node_compatible_path(path.join("server").join("bridge.mjs")))
        .map_err(|error| error.to_string())
}

fn node_version_supported(version: &str) -> bool {
    version
        .trim()
        .strip_prefix('v')
        .and_then(|value| value.split('.').next())
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 24)
}

fn node_version_error() -> Option<String> {
    let mut command = Command::new("node");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    match command.arg("--version").output() {
        Ok(output)
            if output.status.success()
                && node_version_supported(&String::from_utf8_lossy(&output.stdout)) =>
        {
            None
        }
        Ok(_) => Some("PetDeck 需要 Node.js 24 或更新版本，请升级后重启应用。".to_string()),
        Err(_) => Some("未检测到 Node.js，请安装 Node.js 24 后重启 PetDeck。".to_string()),
    }
}

pub fn start_bridge(app: &AppHandle) -> BridgeState {
    let mut config = BridgeConfig::new();
    config.error = node_version_error();
    let child = if config.error.is_some() {
        None
    } else {
        match resolve_bridge_script(app) {
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
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());
                if let Some(dir) = working_dir {
                    command.current_dir(dir);
                }
                #[cfg(windows)]
                command.creation_flags(CREATE_NO_WINDOW);
                match command.spawn() {
                    Ok(child) => Some(child),
                    Err(_) => {
                        config.error = Some(
                            "本地 bridge 启动失败，请检查 Node.js 安装后重启应用。".to_string(),
                        );
                        None
                    }
                }
            }
            Err(_) => {
                config.error = Some("应用缺少本地 bridge 组件，请重新安装 PetDeck。".to_string());
                None
            }
        }
    };
    BridgeState {
        config: Mutex::new(config),
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
    fn node_script_path_does_not_use_windows_verbatim_prefix() {
        let path = node_compatible_path(PathBuf::from("\\\\?\\F:\\project\\server\\bridge.mjs"));
        assert_eq!(path, PathBuf::from("F:\\project\\server\\bridge.mjs"));
    }

    #[test]
    fn node_version_check_requires_24_or_newer() {
        assert!(node_version_supported("v24.18.0"));
        assert!(node_version_supported("v25.0.0"));
        assert!(!node_version_supported("v23.11.1"));
        assert!(!node_version_supported("not-a-version"));
    }

    #[test]
    fn missing_child_requires_bridge_restart() {
        let state = BridgeState {
            config: Mutex::new(BridgeConfig::new()),
            child: Mutex::new(None),
        };
        assert!(state.needs_restart());
    }

    #[test]
    fn development_bridge_script_is_the_existing_node_server() {
        let path = bridge_script_path();
        assert!(path.ends_with("server/bridge.mjs") || path.ends_with("server\\bridge.mjs"));
        assert!(path.is_file());
    }
}
