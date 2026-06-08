//! Open/close pooled connections (registry lifecycle).

use tauri::State;

use crate::commands::build_connection;
use crate::config::ConfigStore;
use crate::db::client::{CellValue, ConnectionConfig, Engine};
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
    let ssh_secret = if cfg.ssh.is_some() {
        secrets::get_ssh_secret(&id)?
    } else {
        None
    };
    let conn = build_connection(&cfg, secret, ssh_secret).await?;
    // Insert atomically; if a concurrent connect won the race, close our redundant pool.
    if let Some(extra) = registry.insert_if_absent(id, conn) {
        let _ = extra.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect(registry: State<'_, PoolRegistry>, id: String) -> Result<(), AppError> {
    if let Some(conn) = registry.remove(&id) {
        conn.close().await?;
    }
    Ok(())
}

/// List the databases visible on an open connection's server (for the database switcher).
/// Runs over the already-open pool, so it works for both persisted and session connections.
#[tauri::command]
pub async fn list_databases(
    registry: State<'_, PoolRegistry>,
    id: String,
) -> Result<Vec<String>, AppError> {
    let conn = registry.get(&id)?;
    let sql = match conn.engine() {
        // template0 disallows connections; skip templates. Keep `postgres` and user DBs.
        Engine::Postgres => {
            "SELECT datname FROM pg_database \
             WHERE datistemplate = false AND datallowconn ORDER BY datname"
        }
        Engine::Mysql => "SHOW DATABASES",
    };
    let result = conn.execute_query(sql.to_string(), Vec::new()).await?;
    let names = result
        .rows
        .into_iter()
        .filter_map(|row| match row.into_iter().next() {
            Some(CellValue::Text(s)) => Some(s),
            _ => None,
        })
        .collect();
    Ok(names)
}

/// Open another database on the same server as a **session connection**: it reuses the parent
/// (persisted) connection's host/credentials but targets `database`, registered in the pool
/// registry under a derived id. Nothing is persisted — the returned config lives only for the
/// session (the frontend tracks it). Re-opening the same database is idempotent.
#[tauri::command]
pub async fn open_database(
    store: State<'_, ConfigStore>,
    registry: State<'_, PoolRegistry>,
    root_id: String,
    database: String,
) -> Result<ConnectionConfig, AppError> {
    let parent = store
        .get(&root_id)
        .ok_or_else(|| AppError::not_found("Connection not found"))?;
    let derived_id = format!("{root_id}::db::{database}");
    let label_base = parent.label.clone().unwrap_or_else(|| parent.host.clone());
    let derived = ConnectionConfig {
        id: derived_id.clone(),
        database: database.clone(),
        label: Some(format!("{label_base} / {database}")),
        ..parent.clone()
    };
    if !registry.contains(&derived_id) {
        let secret = secrets::get_password(&root_id)?;
        let ssh_secret = if parent.ssh.is_some() {
            secrets::get_ssh_secret(&root_id)?
        } else {
            None
        };
        let conn = build_connection(&derived, secret, ssh_secret).await?;
        if let Some(extra) = registry.insert_if_absent(derived_id, conn) {
            let _ = extra.close().await;
        }
    }
    Ok(derived)
}
