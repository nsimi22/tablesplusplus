//! Schema introspection + query execution (Modules B/C/D).

use tauri::State;

use crate::db::client::{CellValue, QueryResult, Schema};
use crate::db::pool::PoolRegistry;
use crate::error::AppError;

#[tauri::command]
pub async fn get_schema(registry: State<'_, PoolRegistry>, id: String) -> Result<Schema, AppError> {
    // Clone the connection out of the registry, then await (no lock held across await).
    let conn = registry.get(&id)?;
    conn.get_schema().await
}

#[tauri::command]
pub async fn execute_query(
    registry: State<'_, PoolRegistry>,
    id: String,
    sql: String,
    params: Vec<CellValue>,
) -> Result<QueryResult, AppError> {
    let conn = registry.get(&id)?;
    conn.execute_query(sql, params).await
}
