mod bridge;

use bridge::{BridgeConfig, BridgeState};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, WindowEvent, Wry,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::StateFlags;

#[derive(Clone, Copy, PartialEq)]
enum UiLocale {
    Zh,
    En,
}

impl UiLocale {
    fn parse(value: &str) -> Self {
        if value == "en" {
            Self::En
        } else {
            Self::Zh
        }
    }
    fn code(self) -> &'static str {
        match self {
            Self::Zh => "zh",
            Self::En => "en",
        }
    }
}

fn tr(locale: UiLocale, key: &str) -> &'static str {
    match (locale, key) {
        (UiLocale::En, "show_pet") => "Show pet",
        (UiLocale::En, "open_panel") => "Open panel",
        (UiLocale::En, "dnd") => "Do not disturb",
        (UiLocale::En, "autostart") => "Start with Windows",
        (UiLocale::En, "quit") => "Quit",
        (UiLocale::En, "service_running") => "Local service: running",
        (UiLocale::En, "service_failed") => "Local service: failed",
        (UiLocale::En, "service_stopped") => "Local service: stopped",
        (UiLocale::En, "restart_service") => "Restart local service",
        (_, "show_pet") => "显示宠物",
        (_, "open_panel") => "打开面板",
        (_, "dnd") => "免打扰",
        (_, "autostart") => "开机启动",
        (_, "quit") => "退出",
        (_, "service_running") => "本地服务：运行中",
        (_, "service_failed") => "本地服务：启动失败",
        (_, "service_stopped") => "本地服务：未启动",
        (_, "restart_service") => "重启本地服务",
        _ => "",
    }
}

fn current_locale(app: &AppHandle) -> UiLocale {
    app.try_state::<LocaleState>()
        .map(|state| *state.0.lock().unwrap_or_else(|error| error.into_inner()))
        .unwrap_or_else(|| load_locale(app))
}

/// Tray line for the local bridge: "本地服务：运行中 · :5199" (or the failure text).
fn service_label(app: &AppHandle, locale: UiLocale) -> String {
    match app.try_state::<BridgeState>() {
        Some(state) if state.failed() => tr(locale, "service_failed").to_string(),
        Some(state) => format!("{} · :{}", tr(locale, "service_running"), state.port()),
        None => tr(locale, "service_stopped").to_string(),
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelTarget {
    project_id: Option<String>,
    session_id: Option<String>,
    task_id: Option<String>,
}

struct DndState(Mutex<bool>);
struct DndMenuItem(CheckMenuItem<Wry>);
struct AutostartMenuItem(CheckMenuItem<Wry>);
struct LocaleState(Mutex<UiLocale>);
struct TrayLabels {
    show_pet: MenuItem<Wry>,
    open_panel: MenuItem<Wry>,
    service_status: MenuItem<Wry>,
    restart_service: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}
static BRIDGE_INIT: Mutex<()> = Mutex::new(());

fn bridge_config(app: &AppHandle) -> BridgeConfig {
    let _guard = BRIDGE_INIT
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(state) = app.try_state::<BridgeState>() {
        if state.needs_restart() {
            state.restart(app);
        }
        return state.config();
    }
    let state = bridge::start_bridge(app);
    let config = state.config();
    app.manage(state);
    config
}

fn update_dnd(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<DndState>() {
        *state.0.lock().unwrap_or_else(|error| error.into_inner()) = enabled;
    }
    if let Some(item) = app.try_state::<DndMenuItem>() {
        let _ = item.0.set_checked(enabled);
    }
    let _ = app.emit("petdeck:dnd-changed", enabled);
    save_dnd(app, enabled); // DND 持久化（P2-11）：尽力写盘，失败不阻断 UI 状态
}

/// DND 持久化文件（app 配置目录/dnd.json）。内容就是字面 true/false，
/// 避免为此引入 serde_json 解析；读不出合法值一律视为未持久化。
fn dnd_config_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("dnd.json"))
}

fn load_dnd(app: &AppHandle) -> Option<bool> {
    let file = dnd_config_file(app)?;
    std::fs::read_to_string(file)
        .ok()?
        .trim()
        .parse::<bool>()
        .ok()
}

fn save_dnd(app: &AppHandle, enabled: bool) {
    if let Some(file) = dnd_config_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, if enabled { "true" } else { "false" });
    }
}

fn locale_config_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("locale.json"))
}

fn load_locale(app: &AppHandle) -> UiLocale {
    locale_config_file(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|value| UiLocale::parse(value.trim()))
        .unwrap_or(UiLocale::Zh)
}

fn save_locale(app: &AppHandle, locale: UiLocale) {
    if let Some(file) = locale_config_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, locale.code());
    }
}

