use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![open_panel])
        .run(tauri::generate_context!())
        .expect("error while running PetDeck");
}
