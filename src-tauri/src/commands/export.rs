//! File export (Module: data export). The frontend serializes a result set to CSV/JSON and
//! picks a destination via the native save dialog; this command writes the bytes to that path.
//! Writing happens in Rust (full filesystem access) so the user can save anywhere without the
//! fs-plugin scope dance — the path comes from the trusted native dialog.

use crate::error::AppError;

/// Write `contents` to `path` (the absolute path returned by the native save dialog).
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), AppError> {
    tokio::fs::write(&path, contents).await.map_err(|e| {
        AppError::internal("Failed to write the export file").with_detail(e.to_string())
    })
}
