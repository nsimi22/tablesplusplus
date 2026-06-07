//! Tables++ backend library entry. Builds the Tauri app, wires shared state, and registers
//! the command handlers.

mod ai;
mod commands;
mod config;
mod db;
mod error;
mod secrets;
mod ssh;

use tauri::Manager;

use crate::config::ai_settings::AiSettingsStore;
use crate::config::ConfigStore;
use crate::db::pool::PoolRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Native save dialog + clipboard for data export (CLAUDE.md §11).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    // Auto-update + relaunch are desktop-only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .setup(|app| {
            // Non-secret connection metadata lives under the app config dir (CLAUDE.md §4.1).
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let store = ConfigStore::load(config_dir.join("connections.json"));
            app.manage(store);
            app.manage(AiSettingsStore::load(config_dir.join("ai.json")));
            app.manage(PoolRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_connections,
            commands::save_connection,
            commands::update_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::get_schema,
            commands::execute_query,
            commands::execute_query_stream,
            commands::write_text_file,
            commands::get_ai_settings,
            commands::save_ai_settings,
            commands::ai_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tables++ application");
}
