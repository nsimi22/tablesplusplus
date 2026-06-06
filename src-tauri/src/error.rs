//! Unified application error.
//!
//! Every fallible path in command/db/secrets code returns `Result<_, AppError>`.
//! Driver, keyring, and IO errors are mapped into `AppError` at the boundary so the
//! frontend receives a structured `{ kind, message, detail? }` payload it can render
//! into rich, actionable states (docs/architecture.md §9). Secrets must never appear
//! in `message`/`detail` (CLAUDE.md §7).

use serde::Serialize;
use std::fmt;

// The full taxonomy is part of the IPC error contract (docs/architecture.md §9); some
// variants/constructors are wired in as later modules surface those conditions.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Connection,
    Auth,
    Query,
    Schema,
    Keyring,
    Ssh,
    Tunnel,
    Serialization,
    Timeout,
    NotFound,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[allow(dead_code)]
impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Connection, msg)
    }
    pub fn query(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Query, msg)
    }
    pub fn schema(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Schema, msg)
    }
    pub fn keyring(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Keyring, msg)
    }
    pub fn ssh(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Ssh, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, msg)
    }
    pub fn serialization(msg: impl Into<String>) -> Self {
        Self::new(ErrorKind::Serialization, msg)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(d) => write!(f, "{}: {} ({d})", kind_label(self.kind), self.message),
            None => write!(f, "{}: {}", kind_label(self.kind), self.message),
        }
    }
}

impl std::error::Error for AppError {}

fn kind_label(kind: ErrorKind) -> &'static str {
    match kind {
        ErrorKind::Connection => "connection",
        ErrorKind::Auth => "auth",
        ErrorKind::Query => "query",
        ErrorKind::Schema => "schema",
        ErrorKind::Keyring => "keyring",
        ErrorKind::Ssh => "ssh",
        ErrorKind::Tunnel => "tunnel",
        ErrorKind::Serialization => "serialization",
        ErrorKind::Timeout => "timeout",
        ErrorKind::NotFound => "notFound",
        ErrorKind::Internal => "internal",
    }
}

// ---- Boundary conversions (driver/keyring/IO → AppError) ----

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        match e {
            keyring::Error::NoEntry => {
                AppError::new(ErrorKind::Keyring, "No stored secret for this connection")
            }
            other => AppError::keyring("Keyring access failed").with_detail(other.to_string()),
        }
    }
}

impl From<tokio_postgres::Error> for AppError {
    fn from(e: tokio_postgres::Error) -> Self {
        // SQLSTATE, when present, is a safe, useful detail.
        let detail = e.code().map(|c| format!("SQLSTATE {}", c.code()));
        let mut err = AppError::query(e.to_string());
        err.detail = detail;
        err
    }
}

impl From<deadpool_postgres::PoolError> for AppError {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        AppError::connection("Failed to check out a PostgreSQL connection")
            .with_detail(e.to_string())
    }
}

impl From<mysql_async::Error> for AppError {
    fn from(e: mysql_async::Error) -> Self {
        use mysql_async::Error;
        let detail = e.to_string();
        match e {
            // I/O, URL, and driver-level failures are connection problems.
            Error::Io(_) | Error::Url(_) | Error::Driver(_) => {
                AppError::connection("Failed to connect to MySQL").with_detail(detail)
            }
            Error::Server(server) => match server.code {
                // Access-denied / bad credentials → auth, so the UI can re-prompt.
                1044 | 1045 | 1251 | 1698 => {
                    AppError::new(ErrorKind::Auth, "MySQL authentication failed")
                        .with_detail(detail)
                }
                // Unknown database / unknown host → can't reach the target.
                1049 | 1042 => {
                    AppError::connection("Cannot reach the MySQL database").with_detail(detail)
                }
                _ => AppError::query("MySQL query error").with_detail(detail),
            },
            _ => AppError::query("MySQL error").with_detail(detail),
        }
    }
}

impl From<native_tls::Error> for AppError {
    fn from(e: native_tls::Error) -> Self {
        AppError::connection("TLS setup failed").with_detail(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::new(ErrorKind::Connection, "Could not reach the AI provider")
            .with_detail(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::serialization("Failed to (de)serialize data").with_detail(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::internal("Filesystem error").with_detail(e.to_string())
    }
}
