use serde::Serialize;
use serde_json::json;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
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

    /// Loopback port of the live bridge (last known value after a failed start).
    pub fn port(&self) -> String {
        self.config().port()
    }

    /// True when the last start attempt reported a readable error (Node missing, etc.).
    pub fn failed(&self) -> bool {
        self.config().error.is_some()
    }

    pub fn needs_restart(&self) -> bool {
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        match guard.as_mut() {
            Some(child) => !matches!(child.try_wait(), Ok(None)),
            None => true,
        }
    }

    pub fn restart(&self, app: &AppHandle) {
        sidecar_note("info", "bridge.restart", json!({}));
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
            sidecar_note("info", "bridge.shutdown", json!({ "pid": child.id() }));
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

// ---------------------------------------------------------------------------
// Sidecar log: the packaged app has no console, so anything the bridge (or its
// launch) reports must land in <APPDATA>/PetDeck/logs. Same shape as the Node
// logger (JSON lines, daily name, 5 MB rotation, 7 day retention) so one
// diagnostic package can read both.
// ---------------------------------------------------------------------------

const SIDECAR_MAX_BYTES: u64 = 5 * 1024 * 1024;
const SIDECAR_KEEP_DAYS: i64 = 7;

/// Howard Hinnant's days-to-civil conversion (no chrono dependency).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

fn date_string(days: i64) -> String {
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn epoch_days() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| (duration.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

fn timestamp_iso() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let rem = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

fn log_dir() -> PathBuf {
    #[cfg(windows)]
    if let Ok(appdata) = std::env::var("APPDATA") {
        if !appdata.trim().is_empty() {
            return PathBuf::from(appdata).join("PetDeck").join("logs");
        }
    }
    std::env::temp_dir().join("PetDeck").join("logs")
}

fn sidecar_name(date: &str, index: usize) -> String {
    if index == 0 {
        format!("sidecar-{date}.log")
    } else {
        format!("sidecar-{date}.{index}.log")
    }
}

fn prune_sidecar_logs(dir: &std::path::Path, today: i64) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let cutoff = date_string(today - SIDECAR_KEEP_DAYS);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(rest) = name.strip_prefix("sidecar-") else { continue };
        if rest.len() < 10 {
            continue;
        }
        let date = &rest[..10];
        if date < cutoff.as_str() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn open_sidecar_log() -> Option<(PathBuf, File)> {
    let dir = log_dir();
    fs::create_dir_all(&dir).ok()?;
    let today = epoch_days();
    prune_sidecar_logs(&dir, today);
    let date = date_string(today);
    for index in 0..64 {
        let path = dir.join(sidecar_name(&date, index));
        let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        if size < SIDECAR_MAX_BYTES {
            return OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok()
                .map(|file| (path, file));
        }
    }
    None
}

fn json_line(level: &str, msg: &str, fields: serde_json::Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("ts".to_string(), serde_json::Value::String(timestamp_iso()));
    object.insert("level".to_string(), serde_json::Value::String(level.to_string()));
    object.insert("scope".to_string(), serde_json::Value::String("sidecar".to_string()));
    object.insert("msg".to_string(), serde_json::Value::String(msg.to_string()));
    if let serde_json::Value::Object(extra) = fields {
        for (key, value) in extra {
            object.insert(key, value);
        }
    }
    serde_json::Value::Object(object).to_string()
}

fn write_sidecar(file: &mut File, level: &str, msg: &str, fields: serde_json::Value) {
    let _ = writeln!(file, "{}", json_line(level, msg, fields));
}

/// Append one line, opening (and rotating) the sidecar log on demand.
fn sidecar_note(level: &str, msg: &str, fields: serde_json::Value) {
    if let Some((_, mut file)) = open_sidecar_log() {
        write_sidecar(&mut file, level, msg, fields);
    }
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
    sidecar_note("info", "bridge.start", json!({ "port": config.port() }));
    config.error = node_version_error();
    if let Some(reason) = config.error.as_ref() {
        sidecar_note("error", "bridge.node_unavailable", json!({ "reason": reason }));
    }
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
                    .stdin(Stdio::null());
                // The packaged app has no console: send bridge stdout/stderr to the
                // sidecar log so a crash, a port conflict or a bad script stays visible.
                match open_sidecar_log() {
                    Some((path, file)) => {
                        sidecar_note(
                            "info",
                            "bridge.sidecar_log",
                            json!({
                                "file": path
                                    .file_name()
                                    .map(|name| name.to_string_lossy().to_string())
                                    .unwrap_or_default()
                            }),
                        );
                        match (file.try_clone(), file.try_clone()) {
                            (Ok(stdout), Ok(stderr)) => {
                                command.stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr));
                            }
                            _ => {
                                command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
                            }
                        }
                    }
                    None => {
                        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
                    }
                }
                if let Some(dir) = working_dir {
                    command.current_dir(dir);
                }
                #[cfg(windows)]
                command.creation_flags(CREATE_NO_WINDOW);
                match command.spawn() {
                    Ok(child) => {
                        sidecar_note("info", "bridge.spawned", json!({ "pid": child.id() }));
                        Some(child)
                    }
                    Err(error) => {
                        sidecar_note(
                            "error",
                            "bridge.spawn_failed",
                            json!({ "reason": error.to_string() }),
                        );
                        config.error = Some(
                            "本地 bridge 启动失败，请检查 Node.js 安装后重启应用。".to_string(),
                        );
                        None
                    }
                }
            }
            Err(error) => {
                sidecar_note("error", "bridge.script_missing", json!({ "reason": error }));
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

    #[test]
    fn sidecar_dates_use_the_utc_calendar() {
        assert_eq!(date_string(0), "1970-01-01");
        assert_eq!(date_string(20_778), "2026-11-21");
        assert_eq!(sidecar_name("2026-11-21", 0), "sidecar-2026-11-21.log");
        assert_eq!(sidecar_name("2026-11-21", 2), "sidecar-2026-11-21.2.log");
        assert!(timestamp_iso().ends_with('Z'));
    }

    #[test]
    fn sidecar_prune_keeps_recent_days() {
        let dir = std::env::temp_dir().join(format!("petdeck-sidecar-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let today = 20_778;
        let stale = dir.join(sidecar_name(&date_string(today - 30), 0));
        let recent = dir.join(sidecar_name(&date_string(today - 1), 0));
        let foreign = dir.join("nodejs-2020-01-01.log");
        fs::write(&stale, "{}").unwrap();
        fs::write(&recent, "{}").unwrap();
        fs::write(&foreign, "{}").unwrap();
        prune_sidecar_logs(&dir, today);
        assert!(!stale.exists());
        assert!(recent.exists());
        assert!(foreign.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