/// Frontend language switch: persist, re-label the native tray, and notify every
/// window so the pet and the main panel stay in sync.
#[tauri::command]
fn set_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let next = UiLocale::parse(&locale);
    let Some(state) = app.try_state::<LocaleState>() else {
        // The tray already loaded the persisted locale during setup. A frontend
        // command arriving before setup has nothing new to synchronize.
        return Ok(());
    };
    let mut current = state.0.lock().unwrap_or_else(|error| error.into_inner());
    if *current == next {
        return Ok(());
    }
    *current = next;
    save_locale(&app, next);
    let app_for_update = app.clone();
    app.run_on_main_thread(move || {
        let app = &app_for_update;
        if let Some(labels) = app.try_state::<TrayLabels>() {
            let _ = labels.show_pet.set_text(tr(next, "show_pet"));
            let _ = labels.open_panel.set_text(tr(next, "open_panel"));
            let _ = labels.restart_service.set_text(tr(next, "restart_service"));
            let _ = labels.service_status.set_text(service_label(app, next));
            let _ = labels.quit.set_text(tr(next, "quit"));
        }
        if let Some(item) = app.try_state::<DndMenuItem>() {
            let _ = item.0.set_text(tr(next, "dnd"));
        }
        if let Some(item) = app.try_state::<AutostartMenuItem>() {
            let _ = item.0.set_text(tr(next, "autostart"));
        }
        let _ = app.emit("petdeck:locale-changed", next.code());
    })
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_dnd(app: AppHandle, enabled: bool) {
    update_dnd(&app, enabled);
}

/// 前端挂载时主动拉取当前 DND（持久化值 + 托盘勾选态的单一事实来源）。
/// 启动时 emit 的事件可能早于前端监听器就绪，所以读值必须走命令而非事件。
#[tauri::command]
fn get_dnd(app: AppHandle) -> bool {
    match app.try_state::<DndState>() {
        Some(state) => *state.0.lock().unwrap_or_else(|error| error.into_inner()),
        None => load_dnd(&app).unwrap_or(false),
    }
}

#[derive(Clone, Copy)]
struct WindowRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

fn clamp_position(value: i32, min: i32, max: i32) -> i32 {
    value.clamp(min, max.max(min))
}

fn intersection_area(a: WindowRect, b: WindowRect) -> i64 {
    let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    i64::from(width.max(0)) * i64::from(height.max(0))
}

fn main_panel_position(
    pet: WindowRect,
    panel: WindowRect,
    work: WindowRect,
    gap: i32,
) -> PhysicalPosition<i32> {
    let center_x = pet.x + pet.width / 2 - panel.width / 2;
    let center_y = pet.y + pet.height / 2 - panel.height / 2;
    let candidates = [
        PhysicalPosition::new(pet.x + pet.width + gap, center_y),
        PhysicalPosition::new(pet.x - panel.width - gap, center_y),
        PhysicalPosition::new(center_x, pet.y - panel.height - gap),
        PhysicalPosition::new(center_x, pet.y + pet.height + gap),
    ];
    candidates
        .into_iter()
        .map(|candidate| {
            let positioned = PhysicalPosition::new(
                clamp_position(candidate.x, work.x, work.x + work.width - panel.width),
                clamp_position(candidate.y, work.y, work.y + work.height - panel.height),
            );
            let placed = WindowRect {
                x: positioned.x,
                y: positioned.y,
                ..panel
            };
            let overlap = intersection_area(pet, placed);
            let distance =
                i64::from((positioned.x - candidate.x).abs() + (positioned.y - candidate.y).abs());
            (positioned, overlap, distance)
        })
        .min_by_key(|(_, overlap, distance)| (*overlap, *distance))
        .map(|(position, _, _)| position)
        .unwrap_or(PhysicalPosition::new(work.x, work.y))
}

#[tauri::command]
fn set_pet_layout(app: AppHandle, width: u32, height: u32, x: i32, y: i32) -> Result<(), String> {
    let pet = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is unavailable".to_string())?;
    pet.set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    pet.set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_panel(app: AppHandle, target: PanelTarget) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    if let Some(pet) = app.get_webview_window("pet") {
        let pet_position = pet.outer_position().map_err(|error| error.to_string())?;
        let pet_size = pet.outer_size().map_err(|error| error.to_string())?;
        let panel_size = main.outer_size().map_err(|error| error.to_string())?;
        if let Some(monitor) = pet.current_monitor().map_err(|error| error.to_string())? {
            let area = monitor.work_area();
            let position = main_panel_position(
                WindowRect {
                    x: pet_position.x,
                    y: pet_position.y,
                    width: pet_size.width as i32,
                    height: pet_size.height as i32,
                },
                WindowRect {
                    x: 0,
                    y: 0,
                    width: panel_size.width as i32,
                    height: panel_size.height as i32,
                },
                WindowRect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width as i32,
                    height: area.size.height as i32,
                },
                (16.0 * monitor.scale_factor()).round() as i32,
            );
            main.set_position(position)
                .map_err(|error| error.to_string())?;
        }
    }
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    app.emit("petdeck:navigate", target)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_bridge_config(app: AppHandle) -> BridgeConfig {
    bridge_config(&app)
}

