//! Saved Queries — a read-only view over query-mcp's snippet store.
//!
//! query-mcp (completesolar/query-mcp) persists SQL snippets saved during Claude sessions to
//! `~/.query-mcp/store.db` (SQLite, table `snippets`). Surfacing them here lets a query Claude
//! wrote be reused from the SQL console. We never write to the store — query-mcp owns it.
//! A missing file or missing table means "no saved queries", never an error.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub name: String,
    pub sql: String,
    pub description: Option<String>,
    pub updated_at: String,
}

fn store_path() -> Option<PathBuf> {
    // dirs-style home resolution without a new dependency; covers macOS/Linux + Windows.
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".query-mcp").join("store.db"))
}

pub fn list() -> Result<Vec<SavedQuery>, AppError> {
    let Some(path) = store_path() else {
        return Ok(Vec::new());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let table_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'snippets')",
        [],
        |row| row.get(0),
    )?;
    if !table_exists {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(
        "SELECT name, sql, description, updated_at FROM snippets ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SavedQuery {
            name: row.get(0)?,
            sql: row.get(1)?,
            description: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
