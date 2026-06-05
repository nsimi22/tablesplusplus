//! Local, non-secret connection metadata store (CLAUDE.md §4.1).
//!
//! Persisted as `connections.json` in the app config dir. Secrets are NOT stored here —
//! only in the OS keyring. Managed as Tauri `State<ConfigStore>`.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use crate::db::client::ConnectionConfig;
use crate::error::AppError;

pub struct ConfigStore {
    path: PathBuf,
    conns: Mutex<Vec<ConnectionConfig>>,
}

impl ConfigStore {
    /// Load from disk, tolerating a missing or malformed file (starts empty).
    pub fn load(path: PathBuf) -> Self {
        let conns = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<ConnectionConfig>>(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            conns: Mutex::new(conns),
        }
    }

    /// Recover gracefully from a poisoned lock rather than panicking (CLAUDE.md §5.1).
    fn lock(&self) -> MutexGuard<'_, Vec<ConnectionConfig>> {
        self.conns
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn list(&self) -> Vec<ConnectionConfig> {
        self.lock().clone()
    }

    pub fn get(&self, id: &str) -> Option<ConnectionConfig> {
        self.lock().iter().find(|c| c.id == id).cloned()
    }

    pub fn upsert(&self, cfg: ConnectionConfig) -> Result<(), AppError> {
        {
            let mut guard = self.lock();
            if let Some(slot) = guard.iter_mut().find(|c| c.id == cfg.id) {
                *slot = cfg;
            } else {
                guard.push(cfg);
            }
        }
        self.persist()
    }

    pub fn remove(&self, id: &str) -> Result<bool, AppError> {
        let removed;
        {
            let mut guard = self.lock();
            let before = guard.len();
            guard.retain(|c| c.id != id);
            removed = guard.len() != before;
        }
        self.persist()?;
        Ok(removed)
    }

    fn persist(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_vec_pretty(&*self.lock())?;
        std::fs::write(&self.path, data)?;
        Ok(())
    }
}
