//! Tables++ backend library entry. Builds the Tauri app, wires shared state, and registers
//! the command handlers.

mod commands;
mod config;
mod db;
mod error;
mod secrets;

use tauri::Manager;

use crate::config::ConfigStore;
use crate::db::pool::PoolRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Non-secret connection metadata lives under the app config dir (CLAUDE.md §4.1).
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let store = ConfigStore::load(config_dir.join("connections.json"));
            app.manage(store);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tables++ application");
}
