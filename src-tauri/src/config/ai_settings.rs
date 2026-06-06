//! Persisted, non-secret AI settings (provider + model). The API key lives only in the OS
//! keyring; this store keeps `ai.json` in the app config dir. Managed as `State<AiSettingsStore>`.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use crate::ai::AiSettings;
use crate::error::AppError;

pub struct AiSettingsStore {
    path: PathBuf,
    settings: Mutex<AiSettings>,
}

impl AiSettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let settings = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<AiSettings>(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    fn lock(&self) -> MutexGuard<'_, AiSettings> {
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn get(&self) -> AiSettings {
        self.lock().clone()
    }

    pub fn save(&self, settings: AiSettings) -> Result<(), AppError> {
        *self.lock() = settings;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_vec_pretty(&*self.lock())?;
        std::fs::write(&self.path, data)?;
        Ok(())
    }
}
