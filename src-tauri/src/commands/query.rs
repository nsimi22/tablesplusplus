//! Schema introspection + query execution (Modules B/C/D).

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;

use crate::db::client::{CellValue, QueryResult, Schema, StreamChunk};
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

/// Stream a query's results to the frontend in batches over a Tauri channel: `columns`, then
/// `rows` chunks, then a final `done`. Used by the SQL console so a large result renders
/// progressively with bounded per-message size.
#[tauri::command]
pub async fn execute_query_stream(
    registry: State<'_, PoolRegistry>,
    id: String,
    sql: String,
    params: Vec<CellValue>,
    on_event: Channel<StreamChunk>,
) -> Result<(), AppError> {
    let conn = registry.get(&id)?;
    // Bounded channel → natural backpressure if the UI consumes slower than the DB produces.
    let (tx, mut rx) = mpsc::channel::<StreamChunk>(8);
    let producer = tokio::spawn(async move { conn.stream_query(sql, params, tx).await });

    // Abort the running query if this command returns early or is cancelled/dropped by Tauri
    // (e.g. the user closes the tab), so an expensive query doesn't keep running on the server.
    struct AbortOnDrop(Option<tokio::task::JoinHandle<Result<(), AppError>>>);
    impl Drop for AbortOnDrop {
        fn drop(&mut self) {
            if let Some(handle) = self.0.as_ref() {
                handle.abort();
            }
        }
    }
    let mut guard = AbortOnDrop(Some(producer));

    while let Some(chunk) = rx.recv().await {
        on_event.send(chunk).map_err(|e| {
            AppError::internal("Failed to stream results to the UI").with_detail(e.to_string())
        })?;
    }

    // Stream finished cleanly; take the handle out (so the guard won't abort) and surface any
    // error the producer hit after the partial chunks were delivered.
    match guard.0.take() {
        Some(producer) => producer
            .await
            .map_err(|e| AppError::internal("Streaming task failed").with_detail(e.to_string()))?,
        None => Ok(()),
    }
}
