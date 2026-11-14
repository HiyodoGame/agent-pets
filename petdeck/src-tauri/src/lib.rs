mod bridge;

use bridge::{BridgeConfig, BridgeState};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_window_state::StateFlags;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelTarget {
    project_id: Option<String>,
    session_id: Option<String>,
}

struct DndState(Mutex<bool>);
struct DndMenuItem(CheckMenuItem<Wry>);
struct AutostartMenuItem(CheckMenuItem<Wry>);
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
    let state = app.state::<DndState>();
    *state.0.lock().unwrap_or_else(|error| error.into_inner()) = enabled;
    let _ = app.state::<DndMenuItem>().0.set_checked(enabled);
    let _ = app.emit("petdeck:dnd-changed", enabled);
}

#[tauri::command]
fn set_dnd(app: AppHandle, enabled: bool) {
    update_dnd(&app, enabled);
}

#[tauri::command]
fn open_panel(app: AppHandle, target: PanelTarget) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    app.emit("petdeck:navigate", target)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_bridge_config(app: AppHandle) -> BridgeConfig {
    bridge_config(&app)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
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
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .setup(|app| {
            app.manage(DndState(Mutex::new(false)));

            let show_pet = MenuItemBuilder::with_id("show-pet", "显示宠物").build(app)?;
            let open_panel_item = MenuItemBuilder::with_id("open-panel", "打开面板").build(app)?;
            let dnd_item = CheckMenuItemBuilder::with_id("dnd", "免打扰")
                .checked(false)
                .build(app)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItemBuilder::with_id("autostart", "开机启动")
                .checked(autostart_enabled)
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_pet)
                .item(&open_panel_item)
                .item(&dnd_item)
                .item(&autostart_item)
                .item(&quit)
                .build()?;
            app.manage(DndMenuItem(dnd_item));
            app.manage(AutostartMenuItem(autostart_item));
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_panel,
            get_bridge_config,
            set_dnd,
            quit_app
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
