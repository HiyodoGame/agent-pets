use serde::Serialize;
use serde_json::json;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

fn health_response_ok(response: &[u8]) -> bool {
    let text = String::from_utf8_lossy(response);
    (text.starts_with("HTTP/1.1 200 ") || text.starts_with("HTTP/1.0 200 "))
        && text.contains("\"ok\":true")
}

/// A successful spawn only proves Node started, not that the selected port is our
/// bridge. Probe the unauthenticated health shape without sending the bearer token;
/// on conflict/early exit the frontend receives an explicit error instead of a URL
/// that could belong to another local process.
fn wait_for_bridge_ready(config: &BridgeConfig, child: &mut Child) -> Result<(), String> {
    let address = format!("127.0.0.1:{}", config.port())
        .parse()
        .map_err(|error| format!("invalid bridge address: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Err(format!("bridge exited before ready: {status}")),
            Ok(None) => {}
            Err(error) => return Err(format!("bridge status check failed: {error}")),
        }
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(100)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
            let request = format!(
                "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
                config.port()
            );
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut response = Vec::new();
                if stream.take(16 * 1024).read_to_end(&mut response).is_ok()
                    && health_response_ok(&response)
                {
                    return Ok(());
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("bridge health check timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub struct BridgeState {
    config: Mutex<BridgeConfig>,
    child: Mutex<Option<Child>>,
}

#[cfg(windows)]
fn windows_taskkill_command(pid: u32) -> Command {
    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW);
    command
}

fn wait_for_child(child: &mut Child, event: &str) {
    if let Err(error) = child.wait() {
        sidecar_note("error", event, json!({ "reason": error.to_string() }));
    }
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) {
    let pid = child.id();
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            sidecar_note(
                "warn",
                "bridge.shutdown_status_failed",
                json!({ "pid": pid, "reason": error.to_string() }),
            );
        }
    }

    match windows_taskkill_command(pid).output() {
        Ok(output) if output.status.success() => {
            // taskkill waits for its own work; wait() also reaps the Node handle.
            wait_for_child(child, "bridge.shutdown_wait_failed");
        }
        result => {
            // A process can exit between try_wait and taskkill. That is success,
            // not a reason to report a tree-cleanup failure.
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            let (reason, stderr) = match result {
                Ok(output) => (
                    format!("taskkill exited with status {}", output.status),
                    String::from_utf8_lossy(&output.stderr).trim().to_string(),
                ),
                Err(error) => (error.to_string(), String::new()),
            };
            sidecar_note(
                "error",
                "bridge.shutdown_tree_failed",
                json!({ "pid": pid, "reason": reason, "stderr": stderr }),
            );
            // Preserve the old safety net if taskkill itself is unavailable.
            if let Err(error) = child.kill() {
                sidecar_note(
                    "error",
                    "bridge.shutdown_kill_failed",
                    json!({ "pid": pid, "reason": error.to_string() }),
                );
            }
            wait_for_child(child, "bridge.shutdown_wait_failed");
        }
    }
}

#[cfg(not(windows))]
fn terminate_process_tree(child: &mut Child) {
    // Children are not detached into a new process group, so killing only the
    // direct child is the safe portable fallback (never kill the app's group).
    if let Err(error) = child.kill() {
        sidecar_note(
            "error",
            "bridge.shutdown_kill_failed",
            json!({ "pid": child.id(), "reason": error.to_string() }),
        );
    }
    wait_for_child(child, "bridge.shutdown_wait_failed");
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
            terminate_process_tree(&mut child);
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
    if let Some(path) = path.to_str() {
        if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") {
            return PathBuf::from(format!("\\\\{unc}"));
        }
        if let Some(local) = path.strip_prefix("\\\\?\\") {
            return PathBuf::from(local);
        }
    }
    path
}

fn checked_bridge_script(path: PathBuf) -> Result<PathBuf, String> {
    let path = node_compatible_path(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("bridge script {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("bridge script {} is not a file", path.display()));
    }
    File::open(&path)
        .map_err(|error| format!("bridge script {} is not readable: {error}", path.display()))?;
    Ok(path)
}

fn resolve_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return checked_bridge_script(bridge_script_path());
    }
    app.path()
        .resource_dir()
        .map_err(|error| error.to_string())
        .and_then(|path| checked_bridge_script(path.join("server").join("bridge.mjs")))
}

