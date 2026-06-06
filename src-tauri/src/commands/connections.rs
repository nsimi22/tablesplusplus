//! Connection CRUD + Test Connection (Module A).

use tauri::State;

use crate::commands::build_connection;
use crate::config::ConfigStore;
use crate::db::client::{ConnectionConfig, ConnectionInput};
use crate::db::pool::PoolRegistry;
use crate::error::AppError;
use crate::secrets;

#[tauri::command]
pub async fn list_connections(
    store: State<'_, ConfigStore>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    Ok(store.list())
}

#[tauri::command]
pub async fn save_connection(
    store: State<'_, ConfigStore>,
    input: ConnectionInput,
) -> Result<ConnectionConfig, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let wrote_secret = write_secret_if_present(&id, input.password.as_deref())?;
    // If the SSH secret write fails, roll back the password we just wrote so we don't leave an
    // orphaned keyring entry for a connection that was never persisted.
    let wrote_ssh = match write_ssh_secret_if_present(&id, input.ssh_secret.as_deref()) {
        Ok(wrote) => wrote,
        Err(e) => {
            if wrote_secret {
                let _ = secrets::delete_password(&id);
            }
            return Err(e);
        }
    };
    let cfg = input.into_config(id.clone());
    if let Err(e) = store.upsert(cfg.clone()) {
        // Don't leave orphaned keyring entries for a connection that was never persisted.
        if wrote_secret {
            let _ = secrets::delete_password(&id);
        }
        if wrote_ssh {
            let _ = secrets::delete_ssh_secret(&id);
        }
        return Err(e);
    }
    Ok(cfg)
}

#[tauri::command]
pub async fn update_connection(
    store: State<'_, ConfigStore>,
    registry: State<'_, PoolRegistry>,
    id: String,
    input: ConnectionInput,
) -> Result<ConnectionConfig, AppError> {
    if store.get(&id).is_none() {
        return Err(AppError::not_found("Connection not found"));
    }
    // A null/empty secret leaves the stored value untouched.
    write_secret_if_present(&id, input.password.as_deref())?;
    write_ssh_secret_if_present(&id, input.ssh_secret.as_deref())?;
    let cfg = input.into_config(id.clone());
    store.upsert(cfg.clone())?;
    // The persisted config changed; evict any open pool so the next connect rebuilds it against
    // the new host/port/credentials rather than silently querying the old target.
    if let Some(conn) = registry.remove(&id) {
        let _ = conn.close().await;
    }
    Ok(cfg)
}

#[tauri::command]
pub async fn delete_connection(
    store: State<'_, ConfigStore>,
    registry: State<'_, PoolRegistry>,
    id: String,
) -> Result<(), AppError> {
    if let Some(conn) = registry.remove(&id) {
        let _ = conn.close().await;
    }
    // Deleting the connection must also delete its keyring entries (CLAUDE.md §4.1).
    secrets::delete_password(&id)?;
    secrets::delete_ssh_secret(&id)?;
    store.remove(&id)?;
    Ok(())
}

/// Validate credentials with a trivial round-trip. With `input`, the not-yet-saved form
/// values (and typed password) are tested; otherwise the stored `id` is tested against its
/// keyring secret.
#[tauri::command]
pub async fn test_connection(
    store: State<'_, ConfigStore>,
    id: Option<String>,
    input: Option<ConnectionInput>,
) -> Result<(), AppError> {
    let (cfg, secret, ssh_secret) = match (id, input) {
        (_, Some(inp)) => {
            let secret = inp.password.clone().filter(|p| !p.is_empty());
            let ssh_secret = inp.ssh_secret.clone().filter(|p| !p.is_empty());
            (inp.into_config("__test__".to_string()), secret, ssh_secret)
        }
        (Some(id), None) => {
            let cfg = store
                .get(&id)
                .ok_or_else(|| AppError::not_found("Connection not found"))?;
            let ssh_secret = if cfg.ssh.is_some() {
                secrets::get_ssh_secret(&id)?
            } else {
                None
            };
            (cfg, secrets::get_password(&id)?, ssh_secret)
        }
        (None, None) => {
            return Err(AppError::internal(
                "test_connection requires an id or input",
            ));
        }
    };

    let conn = build_connection(&cfg, secret, ssh_secret).await?;
    let result = conn.ping().await;
    let _ = conn.close().await;
    result
}

/// Returns `true` if a secret was actually written to the keyring.
fn write_secret_if_present(id: &str, password: Option<&str>) -> Result<bool, AppError> {
    if let Some(pw) = password {
        if !pw.is_empty() {
            secrets::set_password(id, pw)?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Returns `true` if an SSH secret was actually written to the keyring.
fn write_ssh_secret_if_present(id: &str, ssh_secret: Option<&str>) -> Result<bool, AppError> {
    if let Some(s) = ssh_secret {
        if !s.is_empty() {
            secrets::set_ssh_secret(id, s)?;
            return Ok(true);
        }
    }
    Ok(false)
}
