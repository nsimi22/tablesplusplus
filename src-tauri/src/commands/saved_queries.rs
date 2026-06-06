use crate::error::AppError;
use crate::saved_queries::{self, SavedQuery};

/// List Saved Queries (query-mcp snippets). Read-only; an absent store yields an empty list.
#[tauri::command]
pub async fn list_saved_queries() -> Result<Vec<SavedQuery>, AppError> {
    // rusqlite is synchronous — keep the blocking read off the async runtime (CLAUDE.md §5.1).
    tokio::task::spawn_blocking(saved_queries::list)
        .await
        .map_err(|e| AppError::internal("Saved Queries task failed").with_detail(e.to_string()))?
}
