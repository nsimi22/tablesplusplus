//! OS keyring wrapper (CLAUDE.md §4.1).
//!
//! Secrets are stored under service `tablesplusplus`, account `connection:{id}:password`.
//! Config references the connection by `id` only; secrets never touch disk or logs.

use crate::error::AppError;

const SERVICE: &str = "tablesplusplus";

fn password_account(id: &str) -> String {
    format!("connection:{id}:password")
}

pub fn set_password(id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, &password_account(id))?;
    entry.set_password(secret)?;
    Ok(())
}

pub fn get_password(id: &str) -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(SERVICE, &password_account(id))?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_password(id: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, &password_account(id))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
