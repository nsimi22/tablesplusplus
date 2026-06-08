//! Engine-agnostic DTOs, the `DbClient` contract, and the `DbConnection` enum dispatch.
//!
//! Per docs/architecture.md §2 we use **enum dispatch** (`DbConnection`) on the hot path
//! rather than boxed trait objects: the engine set is small and closed, so an exhaustive
//! `match` is simpler and allocation-free. The `DbClient` trait remains the shared contract
//! that each concrete client implements and is tested against.

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::db::mysql::MysqlClient;
use crate::db::postgres::PostgresClient;
use crate::error::AppError;

// ---- Connection metadata (non-secret; secret lives in the keyring) ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    Postgres,
    Mysql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    Agent,
    Key,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: SshAuthMethod,
    /// Path to the private key file (for `Key` auth). The passphrase, if any, is in the keyring.
    #[serde(default)]
    pub key_path: Option<String>,
}

/// Persisted, non-secret connection metadata (CLAUDE.md §4.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

/// Inbound create/update payload — the password crosses the bridge inbound only and is
/// written straight to the keyring, never echoed back (CLAUDE.md §4.1, §7).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    /// Plaintext password (optional). Present only when the user (re)enters it.
    #[serde(default)]
    pub password: Option<String>,
    /// SSH secret (password or key passphrase), present only when (re)entered. Keyring-only.
    #[serde(default)]
    pub ssh_secret: Option<String>,
}

impl ConnectionInput {
    /// Build the persisted config for this input under a given id (drops the secret).
    pub fn into_config(self, id: String) -> ConnectionConfig {
        ConnectionConfig {
            id,
            engine: self.engine,
            host: self.host,
            port: self.port,
            user: self.user,
            database: self.database,
            ssl_mode: self.ssl_mode,
            ssh: self.ssh,
            label: self.label,
            color: self.color,
        }
    }
}

// ---- Result shape (docs/architecture.md §4) ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

/// A base64-encoded (possibly truncated) binary cell payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BytesCell {
    /// base64 of the (possibly truncated) bytes.
    pub data: String,
    pub truncated: bool,
}

/// Generic, driver-independent cell value. Serialized adjacently tagged as
/// `{ "kind": ..., "value": ... }` to match the TS union in src/lib/types.ts
/// (docs/architecture.md §4.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum CellValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    /// Exact numeric/decimal as a string — avoids f64 precision loss.
    Decimal(String),
    Text(String),
    /// Binary; base64 with a truncation flag (docs/architecture.md §8).
    Bytes(BytesCell),
    /// Date/time/timestamp as ISO-8601.
    DateTime(String),
    Json(serde_json::Value),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub rows_affected: Option<u64>,
    pub elapsed_ms: u64,
}

// ---- Schema introspection ----

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TableKind {
    Table,
    View,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutineKind {
    Function,
    Procedure,
}

/// A column's foreign-key target (single-column FKs). Drives the grid's "jump to referenced
/// row" affordance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyRef {
    pub schema: String,
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    /// The referenced column if this column is a single-column foreign key, else `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_key: Option<ForeignKeyRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInfo {
    pub schema: String,
    pub name: String,
    pub kind: RoutineKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub tables: Vec<TableInfo>,
    pub views: Vec<TableInfo>,
    pub routines: Vec<RoutineInfo>,
}

/// Display/truncation threshold for binary cells (docs/architecture.md §8). Shared by both engines.
pub(crate) const MAX_BYTES: usize = 64 * 1024;

/// Lower raw bytes into a (possibly truncated) base64-encoded `CellValue::Bytes`.
pub(crate) fn bytes_cell(mut b: Vec<u8>) -> CellValue {
    let truncated = b.len() > MAX_BYTES;
    if truncated {
        b.truncate(MAX_BYTES);
    }
    CellValue::Bytes(BytesCell {
        data: base64::engine::general_purpose::STANDARD.encode(&b),
        truncated,
    })
}

/// Map an `information_schema` table_type string to a `TableKind`.
pub(crate) fn parse_table_kind(table_type: &str) -> TableKind {
    if table_type.eq_ignore_ascii_case("VIEW") {
        TableKind::View
    } else {
        TableKind::Table
    }
}

/// Map an `information_schema` routine_type string to a `RoutineKind`.
pub(crate) fn parse_routine_kind(routine_type: &str) -> RoutineKind {
    if routine_type.eq_ignore_ascii_case("PROCEDURE") {
        RoutineKind::Procedure
    } else {
        RoutineKind::Function
    }
}

/// Accumulates tables/views and their columns in stable (insertion) order while a driver
/// streams introspection rows; shared by both engine clients.
#[derive(Default)]
pub(crate) struct SchemaBuilder {
    entries: Vec<TableInfo>,
    index: std::collections::HashMap<(String, String), usize>,
}

impl SchemaBuilder {
    pub(crate) fn add_table(&mut self, schema: String, name: String, kind: TableKind) {
        let key = (schema.clone(), name.clone());
        if !self.index.contains_key(&key) {
            self.index.insert(key, self.entries.len());
            self.entries.push(TableInfo {
                schema,
                name,
                kind,
                columns: Vec::new(),
            });
        }
    }

