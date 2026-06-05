//! `#[tauri::command]` handlers — thin: validate input, delegate to `db/`/`secrets/`/`config/`,
//! map errors (CLAUDE.md §5.1). No business logic or SQL lives here.

mod connections;
mod query;
mod session;

pub use connections::*;
pub use query::*;
pub use session::*;

use crate::db::client::{ConnectionConfig, DbConnection, Engine};
use crate::db::mysql::MysqlClient;
use crate::db::postgres::PostgresClient;
use crate::error::AppError;

/// Build (and open) a `DbConnection` from config + resolved secret. SSH tunneling is not
/// implemented yet (docs/architecture.md §1); fail clearly rather than silently ignoring it.
pub(crate) async fn build_connection(
    cfg: &ConnectionConfig,
    secret: Option<String>,
) -> Result<DbConnection, AppError> {
    if cfg.ssh.is_some() {
        return Err(AppError::ssh("SSH tunneling is not implemented yet"));
    }
    match cfg.engine {
        Engine::Postgres => Ok(DbConnection::Postgres(
            PostgresClient::connect(cfg, secret).await?,
        )),
        Engine::Mysql => Ok(DbConnection::Mysql(
            MysqlClient::connect(cfg, secret).await?,
        )),
    }
}
