# Tables++ — Phase 2 Architecture: Database Driver Abstraction & IPC Serialization

> **Status:** Design (Phase 2). No implementation yet — this document is the contract that
> Phase 3 (Modules A–D) builds against. It expands §4 of `CLAUDE.md` with concrete types,
> per-engine mapping tables, and the decisions made while designing the layer.
> Keep it in sync with the Rust code as it lands; when reality diverges, update this doc.

---

## 1. Goals & Non-Goals

**Goals**
- A single, engine-agnostic surface (`DbClient`) the rest of the backend and all `#[tauri::command]`
  handlers depend on — never a concrete driver type.
- Async end-to-end (tokio), pooled connections, optional SSH tunnel per connection.
- Every query result lowered into one generic, serde-serializable DTO **before** crossing the
  Tauri IPC bridge, so the React grid is fully decoupled from `tokio-postgres` / `mysql_async`.
- Exact-fidelity values: no silent precision loss on decimals, no lossy timestamp round-trips.
- App-generated DML is always parameterized; user-authored console SQL runs verbatim.

**Non-Goals (this phase)**
- No UI, no command wiring, no keyring/SSH implementation — those are Phase 3 modules.
- No additional engines beyond PostgreSQL + MySQL (the trait keeps the door open for more).
- No streaming/cursor protocol yet — see §8 for the planned large-result strategy.

---

## 2. Dispatch Strategy — enum over `dyn`

`CLAUDE.md` §4.4 allows "`dyn DbClient` **or** an enum dispatch." **Decision: enum dispatch.**

Rationale:
- `async fn` in traits used as `dyn` requires `#[async_trait]`, which boxes every returned future
  (heap alloc per call). Enum dispatch is monomorphized and allocation-free on the hot path —
  better fit for the "lightweight / instant" product bar.
- The set of engines is small, closed, and known at compile time. A 2-variant enum is simpler
  than trait objects and keeps exhaustive `match` checks honest as engines are added.

```rust
// src-tauri/src/db/client.rs
pub enum DbConnection {
    Postgres(PostgresClient),
    Mysql(MysqlClient),
}
```

The `DbClient` trait still exists as the **shared contract** both clients implement (so each impl
is written against one interface and tested uniformly). `DbConnection` delegates each method to the
active variant. Commands and the pool registry hold `DbConnection`, never `PostgresClient` /
`MysqlClient` directly.

> We still use `#[async_trait]` on the trait for ergonomic shared signatures, but the runtime
> dispatch path is the enum `match`, not a boxed trait object.

---

## 3. The `DbClient` Trait (full surface)

```rust
#[async_trait::async_trait]
pub trait DbClient: Send + Sync {
    /// Open the pool (and SSH tunnel if configured). Idempotent: re-`connect` is a no-op if live.
    async fn connect(&self) -> Result<(), AppError>;

    /// Tear down the pool and any tunnel. Safe to call when already disconnected.
    async fn disconnect(&self) -> Result<(), AppError>;

    /// `params` carries bind values so app-generated DML is always parameterized — never
    /// string-interpolated. Pass an empty Vec for user-authored console SQL.
    /// SQL must already use the engine's placeholder style ($1.. for PG, ? for MySQL); see §6.
    async fn execute_query(&self, sql: String, params: Vec<CellValue>) -> Result<QueryResult, AppError>;

    /// Introspect tables, views, and functions for the connected database (§7).
    async fn get_schema(&self) -> Result<Schema, AppError>;

    /// Check out a connection and run a trivial round-trip (`SELECT 1`) to validate creds/tunnel.
    async fn test_connection(&self) -> Result<(), AppError>;
}
```

`DbConnection` implements the same five methods by delegating:

```rust
impl DbConnection {
    pub async fn execute_query(&self, sql: String, params: Vec<CellValue>) -> Result<QueryResult, AppError> {
        match self {
            DbConnection::Postgres(c) => c.execute_query(sql, params).await,
            DbConnection::Mysql(c)    => c.execute_query(sql, params).await,
        }
    }
    // ...connect / disconnect / get_schema / test_connection identical shape.
}
```

