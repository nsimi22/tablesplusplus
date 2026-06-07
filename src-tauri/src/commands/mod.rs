//! `#[tauri::command]` handlers — thin: validate input, delegate to `db/`/`secrets/`/`config/`,
//! map errors (CLAUDE.md §5.1). No business logic or SQL lives here.

mod ai;
mod connections;
mod query;
mod saved_queries;
mod session;

pub use ai::*;
pub use connections::*;
pub use query::*;
pub use saved_queries::*;
pub use session::*;

use std::sync::Arc;

use crate::db::client::{ConnectionConfig, DbConnection, Engine};
use crate::db::mysql::MysqlClient;
use crate::db::postgres::PostgresClient;
use crate::error::AppError;

/// Build (and open) a `DbConnection` from config + resolved secrets. When an SSH config is
/// present, an SSH tunnel is opened first and the DB client connects through the tunnel's local
/// address; the tunnel is held alive by the returned `DbConnection`.
///
/// `secret` is the DB password; `ssh_secret` is the SSH password / key passphrase.
pub(crate) async fn build_connection(
    cfg: &ConnectionConfig,
    secret: Option<String>,
    ssh_secret: Option<String>,
) -> Result<DbConnection, AppError> {
    // Open the SSH tunnel (if configured) and redirect the DB client to its local address.
    let tunnel = match &cfg.ssh {
        Some(ssh) => Some(Arc::new(
            crate::ssh::open_tunnel(ssh, &cfg.host, cfg.port, ssh_secret).await?,
        )),
        None => None,
    };

    let mut target = cfg.clone();
    if let Some(tunnel) = &tunnel {
        let addr = tunnel.local_addr();
        target.host = addr.ip().to_string();
        target.port = addr.port();
    }

    match cfg.engine {
        Engine::Postgres => Ok(DbConnection::new_postgres(
            PostgresClient::connect(&target, secret).await?,
            tunnel,
        )),
        Engine::Mysql => Ok(DbConnection::new_mysql(
            MysqlClient::connect(&target, secret).await?,
            tunnel,
        )),
    }
}