/// Restart the local Node bridge and return the fresh loopback config. The port and
/// token change, so the frontend reconfigures before refreshing any state.
#[tauri::command]
fn restart_bridge(app: AppHandle) -> BridgeConfig {
    let config = match app.try_state::<BridgeState>() {
        Some(state) => {
            state.restart(&app);
            state.config()
        }
        None => bridge_config(&app),
    };
    if let Some(labels) = app.try_state::<TrayLabels>() {
        let _ = labels
            .service_status
            .set_text(service_label(&app, current_locale(&app)));
    }
    config
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Open the folder that ships the bundled Node.js license texts. In development
/// the resource bundle does not exist yet, so fall back to the source tree.
#[tauri::command]
fn open_node_licenses(app: AppHandle) -> Result<String, String> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("third-party").join("nodejs"));
    let fallback = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("third-party")
        .join("nodejs");
    let dir = bundled.filter(|path| path.is_dir()).unwrap_or(fallback);
    if !dir.is_dir() {
        return Err("未找到 Node.js 许可文件目录，请重新安装 PetDeck。".to_string());
    }
    let display = dir.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&dir)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(display)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// Check GitHub Releases for a newer signed build. Returns version/notes only; the
/// actual download happens only after the user explicitly confirms install_update.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let update = app
        .updater()
        .map_err(|error| {
            bridge::sidecar_note(
                "error",
                "update.check_failed",
                serde_json::json!({ "reason": error.to_string() }),
            );
            error.to_string()
        })?
        .check()
        .await
        .map_err(|error| {
            bridge::sidecar_note(
                "error",
                "update.check_failed",
                serde_json::json!({ "reason": error.to_string() }),
            );
            error.to_string()
        })?;
    Ok(match update {
        Some(update) => UpdateInfo {
            available: true,
            version: Some(update.version),
            body: update.body,
        },
        None => UpdateInfo {
            available: false,
            version: None,
            body: None,
        },
    })
}