---

## 4. Shared DTOs (the IPC contract)

All public DTOs derive `Serialize`/`Deserialize` with `#[serde(rename_all = "camelCase")]`.
The TS mirrors live in `src/lib/types.ts` and **must** stay in lockstep with these.

```rust
// ---- Connection (non-secret metadata; secret resolved from keyring at connect time) ----
pub enum Engine { Postgres, Mysql }
pub enum SslMode { Disable, Prefer, Require, VerifyCa, VerifyFull }

pub struct ConnectionConfig {
    pub id: String,            // stable UUID; keyring account = connection:{id}:password
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub ssl_mode: SslMode,
    pub ssh: Option<SshConfig>, // tunnel metadata only; secrets in keyring (Phase 3)
    pub label: Option<String>,
    pub color: Option<String>,
}

// ---- Result shape ----
pub struct ColumnMeta { pub name: String, pub data_type: String, pub nullable: bool }

pub enum CellValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Decimal(String),   // exact numeric/decimal/money — string to avoid f64 precision loss
    Text(String),
    Bytes(Vec<u8>),    // base64 in JSON; see §8 for truncation of large blobs
    DateTime(String),  // date/time/timestamp[tz] as ISO-8601 to avoid lossy text parsing
    Json(serde_json::Value),
}

pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub rows_affected: Option<u64>,   // Some(n) for DML, None for row-returning SELECTs
    pub elapsed_ms: u64,
}

// ---- Schema introspection ----
pub struct ColumnInfo { pub name: String, pub data_type: String, pub nullable: bool, pub is_primary_key: bool }
pub struct TableInfo  { pub schema: String, pub name: String, pub kind: TableKind, pub columns: Vec<ColumnInfo> }
pub enum TableKind    { Table, View }
pub struct RoutineInfo { pub schema: String, pub name: String, pub kind: RoutineKind } // Function | Procedure
pub struct Schema {
    pub tables: Vec<TableInfo>,
    pub views: Vec<TableInfo>,
    pub routines: Vec<RoutineInfo>,
}
```

### 4.1 `CellValue` JSON encoding

`CellValue` serializes as an **internally tagged** union so the TS side discriminates without
guessing from shape:

```jsonc
{ "kind": "null" }
{ "kind": "bool",     "value": true }
{ "kind": "int",      "value": 42 }
{ "kind": "float",    "value": 3.14 }
{ "kind": "decimal",  "value": "12345.6789" }   // string — exact
{ "kind": "text",     "value": "hello" }
{ "kind": "bytes",    "value": { "data": "aGVsbG8=", "truncated": false } }  // base64 + flag
{ "kind": "dateTime", "value": "2026-06-05T12:34:56Z" }
{ "kind": "json",     "value": { "any": "json" } }
```

Rust: `#[serde(tag = "kind", content = "value", rename_all = "camelCase")]`. The `bytes` variant
wraps a `BytesCell { data, truncated }` struct so the base64 payload and the truncation flag
(see §8) stay under `value`. Matching TS discriminated union:

```ts
export type CellValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "float"; value: number }
  | { kind: "decimal"; value: string }
  | { kind: "text"; value: string }
  | { kind: "bytes"; value: { data: string; truncated: boolean } }
  | { kind: "dateTime"; value: string }
  | { kind: "json"; value: unknown };
```

> **Why `Int` is `i64` but JSON `number`:** values beyond ±2^53 are unsafe as JS numbers.
> For the v1 grid this is acceptable for display; if/when we surface `BIGINT` keys that exceed
> the safe range, promote them to `Decimal(String)` at the mapping layer. Recorded as a known
> edge case here so it isn't rediscovered.

---

## 5. Per-Engine Type Mapping

