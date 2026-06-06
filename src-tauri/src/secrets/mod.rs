//! OS keyring wrapper (CLAUDE.md §4.1).
//!
//! Secrets are stored under service `tablesplusplus`, account `connection:{id}:password`.
//! Config references the connection by `id` only; secrets never touch disk or logs.

use crate::error::AppError;

const SERVICE: &str = "tablesplusplus";

fn password_account(id: &str) -> String {
    format!("connection:{id}:password")
}

fn ssh_account(id: &str) -> String {
    format!("connection:{id}:ssh")
}

/// SSH secret = the SSH password (password auth) or the key passphrase (key auth).
pub fn set_ssh_secret(id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, &ssh_account(id))?;
    entry.set_password(secret)?;
    Ok(())
}

pub fn get_ssh_secret(id: &str) -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(SERVICE, &ssh_account(id))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_ssh_secret(id: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, &ssh_account(id))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn ai_key_account(provider: &str) -> String {
    format!("ai:{provider}:apiKey")
}

pub fn set_ai_key(provider: &str, key: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, &ai_key_account(provider))?;
    entry.set_password(key)?;
    Ok(())
}

pub fn get_ai_key(provider: &str) -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(SERVICE, &ai_key_account(provider))?;
    match entry.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
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