fn node_version_supported(version: &str) -> bool {
    version
        .trim()
        .strip_prefix('v')
        .and_then(|value| value.split('.').next())
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 24)
}

#[derive(Debug, Clone)]
struct NodeRuntime {
    command: PathBuf,
    source: &'static str,
    version: String,
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Bundled runtime candidates, in priority order. The deps directory handles
/// the lib test binary path (target/debug/deps), while the resource locations
/// cover installs where the sidecar was copied next to the executable.
fn bundled_node_candidates(exe_dir: Option<&Path>, resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = exe_dir {
        candidates.push(dir.join(node_binary_name()));
        if dir
            .file_name()
            .is_some_and(|name| name.to_string_lossy() == "deps")
        {
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join(node_binary_name()));
            }
        }
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("nodejs").join(node_binary_name()));
        candidates.push(dir.join(node_binary_name()));
    }
    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.contains(&candidate) {
            unique.push(candidate);
        }
    }
    unique
}

fn probe_node(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Pick the runtime that launches the bridge. Release builds only trust the
/// bundled node.exe; debug builds fall back to PATH so tauri dev keeps working
/// before fetch-node has run.
fn select_node_runtime<F>(
    debug: bool,
    exe_dir: Option<&Path>,
    resource_dir: Option<&Path>,
    mut probe: F,
) -> Result<NodeRuntime, String>
where
    F: FnMut(&Path) -> Option<String>,
{
    let mut broken = false;
    let mut too_old: Option<String> = None;
    for candidate in bundled_node_candidates(exe_dir, resource_dir) {
        if !candidate.is_file() {
            continue;
        }
        match probe(&candidate) {
            Some(version) if node_version_supported(&version) => {
                return Ok(NodeRuntime {
                    command: candidate,
                    source: "bundled",
                    version,
                });
            }
            Some(version) => too_old = Some(version),
            None => broken = true,
        }
    }

    if debug {
        if let Some(version) = probe(Path::new("node")) {
            if node_version_supported(&version) {
                return Ok(NodeRuntime {
                    command: PathBuf::from("node"),
                    source: "system",
                    version,
                });
            }
            return Err(format!(
                "开发模式需要 Node.js 24 或更新版本，当前系统 Node.js 为 {version}。"
            ));
        }
        if let Some(version) = too_old {
            return Err(format!(
                "应用内置的 Node.js 版本过低（{version}），请运行 npm run fetch-node 更新内置运行时。"
            ));
        }
        return Err(
            "开发模式未检测到 Node.js。请安装 Node.js 24，或运行 npm run fetch-node 生成内置运行时。"
                .to_string(),
        );
    }

    if let Some(version) = too_old {
        return Err(format!(
            "应用内置的 Node.js 版本过低（{version}），安装可能不完整，请重新安装 PetDeck。"
        ));
    }
    if broken {
        return Err(
            "应用内置的 Node.js 运行时无法启动，安装可能已损坏，请重新安装 PetDeck。".to_string(),
        );
    }
    Err("应用内置的 Node.js 运行时缺失，安装可能不完整，请重新安装 PetDeck。".to_string())
}

fn resolve_node_runtime(app: &AppHandle) -> Result<NodeRuntime, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let resource_dir = app.path().resource_dir().ok();
    select_node_runtime(
        cfg!(debug_assertions),
        exe_dir.as_deref(),
        resource_dir.as_deref(),
        probe_node,
    )
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
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = date_string(today - SIDECAR_KEEP_DAYS);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(rest) = name.strip_prefix("sidecar-") else {
            continue;
        };
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
    object.insert(
        "level".to_string(),
        serde_json::Value::String(level.to_string()),
    );
    object.insert(
        "scope".to_string(),
        serde_json::Value::String("sidecar".to_string()),
    );
    object.insert(
        "msg".to_string(),
        serde_json::Value::String(msg.to_string()),
    );
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
pub(crate) fn sidecar_note(level: &str, msg: &str, fields: serde_json::Value) {
    if let Some((_, mut file)) = open_sidecar_log() {
        write_sidecar(&mut file, level, msg, fields);
    }
}

// Node selection is implemented above by resolve_node_runtime; start_bridge keeps
// the chosen command so spawn never falls back to a different PATH binary.

pub fn start_bridge(app: &AppHandle) -> BridgeState {
    let mut config = BridgeConfig::new();
    let app_version = app.package_info().version.to_string();
    sidecar_note(
        "info",
        "bridge.start",
        json!({ "port": config.port(), "version": app_version }),
    );
    let node = match resolve_node_runtime(app) {
        Ok(node) => {
            sidecar_note(
                "info",
                "bridge.node_selected",
                json!({
                    "source": node.source,
                    "version": node.version,
                    "file": node
                        .command
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                        .unwrap_or_default(),
                }),
            );
            Some(node)
        }
        Err(reason) => {
            sidecar_note(
                "error",
                "bridge.node_unavailable",
                json!({ "reason": reason }),
            );
            config.error = Some(reason);
            None
        }
    };
    let child = match node.as_ref() {
        None => None,
        Some(node) => match resolve_bridge_script(app) {
            Ok(script) => {
                let working_dir = script.parent().map(PathBuf::from);
                let mut command = Command::new(&node.command);
                command
                    .arg(&script)
                    .env("PETDECK_APP_VERSION", &app_version)
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
                                command
                                    .stdout(Stdio::from(stdout))
                                    .stderr(Stdio::from(stderr));
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
                    Ok(mut child) => {
                        sidecar_note("info", "bridge.spawned", json!({ "pid": child.id() }));
                        match wait_for_bridge_ready(&config, &mut child) {
                            Ok(()) => {
                                sidecar_note("info", "bridge.ready", json!({ "pid": child.id() }));
                                Some(child)
                            }
                            Err(reason) => {
                                sidecar_note(
                                    "error",
                                    "bridge.ready_failed",
                                    json!({ "reason": reason }),
                                );
                                config.error = Some(
                                    "本地 bridge 未能通过启动检查，请查看日志后重启本地服务。"
                                        .to_string(),
                                );
                                // Do not let the frontend send the fresh token to a process
                                // that won the ephemeral-port race.
                                config.url = "http://127.0.0.1:0".to_string();
                                terminate_process_tree(&mut child);
                                None
                            }
                        }
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
        },
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
    fn bridge_ready_requires_http_success_and_health_payload() {
        assert!(health_response_ok(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}"
        ));
        assert!(!health_response_ok(
            b"HTTP/1.1 503 Service Unavailable\r\n\r\n{\"ok\":true}"
        ));
        assert!(!health_response_ok(
            b"HTTP/1.1 200 OK\r\n\r\n{\"ok\":false}"
        ));
        assert!(!health_response_ok(b"HTTP/1.1 200 OK\r\n\r\nnot json"));
    }

    #[test]
    #[cfg(windows)]
    fn node_script_path_does_not_use_windows_verbatim_prefix() {
        let path = node_compatible_path(PathBuf::from("\\\\?\\F:\\project\\server\\bridge.mjs"));
        assert_eq!(path, PathBuf::from("F:\\project\\server\\bridge.mjs"));
    }

    #[test]
    #[cfg(windows)]
    fn node_script_path_converts_verbatim_unc_to_standard_unc() {
        let path = node_compatible_path(PathBuf::from(
            "\\\\?\\UNC\\server\\share\\project\\server\\bridge.mjs",
        ));
        assert_eq!(
            path,
            PathBuf::from("\\\\server\\share\\project\\server\\bridge.mjs")
        );
    }

    #[test]
    #[cfg(windows)]
    fn node_script_path_leaves_normal_paths_unchanged() {
        let local = PathBuf::from("F:\\project\\server\\bridge.mjs");
        let unc = PathBuf::from("\\\\server\\share\\bridge.mjs");
        assert_eq!(node_compatible_path(local.clone()), local);
        assert_eq!(node_compatible_path(unc.clone()), unc);
    }

    #[test]
    fn bridge_script_must_exist_and_be_a_readable_file() {
        let dir = temp_node_dir("bridge-script");
        let script = dir.join("bridge.mjs");
        let missing = checked_bridge_script(script.clone()).unwrap_err();
        assert!(missing.contains("bridge script"), "{missing}");

        fs::write(&script, "// test bridge").unwrap();
        assert_eq!(
            checked_bridge_script(script).unwrap(),
            dir.join("bridge.mjs")
        );
        let directory = checked_bridge_script(dir.clone()).unwrap_err();
        assert!(directory.contains("is not a file"), "{directory}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(windows)]
    fn windows_shutdown_kills_the_entire_process_tree() {
        let command = windows_taskkill_command(4242);
        assert_eq!(command.get_program(), "taskkill");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, ["/PID", "4242", "/T", "/F"]);
    }

    #[test]
    #[cfg(windows)]
    fn windows_shutdown_waits_for_the_direct_child() {
        let mut child = Command::new("cmd")
            .args(["/C", "ping 127.0.0.1 -n 30 > nul"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .unwrap();
        terminate_process_tree(&mut child);
        assert!(child.try_wait().unwrap().is_some());
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

    fn temp_node_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("petdeck-node-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn bundled_node_candidates_prefer_executable_then_resources() {
        let exe = Path::new("C:/App/target/debug/deps");
        let resources = Path::new("C:/App/resources");
        let name = node_binary_name();
        let list = bundled_node_candidates(Some(exe), Some(resources));
        assert_eq!(list[0], exe.join(name));
        assert_eq!(list[1], exe.parent().unwrap().join(name));
        assert_eq!(list[2], resources.join("nodejs").join(name));
        assert_eq!(list[3], resources.join(name));
    }

    #[test]
    fn bundled_node_candidates_dedupe_paths() {
        let dir = Path::new("C:/App");
        let list = bundled_node_candidates(Some(dir), Some(dir));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], dir.join(node_binary_name()));
        assert_eq!(list[1], dir.join("nodejs").join(node_binary_name()));
    }

    #[test]
    fn release_uses_bundled_node_before_anything_else() {
        let dir = temp_node_dir("bundled");
        let bundled = dir.join(node_binary_name());
        fs::write(&bundled, b"").unwrap();
        let runtime = select_node_runtime(false, Some(&dir), None, |path| {
            if path == bundled {
                Some("v24.18.0".to_string())
            } else {
                panic!("release must not probe PATH when a bundled runtime exists");
            }
        })
        .unwrap();
        assert_eq!(runtime.source, "bundled");
        assert_eq!(runtime.version, "v24.18.0");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn release_never_falls_back_to_path() {
        let dir = temp_node_dir("no-bundled");
        let mut calls = 0;
        let error = select_node_runtime(false, Some(&dir), None, |_| {
            calls += 1;
            Some("v24.18.0".to_string())
        })
        .unwrap_err();
        assert_eq!(calls, 0);
        assert!(error.contains("缺失"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn release_reports_a_broken_bundled_runtime() {
        let dir = temp_node_dir("broken");
        fs::write(dir.join(node_binary_name()), b"").unwrap();
        let error = select_node_runtime(false, Some(&dir), None, |_| None).unwrap_err();
        assert!(error.contains("无法启动"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn release_reports_an_outdated_bundled_runtime() {
        let dir = temp_node_dir("outdated");
        fs::write(dir.join(node_binary_name()), b"").unwrap();
        let error = select_node_runtime(false, Some(&dir), None, |_| Some("v18.20.0".to_string()))
            .unwrap_err();
        assert!(error.contains("版本过低"), "{error}");
        assert!(!error.contains("开发模式"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn debug_falls_back_to_the_system_node() {
        let dir = temp_node_dir("debug-path");
        let runtime = select_node_runtime(true, Some(&dir), None, |path| {
            if path == Path::new("node") {
                Some("v24.18.0".to_string())
            } else {
                None
            }
        })
        .unwrap();
        assert_eq!(runtime.source, "system");
        assert_eq!(runtime.command, PathBuf::from("node"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn debug_rejects_an_old_system_node() {
        let dir = temp_node_dir("debug-old");
        let error = select_node_runtime(true, Some(&dir), None, |path| {
            if path == Path::new("node") {
                Some("v20.11.0".to_string())
            } else {
                None
            }
        })
        .unwrap_err();
        assert!(error.contains("开发模式需要"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_node_is_found_in_the_resource_directory() {
        let exe_dir = temp_node_dir("empty-exe");
        let resources = temp_node_dir("resources");
        let bundled = resources.join("nodejs").join(node_binary_name());
        fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        fs::write(&bundled, b"").unwrap();
        let runtime = select_node_runtime(false, Some(&exe_dir), Some(&resources), |path| {
            if path == bundled {
                Some("v24.18.0".to_string())
            } else {
                None
            }
        })
        .unwrap();
        assert_eq!(runtime.command, bundled);
        assert_eq!(runtime.source, "bundled");
        let _ = fs::remove_dir_all(&exe_dir);
        let _ = fs::remove_dir_all(&resources);
    }
}
