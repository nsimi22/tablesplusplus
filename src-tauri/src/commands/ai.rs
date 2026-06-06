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
    // The key crosses the bridge inbound only and goes straight to the keyring.
    if let Some(key) = api_key {
        if !key.is_empty() {
            secrets::set_ai_key(provider.keyring_id(), &key)?;
        }
    }
    let model = if model.trim().is_empty() {
        provider.default_model().to_string()
    } else {
        model
    };
    store.save(ai::AiSettings {
        provider,
        model: model.clone(),
    })?;
    view(provider, model)
}

#[tauri::command]
pub async fn ai_generate(
    store: State<'_, AiSettingsStore>,
    system: String,
    prompt: String,
) -> Result<String, AppError> {
    let s = store.get();
    let key = secrets::get_ai_key(s.provider.keyring_id())?.ok_or_else(|| {
        AppError::new(
            ErrorKind::Auth,
            "No API key is set for the selected AI provider",
        )
    })?;
    ai::complete(s.provider, &s.model, &key, &system, &prompt).await
}