    pub(crate) fn add_column(&mut self, schema: &str, table: &str, col: ColumnInfo) {
        if let Some(&i) = self.index.get(&(schema.to_string(), table.to_string())) {
            self.entries[i].columns.push(col);
        }
    }

    pub(crate) fn finish(self, routines: Vec<RoutineInfo>) -> Schema {
        let (views, tables): (Vec<_>, Vec<_>) = self
            .entries
            .into_iter()
            .partition(|t| matches!(t.kind, TableKind::View));
        Schema {
            tables,
            views,
            routines,
        }
    }
}

// ---- Streaming ----

/// A chunk of a streamed query result, forwarded to the frontend over a Tauri channel so a
/// large result renders progressively with bounded per-message size (docs/architecture.md §8).
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamChunk {
    Columns {
        columns: Vec<ColumnMeta>,
    },
    Rows {
        rows: Vec<Vec<CellValue>>,
    },
    Done {
        rows_affected: Option<u64>,
        elapsed_ms: u64,
        /// True if streaming stopped at `STREAM_MAX_ROWS` before exhausting the result.
        truncated: bool,
    },
}

/// Bounded channel the engine clients push `StreamChunk`s into; the command forwards them.
pub type ChunkSender = tokio::sync::mpsc::Sender<StreamChunk>;

/// Rows per streamed batch, and a safety cap on total streamed rows.
pub const STREAM_BATCH: usize = 1000;
pub const STREAM_MAX_ROWS: usize = 1_000_000;

// ---- The unified contract ----

#[async_trait::async_trait]
pub trait DbClient: Send + Sync {
    /// Validate the live pool with a trivial round-trip (the pool itself is built in the
    /// concrete client's `connect` constructor).
    async fn ping(&self) -> Result<(), AppError>;
    /// Close the pool and release resources.
    async fn close(&self) -> Result<(), AppError>;
    /// `params` carries bind values so app-generated DML is always parameterized; pass an
    /// empty Vec for user-authored SQL. SQL must use the engine's native placeholder style.
    async fn execute_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
    ) -> Result<QueryResult, AppError>;
    /// Stream a row-returning query in batches into `tx` (columns first, then row batches, then
    /// a final `Done`). Non-row statements send a single `Done` with `rows_affected`.
    async fn stream_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
        tx: ChunkSender,
    ) -> Result<(), AppError>;
    /// Introspect tables/views/routines for the connected database.
    async fn get_schema(&self) -> Result<Schema, AppError>;
}

/// Enum dispatch over the concrete clients.
#[derive(Clone)]
enum EngineClient {
    Postgres(PostgresClient),
    Mysql(MysqlClient),
}

/// A live connection: the engine client plus an optional SSH tunnel held alive for its lifetime.
/// Cloning is cheap — clients hold pool handles (Arc internally) and the tunnel is `Arc`-shared —
/// so commands clone a `DbConnection` out of the registry and drop the map guard *before*
/// awaiting (no lock held across `.await`). When the last clone drops, the tunnel tears down.
#[derive(Clone)]
pub struct DbConnection {
    engine: EngineClient,
    _tunnel: Option<std::sync::Arc<crate::ssh::SshTunnel>>,
}

impl DbConnection {
    pub fn new_postgres(
        client: PostgresClient,
        tunnel: Option<std::sync::Arc<crate::ssh::SshTunnel>>,
    ) -> Self {
        Self {
            engine: EngineClient::Postgres(client),
            _tunnel: tunnel,
        }
    }

    pub fn new_mysql(
        client: MysqlClient,
        tunnel: Option<std::sync::Arc<crate::ssh::SshTunnel>>,
    ) -> Self {
        Self {
            engine: EngineClient::Mysql(client),
            _tunnel: tunnel,
        }
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        match &self.engine {
            EngineClient::Postgres(c) => c.ping().await,
            EngineClient::Mysql(c) => c.ping().await,
        }
    }

    pub async fn close(&self) -> Result<(), AppError> {
        match &self.engine {
            EngineClient::Postgres(c) => c.close().await,
            EngineClient::Mysql(c) => c.close().await,
        }
    }

    pub async fn execute_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
    ) -> Result<QueryResult, AppError> {
        match &self.engine {
            EngineClient::Postgres(c) => c.execute_query(sql, params).await,
            EngineClient::Mysql(c) => c.execute_query(sql, params).await,
        }
    }

    pub async fn stream_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
        tx: ChunkSender,
    ) -> Result<(), AppError> {
        match &self.engine {
            EngineClient::Postgres(c) => c.stream_query(sql, params, tx).await,
            EngineClient::Mysql(c) => c.stream_query(sql, params, tx).await,
        }
    }

    pub async fn get_schema(&self) -> Result<Schema, AppError> {
        match &self.engine {
            EngineClient::Postgres(c) => c.get_schema().await,
            EngineClient::Mysql(c) => c.get_schema().await,
        }
    }
}
