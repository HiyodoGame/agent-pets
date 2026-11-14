mod bridge;

use bridge::{BridgeConfig, BridgeState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelTarget {
    project_id: Option<String>,
    session_id: Option<String>,
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
    app.state::<BridgeState>().config.clone()
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
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .setup(|app| {
            let state = bridge::start_bridge(&app.handle());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_panel, get_bridge_config, quit_app])
        .build(tauri::generate_context!())
        .expect("error while building PetDeck");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            app.state::<BridgeState>().shutdown();
        }
    });
}