/// Download and install the pending update. On Windows the updater exits the app
/// after launching the NSIS installer, so no explicit restart is needed here.
/// Emits `update-progress` ({ downloaded, total }) so the settings page can show a bar.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| {
            bridge::sidecar_note(
                "error",
                "update.check_failed",
                serde_json::json!({ "reason": error.to_string() }),
            );
            error.to_string()
        })?
        .check()
        .await
        .map_err(|error| {
            bridge::sidecar_note(
                "error",
                "update.check_failed",
                serde_json::json!({ "reason": error.to_string() }),
            );
            error.to_string()
        })?;
    let Some(update) = update else {
        return Err("no update available".to_string());
    };
    let version = update.version.clone();
    bridge::sidecar_note(
        "info",
        "update.download_start",
        serde_json::json!({ "version": version }),
    );
    let handle = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_percent: i64 = -1;
    let result = update
        .download_and_install(
            move |chunk: usize, total: Option<u64>| {
                downloaded += chunk as u64;
                let percent = total
                    .filter(|value| *value > 0)
                    .map(|value| (downloaded.min(value) * 100 / value) as i64)
                    .unwrap_or(-1);
                if percent != last_percent {
                    last_percent = percent;
                    let _ = handle.emit("update-progress", UpdateProgress { downloaded, total });
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(()) => {
            bridge::sidecar_note(
                "info",
                "update.install_ok",
                serde_json::json!({ "version": version }),
            );
            let _ = app.emit("update-installed", ());
            Ok(())
        }
        Err(error) => {
            bridge::sidecar_note(
                "error",
                "update.install_failed",
                serde_json::json!({ "version": version, "reason": error.to_string() }),
            );
            Err(error.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(pet) = app.get_webview_window("pet") {
                let _ = pet.show();
                let _ = pet.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .setup(|app| {
            // DND 持久化（P2-11）：启动即读上次状态，托盘勾选态与 DndState 同步初始化
            let dnd_saved = load_dnd(app.handle()).unwrap_or(false);
            app.manage(DndState(Mutex::new(dnd_saved)));
            let locale = load_locale(app.handle());
            app.manage(LocaleState(Mutex::new(locale)));

            // Start the bridge during setup so the tray can report a real port and the
            // "restart local service" item is available before the panel finishes booting.
            let _ = bridge_config(app.handle());

            let show_pet =
                MenuItemBuilder::with_id("show-pet", tr(locale, "show_pet")).build(app)?;
            let open_panel_item =
                MenuItemBuilder::with_id("open-panel", tr(locale, "open_panel")).build(app)?;
            let dnd_item = CheckMenuItemBuilder::with_id("dnd", tr(locale, "dnd"))
                .checked(dnd_saved)
                .build(app)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item =
                CheckMenuItemBuilder::with_id("autostart", tr(locale, "autostart"))
                    .checked(autostart_enabled)
                    .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", tr(locale, "quit")).build(app)?;
            let service_status =
                MenuItemBuilder::with_id("service-status", service_label(app.handle(), locale))
                    .enabled(false)
                    .build(app)?;
            let restart_service =
                MenuItemBuilder::with_id("restart-service", tr(locale, "restart_service"))
                    .build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_pet)
                .item(&open_panel_item)
                .item(&service_status)
                .item(&restart_service)
                .item(&dnd_item)
                .item(&autostart_item)
                .item(&quit)
                .build()?;
            app.manage(DndMenuItem(dnd_item));
            app.manage(AutostartMenuItem(autostart_item));
            app.manage(TrayLabels {
                show_pet,
                open_panel: open_panel_item,
                service_status,
                restart_service,
                quit,
            });
            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("PetDeck")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show-pet" => {
                        if let Some(pet) = app.get_webview_window("pet") {
                            let _ = pet.show();
                            let _ = pet.set_focus();
                        }
                    }
                    "open-panel" => {
                        let _ = open_panel(app.clone(), PanelTarget::default());
                    }
                    "dnd" => {
                        let current = *app
                            .state::<DndState>()
                            .0
                            .lock()
                            .unwrap_or_else(|error| error.into_inner());
                        update_dnd(app, !current);
                    }
                    "autostart" => {
                        let launcher = app.autolaunch();
                        let enabled = launcher.is_enabled().unwrap_or(false);
                        let result = if enabled {
                            launcher.disable()
                        } else {
                            launcher.enable()
                        };
                        if result.is_ok() {
                            let _ = app.state::<AutostartMenuItem>().0.set_checked(!enabled);
                        }
                    }
                    "restart-service" => {
                        if let Some(state) = app.try_state::<BridgeState>() {
                            state.restart(app);
                        }
                        if let Some(labels) = app.try_state::<TrayLabels>() {
                            let _ = labels
                                .service_status
                                .set_text(service_label(app, current_locale(app)));
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_panel,
            set_pet_layout,
            get_bridge_config,
            restart_bridge,
            open_node_licenses,
            set_dnd,
            get_dnd,
            set_locale,
            quit_app,
            check_update,
            install_update
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building PetDeck");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(state) = app.try_state::<BridgeState>() {
                state.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_panel_avoids_pet_at_the_right_edge() {
        let pet = WindowRect {
            x: 1740,
            y: 900,
            width: 180,
            height: 180,
        };
        let panel = WindowRect {
            x: 0,
            y: 0,
            width: 1100,
            height: 760,
        };
        let work = WindowRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let position = main_panel_position(pet, panel, work, 16);
        let placed = WindowRect {
            x: position.x,
            y: position.y,
            ..panel
        };
        assert_eq!(intersection_area(pet, placed), 0);
        assert_eq!(position, PhysicalPosition::new(624, 320));
    }

    #[test]
    fn main_panel_supports_negative_monitor_coordinates() {
        let pet = WindowRect {
            x: -200,
            y: 700,
            width: 180,
            height: 180,
        };
        let panel = WindowRect {
            x: 0,
            y: 0,
            width: 720,
            height: 540,
        };
        let work = WindowRect {
            x: -1280,
            y: 0,
            width: 1280,
            height: 1024,
        };
        let position = main_panel_position(pet, panel, work, 16);
        let placed = WindowRect {
            x: position.x,
            y: position.y,
            ..panel
        };
        assert_eq!(intersection_area(pet, placed), 0);
        assert!(position.x >= work.x && position.y >= work.y);
    }

    #[test]
    fn main_panel_uses_the_smallest_overlap_when_space_is_insufficient() {
        let pet = WindowRect {
            x: 20,
            y: 20,
            width: 180,
            height: 180,
        };
        let panel = WindowRect {
            x: 0,
            y: 0,
            width: 300,
            height: 300,
        };
        let work = WindowRect {
            x: 0,
            y: 0,
            width: 320,
            height: 320,
        };
        let position = main_panel_position(pet, panel, work, 16);
        let placed = WindowRect {
            x: position.x,
            y: position.y,
            ..panel
        };
        assert_eq!(intersection_area(pet, placed), 32_400);
    }
}
