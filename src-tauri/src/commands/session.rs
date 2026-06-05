//! Open/close pooled connections (registry lifecycle).

use tauri::State;

use crate::commands::build_connection;
use crate::config::ConfigStore;
use crate::db::pool::PoolRegistry;
use crate::error::AppError;
use crate::secrets;

#[tauri::command]
pub async fn connect(
    store: State<'_, ConfigStore>,
    registry: State<'_, PoolRegistry>,
    id: String,
) -> Result<(), AppError> {
    if registry.contains(&id) {
        return Ok(());
    }
    let cfg = store
        .get(&id)
        .ok_or_else(|| AppError::not_found("Connection not found"))?;
    let secret = secrets::get_password(&id)?;
    let conn = build_connection(&cfg, secret).await?;
    registry.insert(id, conn);
    Ok(())
}

#[tauri::command]
pub async fn disconnect(registry: State<'_, PoolRegistry>, id: String) -> Result<(), AppError> {
    if let Some(conn) = registry.remove(&id) {
        conn.close().await?;
    }
    Ok(())
}