The mapping layer converts a driver-native column value into `CellValue`. Unknown/unsupported
types fall back to `Text` via the driver's string rendering rather than erroring the whole query.

### 5.1 PostgreSQL (`tokio-postgres`)

| PG type | `CellValue` |
|---|---|
| `bool` | `Bool` |
| `int2`, `int4`, `int8` | `Int` |
| `float4`, `float8` | `Float` |
| `numeric`, `money` | `Decimal` (string) |
| `text`, `varchar`, `char`, `name`, `uuid`, enums | `Text` |
| `bytea` | `Bytes` |
| `date`, `time`, `timestamp`, `timestamptz` | `DateTime` (ISO-8601) |
| `json`, `jsonb` | `Json` |
| arrays, ranges, composite, network, geo | `Text` (fallback v1) |
| SQL `NULL` (any type) | `Null` |

Notes: read `timestamptz` as `chrono::DateTime<Utc>` → RFC 3339; `timestamp`/`date`/`time` via
`chrono::Naive*` → ISO-8601 without offset. `numeric` read as string (e.g. via `rust_decimal` or
`tokio-postgres`'s `Type`-aware text) to dodge `f64`.

### 5.2 MySQL (`mysql_async`)

| MySQL type | `CellValue` |
|---|---|
| `TINYINT(1)` | `Bool` |
| `TINYINT`…`BIGINT` (signed) | `Int` |
| `BIGINT UNSIGNED` > i64::MAX | `Decimal` (string) — avoid overflow |
| `FLOAT`, `DOUBLE` | `Float` |
| `DECIMAL`, `NUMERIC` | `Decimal` (string) |
| `CHAR`, `VARCHAR`, `TEXT`, `ENUM`, `SET` | `Text` |
| `BINARY`, `VARBINARY`, `BLOB` | `Bytes` |
| `DATE`, `TIME`, `DATETIME`, `TIMESTAMP`, `YEAR` | `DateTime` (ISO-8601) |
| `JSON` | `Json` |
| `BIT`, `GEOMETRY` | `Bytes` / `Text` (fallback v1) |
| SQL `NULL` | `Null` |

Notes: `mysql_async` returns `mysql_common::Value`; match on its variants and on column type flags
to distinguish `TINYINT(1)`-as-bool and unsigned bigints.

---

## 6. Connection Lifecycle, Pooling & Parameters

### 6.1 Pool registry

```rust
// src-tauri/src/db/pool.rs
pub struct PoolRegistry { conns: DashMap<String, DbConnection> } // key = ConnectionConfig.id
```

`DashMap` is used **directly** — it is already internally sharded/concurrent. It is **not** wrapped
in an outer `Mutex`/`RwLock` (that would serialize access and defeat the purpose). Exposed to Tauri
as `State<PoolRegistry>`.

- `connect(id)` → resolve secret from keyring → (optional) open SSH tunnel → build the engine pool →
  insert `DbConnection` into the map.
- queries check out a pooled connection; they never reconnect from scratch.
- `disconnect(id)` → remove from the map → close the pool → drop the tunnel.

### 6.2 Engine pooling — decision

- **Postgres:** `deadpool-postgres` (as in `CLAUDE.md`).
- **MySQL:** `mysql_async` ships its **own** `Pool`; we use it directly rather than `deadpool`.
  (`deadpool-mysql` targets the *sync* `mysql` crate and would conflict with our async driver.)
  → This refines `CLAUDE.md` §2's "mysql_async + deadpool"; `CLAUDE.md` updated to match.

`PostgresClient` and `MysqlClient` each own their pool handle plus an optional tunnel guard, so
pool sizing (small by default, ~5–10) and teardown are encapsulated per engine.

### 6.3 Parameter binding

- The trait takes `params: Vec<CellValue>`. The caller supplies SQL with the engine's native
  placeholder style: **`$1, $2, …` for Postgres**, **`?` for MySQL**. App-generated DML
  (grid commits in Module C) is produced by an engine-aware builder, so the right style is used.
- Postgres: wrap each `CellValue` in an adapter implementing `tokio_postgres::types::ToSql`
  (Null→`Option::None`, Decimal→`numeric` via string/`rust_decimal`, DateTime→`chrono`, etc.).
- MySQL: convert each `CellValue` into `mysql_async::Value`.
- User-authored console SQL passes `params = []` and runs verbatim (`CLAUDE.md` §7).

---

## 7. Schema Introspection Queries

One round trip per category, mapped into `Schema`. Both engines read from `information_schema`
so the queries stay close.

**PostgreSQL**
- Tables/views: `information_schema.tables` filtered to the current DB, excluding
  `pg_catalog`/`information_schema`; `table_type` distinguishes `BASE TABLE` vs `VIEW`.
- Columns + PKs: `information_schema.columns` joined with `key_column_usage` /
  `table_constraints` (or `pg_index`) for `is_primary_key`.
- Functions/procedures: `information_schema.routines` (`routine_type`).

**MySQL**
- Tables/views: `information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`.
- Columns + PKs: `information_schema.COLUMNS` (`COLUMN_KEY = 'PRI'` → primary key).
- Functions/procedures: `information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()`.

Results feed the searchable schema tree in Module B.

---

## 8. Large / Binary Value Strategy

To keep one fat row from blocking the UI:
- `Bytes` and very long `Text` are **truncated for display** at a backend threshold
  (proposed: 64 KB; finalize in Module C). The DTO marks truncation:
  `{ "kind": "bytes", "value": "<base64 of first N bytes>", "truncated": true }`
  (and analogously a `truncated` flag for oversized `Text`).
- Full values are fetched **on demand** by primary key when the user expands a cell.
- Very large result sets are **paged from the backend** (LIMIT/OFFSET or keyset) rather than
  shipped whole; the virtualized grid requests pages as it scrolls. The streaming/cursor
  protocol is deferred — documented here so Module C designs the grid against paging from day one.

---

## 9. Error Model

One `AppError` (`thiserror`) implementing `std::error::Error + Serialize`, mapped from driver/keyring/
SSH errors at the boundary. Serialized payload:

```jsonc
{ "kind": "connection" | "auth" | "query" | "schema" | "keyring" | "ssh"
        | "tunnel" | "serialization" | "timeout" | "notFound" | "internal",
  "message": "human-readable summary",
  "detail": "optional driver-specific detail (SQLSTATE, position, etc.)" }
```

No secrets ever appear in `message`/`detail` (`CLAUDE.md` §7). The UI switches on `kind` to render
actionable states (e.g. `auth` → re-prompt password; `connection`/`tunnel` → check host/SSH).

---

## 10. Module Map (what Phase 3 builds on this)

| Module | Depends on |
|---|---|
| **A — Connection Hub** | `ConnectionConfig`, keyring wrapper, `connect`/`test_connection`, `AppError` |
| **B — Workspace & Schema Tree** | `get_schema` → `Schema` DTO |
| **C — Data Grid** | `execute_query` + `QueryResult`/`CellValue`, paging (§8), parameterized commits (§6.3) |
| **D — SQL Console** | `execute_query` (params `[]`), `Schema` for autocomplete, multi-tab `QueryResult`/`AppError` |

---

## 11. Open Decisions (resolve as Phase 3 lands)

1. **TLS backend** for both drivers (`rustls` vs `native-tls`) — lean toward `rustls` for a
   smaller, static bundle; confirm both drivers' feature flags interoperate.
2. **`numeric`/`DECIMAL` representation in Rust** — `rust_decimal` vs raw driver string. Either
   way the *wire* form is `Decimal(String)`.
3. **`bytes` truncation threshold** and the exact on-demand re-fetch command shape (Module C).
4. **BIGINT > 2^53** promotion to `Decimal` — apply at mapping layer once real BIGINT keys appear.
5. **Paging strategy** — LIMIT/OFFSET (simple) vs keyset (stable under writes) for the grid.
