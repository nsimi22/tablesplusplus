//! AI assistant commands: settings (provider/model/key) + a generic completion used by the
//! frontend's Text-to-SQL, Explain, and Fix tools.

use serde::Serialize;
use tauri::State;

use crate::ai::{self, AiProvider};
use crate::config::ai_settings::AiSettingsStore;
use crate::error::{AppError, ErrorKind};
use crate::secrets;

/// AI settings surfaced to the frontend — the key is never returned, only whether one exists.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub provider: AiProvider,
    pub model: String,
    pub has_key: bool,
}

fn view(provider: AiProvider, model: String) -> Result<AiSettingsView, AppError> {
    let has_key = secrets::get_ai_key(provider.keyring_id())?.is_some();
    Ok(AiSettingsView {
        provider,
        model,
        has_key,
    })
}

#[tauri::command]
pub async fn get_ai_settings(
    store: State<'_, AiSettingsStore>,
) -> Result<AiSettingsView, AppError> {
    let s = store.get();
    view(s.provider, s.model)
}

#[tauri::command]
pub async fn save_ai_settings(
    store: State<'_, AiSettingsStore>,
    provider: AiProvider,
    model: String,
    api_key: Option<String>,
) -> Result<AiSettingsView, AppError> {
    let model = if model.trim().is_empty() {
        provider.default_model().to_string()
    } else {
        model
    };
    // Persist the non-secret settings first; if the keyring write then fails, the UI reports the
    // new provider with no key (clear, recoverable) rather than a key/settings mismatch on disk.
    store.save(ai::AiSettings {
        provider,
        model: model.clone(),
    })?;
    // The key crosses the bridge inbound only and goes straight to the keyring.
    if let Some(key) = api_key {
        let key = key.trim();
        if !key.is_empty() {
            secrets::set_ai_key(provider.keyring_id(), key)?;
        }
    }
    view(provider, model)
}

#[tauri::command]
pub async fn ai_generate(
    store: State<'_, AiSettingsStore>,
    system: String,
    prompt: String,
) -> Result<String, AppError> {
    // Bound inputs crossing the IPC bridge (CLAUDE.md §7) — guards against an oversized prompt.
    const MAX_PROMPT_CHARS: usize = 200_000;
    if system.len() + prompt.len() > MAX_PROMPT_CHARS {
        return Err(AppError::new(
            ErrorKind::Internal,
            "The AI request is too large; reduce the schema or prompt size",
        ));
    }
    let s = store.get();
    let key = secrets::get_ai_key(s.provider.keyring_id())?.ok_or_else(|| {
        AppError::new(
            ErrorKind::Auth,
            "No API key is set for the selected AI provider",
        )
    })?;
    ai::complete(s.provider, &s.model, &key, &system, &prompt).await
}
