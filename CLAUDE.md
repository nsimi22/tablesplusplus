# CLAUDE.md — Tables++ Engineering Guide

> Authoritative development guide for **Tables++**, an open-source, ultra-fast, premium
> desktop database GUI client inspired by [TablePlus](https://tableplus.com).
> Read this file in full before writing or modifying any code. Keep it current:
> when a decision, convention, or platform-specific fix is discovered, document it here.

---

## 1. Product Vision

Tables++ is a **lightweight, native-feeling** database client for **macOS** and **Windows**
(Linux is a best-effort secondary target). It targets **PostgreSQL** and **MySQL** first,
with an abstraction layer designed so additional engines can be added later.

Non-negotiable product qualities:

- **Instant startup** — cold start well under 1 second.
- **Tiny footprint** — release bundle target ~15 MB; idle RAM in the low tens of MB.
- **Buttery data grid** — render and scroll 100,000+ rows with no perceptible lag.
- **Premium feel** — refined, low-contrast dark mode by default; calm typography and spacing.
- **Secure by default** — credentials never stored in plaintext; secrets live in the OS keyring.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Desktop shell | **Tauri 2.x** (Rust) | Native webview, small bundle, secure IPC. |
| Backend | **Rust** (stable, 2021 edition) | App lifecycle, drivers, keyring, SSH, pooling. |
| Async runtime | **tokio** | Single shared multi-threaded runtime. |
| Postgres driver | **tokio-postgres** + **deadpool-postgres** | Async, pooled. |
| MySQL driver | **mysql_async** | Async; uses `mysql_async`'s built-in pool (not deadpool). |
| Secrets | **keyring** crate | OS-native: Keychain (macOS), Credential Manager (Windows), Secret Service (Linux). |
| AI assistant | **reqwest** (rustls) | Optional, bring-your-own-key gateway to Anthropic / OpenAI / OpenRouter for SQL tools. |
| SSH tunneling | **russh** (or `ssh2` fallback) | Optional per-connection tunnel. |
| Serialization | **serde** / **serde_json** | Generic row/column JSON across the IPC bridge. |
| Frontend | **React 18 + TypeScript** | Strict TS, function components + hooks only. |
| Styling | **TailwindCSS** + **shadcn/ui** | Design tokens drive the theme; no ad-hoc colors. |
| State | **Zustand** (UI/local) + **TanStack Query** (async/server state) | Keep server state out of component state. |
| Data grid | **@tanstack/react-virtual** or **react-window** | Virtualized; never render all rows. |
| SQL editor | **Monaco Editor** | SQL highlighting, schema-aware autocomplete. |
| Layout | **react-resizable-panels** | Multi-pane split workspace. |
| Build/dev | **Vite** | Fast HMR for the frontend. |

> **Dependency discipline:** prefer the standard library and small, well-maintained crates/packages.
> Before adding a heavy dependency, justify it here. Reject anything that bloats the bundle or
> startup time without a clear payoff.

---

## 3. Repository Structure

```
tablesplusplus/
├── CLAUDE.md                  # This file. Engineering source of truth.
├── README.md
├── LICENSE
├── package.json               # Frontend deps + scripts (root or /app — keep consistent).
├── index.html                 # Vite entry.
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── src/                       # React frontend (TypeScript)
│   ├── main.tsx               # React root.
│   ├── App.tsx
│   ├── lib/
│   │   ├── ipc.ts             # Thin typed wrappers over Tauri `invoke`. ALL IPC goes here.
│   │   └── types.ts           # Shared TS types mirroring Rust DTOs (QueryResult, Schema, etc.).
│   ├── components/            # Reusable presentational components (shadcn/ui based).
│   ├── features/              # Feature modules (connections, workspace, grid, editor).
│   │   ├── connections/
│   │   ├── workspace/
│   │   ├── grid/
│   │   └── editor/
│   └── store/                 # Zustand stores.
└── src-tauri/                 # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    └── src/
        ├── main.rs            # Tauri builder, command registration, state setup.
        ├── commands/          # #[tauri::command] handlers ONLY. Thin; delegate to db/.
        ├── db/
        │   ├── mod.rs
        │   ├── client.rs      # `DbClient` trait + shared DTOs.
        │   ├── postgres.rs    # Postgres impl.
        │   ├── mysql.rs       # MySQL impl.
        │   └── pool.rs        # Connection pool registry.
        ├── secrets/           # Keyring wrapper (DB + AI provider keys).
        ├── ai/                # AI provider gateway (Anthropic/OpenAI/OpenRouter) over HTTP.
        ├── config/            # Local non-secret stores (connections.json, ai.json).
        └── error.rs           # Unified AppError + serde-serializable error payloads.
```

> Implemented layout notes (Phase 3): the backend entry is `src-tauri/src/lib.rs`
> (`tablesplusplus_lib::run`) with a thin `main.rs`. Tauri 2 capabilities live in
> `src-tauri/capabilities/default.json`. SSH tunneling is implemented in `src-tauri/src/ssh/`
> (russh local-forward; see §11). The detailed Phase 2 design lives in `docs/architecture.md`.

> If the actual layout diverges from this during the build, **update this section** rather than
> letting the doc drift.

---

## 4. Architectural Blueprint

```
┌────────────────────────────────────────┐
│            React Frontend              │
│  (Workspace, Schema Tree, Data Grid)  │
└───────────────────┬────────────────────┘
                    │  Tauri IPC (typed invoke ↔ #[command], JSON DTOs)
┌───────────────────▼────────────────────┐
│             Rust Backend               │
│  (Lifecycle, Keyring, SSH, Pooling)   │
└───────────────────┬────────────────────┘
                    │  DbClient trait (async)
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│ Postgres impl │       │  MySQL impl   │
│ tokio-postgres│       │ mysql_async   │
└───────────────┘       └───────────────┘
```

### 4.1 Secure Credential Storage (system keyring)

- **Never** persist passwords, SSH keys/passphrases, or other secrets to disk in plaintext,
  in app config, or in logs.
- Non-secret connection metadata (host, port, user, db name, SSL mode, color/label, last-used)
  is stored in a local config file (JSON) under the app data dir.
  - **External consumer:** `completesolar/query-mcp` reads `connections.json` and the keyring
    entries (`attach_tablesplusplus_connection`) to attach saved connections in Claude sessions.
    If `ConnectionConfig` field names, the file location, or the keyring service/account naming
    change, update that bridge (`src/tools/tablesplusplus.ts`) in the same breath.
- Each connection has a stable UUID `id`. The secret is stored in the OS keyring under
  service `tablesplusplus` and account `connection:{id}:password` (and similar keys for
  SSH secrets). Config references the connection by `id` only.
- The keyring wrapper (`src-tauri/src/secrets/`) exposes `set_secret`, `get_secret`,
  `delete_secret`. Deleting a connection must also delete its keyring entries.
- Secrets cross the IPC bridge **only** inbound (user typing a password in the form). They are
  never sent back to the frontend; "edit connection" shows a masked placeholder.

### 4.2 Connection Pooling

- A backend-global, thread-safe **pool registry** (`State<PoolRegistry>` wrapping a `DashMap`)
  maps `connection_id → pool`. `DashMap` is already internally concurrent — do **not** wrap it in
  an outer `Mutex`/`RwLock`, which would serialize access and defeat its purpose.
- `connect()` resolves the secret from keyring, opens (optionally through an SSH tunnel) a pool
  (deadpool for Postgres; `mysql_async`'s built-in pool for MySQL), and stores it in the registry.
  Subsequent queries check out a connection from the pool; they never reconnect from scratch.
- Pool sizing: small by default (e.g. max 5–10) to stay light. Configurable later.
- `disconnect()` removes the pool from the registry and closes it; the SSH tunnel (if any) is
  torn down with it.
- Idle pools may be reaped on a timer (document the policy here if/when added).

### 4.3 Structured JSON over the IPC Bridge

- The frontend is **decoupled from database-specific driver types**. The backend maps every
  query result into a generic, serde-serializable DTO before crossing the bridge:

  ```rust
  // Conceptual shape — finalize in src-tauri/src/db/client.rs
  pub struct ColumnMeta { pub name: String, pub data_type: String, pub nullable: bool }
  pub enum CellValue {
      Null,
      Bool(bool),
      Int(i64),
      Float(f64),
      Decimal(String),           // exact numeric/decimal — string to avoid f64 precision loss
      Text(String),
      Bytes(Vec<u8>),
      DateTime(String),          // date/time/timestamp as ISO-8601 to avoid lossy text parsing
      Json(serde_json::Value),
  }
  pub struct QueryResult {
      pub columns: Vec<ColumnMeta>,
      pub rows: Vec<Vec<CellValue>>,
      pub rows_affected: Option<u64>,
      pub elapsed_ms: u64,
  }
  ```

- `CellValue` is serialized as a tagged or naturally-typed JSON value; the matching TS union
  lives in `src/lib/types.ts` and **must be kept in sync** with the Rust enum.
- Large/binary values are handled deliberately (truncate-for-display + on-demand fetch) so a
  single fat row never blocks the UI. Document the chosen strategy here when implemented.
- Errors cross the bridge as a structured `AppError` payload (`{ kind, message, detail? }`),
  not as opaque strings, so the UI can render rich, actionable error states.

### 4.4 The `DbClient` Trait

The unified abstraction (designed in Phase 2, implemented in Phase 3). Minimum surface:

```rust
#[async_trait::async_trait]
pub trait DbClient: Send + Sync {
    async fn connect(&self) -> Result<(), AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
    // `params` carries bind values so app-generated DML (grid edits/commits) is always
    // parameterized — never string-interpolated. Pass an empty Vec for user-authored SQL.
    async fn execute_query(&self, sql: String, params: Vec<CellValue>) -> Result<QueryResult, AppError>;
    async fn get_schema(&self) -> Result<Schema, AppError>;
    async fn test_connection(&self) -> Result<(), AppError>;
}
```

Both `PostgresClient` and `MysqlClient` implement it. Commands depend on `dyn DbClient`
(or an enum dispatch) — **never** on a concrete driver type.

---

## 5. Coding Conventions

### 5.1 Rust

- Format with `cargo fmt`; lint with `cargo clippy -- -D warnings` (CI gate).
- **No `unwrap()`/`expect()`/`panic!`** in command/request paths. Return `Result<_, AppError>`.
- One unified error type (`AppError`) implementing `std::error::Error` + `serde::Serialize`.
  Use `thiserror` for definitions; map driver errors into `AppError` at the boundary.
- `#[tauri::command]` handlers stay **thin**: validate input, delegate to `db/`/`secrets/`, map
  errors. No business logic or SQL in command bodies.
- All blocking work runs on the async runtime or `spawn_blocking`; never block the main thread.
- Public DTOs use `#[serde(rename_all = "camelCase")]` so the JSON matches frontend conventions.

### 5.2 TypeScript / React

- `strict: true`. No `any` (use `unknown` + narrowing). No non-null `!` without justification.
- Function components + hooks only. Keep components small and focused; extract logic into hooks.
- **All Tauri `invoke` calls go through `src/lib/ipc.ts`** with typed signatures — never call
  `invoke` directly from components.
- Server/async state via TanStack Query; transient UI state via Zustand or local state.
- Styling via Tailwind utilities and shadcn/ui primitives. **No hardcoded hex colors** — use
  theme tokens (CSS variables) so the premium dark theme stays consistent.
- ESLint + Prettier are the formatting/lint authority (CI gate).
- Memoize expensive renders; the data grid **must** stay virtualized.

### 5.3 Naming

- Rust: `snake_case` (fns/vars/modules), `PascalCase` (types/traits), `SCREAMING_SNAKE_CASE` (consts).
- TS: `camelCase` (vars/fns), `PascalCase` (components/types), `UPPER_SNAKE_CASE` (consts).
- Files: React components `PascalCase.tsx`; hooks `useThing.ts`; Rust modules `snake_case.rs`.
- Tauri commands: `snake_case` verb-first (`test_connection`, `execute_query`, `get_schema`).

---

## 6. Performance Constraints (hard requirements)

- Cold start < 1s; first interactive paint as early as possible.
- Data grid: virtualized rendering only — DOM nodes proportional to viewport, not row count.
  Must handle 100k+ rows smoothly. Paginate/stream very large result sets from the backend.
- IPC payloads kept lean; stream or page large results rather than shipping everything at once.
- Avoid main-thread blocking on both sides (Rust async + JS off-main work where needed).
- Keep the release bundle small; audit dependency weight before adding anything.

---

## 7. Security Rules

- Secrets only in the OS keyring. Never in config files, logs, error messages, or git.
- Never echo a stored password back to the frontend.
- Parameterize queries the app generates (e.g. grid edits/commits). User-authored SQL in the
  console runs as written, but app-generated DML must be safely constructed.
- SSL/TLS modes are first-class connection options; respect the user's chosen mode.
- SSH tunnel credentials follow the same keyring rules as DB passwords.
- Validate and bound all inputs crossing the IPC bridge.

---

## 8. Build, Run & Test

> Commands are the intended workflow; wire up exact scripts as the project is scaffolded
> and update this section to match reality.

```bash
# Frontend
npm install
npm run dev            # Vite dev server (port 1420)

# Desktop app (Tauri) — runs Rust backend + frontend
npm run tauri dev      # Dev build with HMR
npm run tauri build    # Production bundle

# Linux only: install the Tauri webview/system deps first (macOS/Windows need none):
#   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
#     libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev \
#     build-essential libssl-dev libxdo-dev pkg-config

# Rust quality gates
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test

# Frontend quality gates
npm run lint
npm run typecheck
```

### Integration testing discipline

- After **Module A**, test a real connection to **both** a local PostgreSQL **and** a local
  MySQL instance. Do not defer driver/integration validation to later modules.
- Each phase must compile and run before starting the next.

---

## 9. Phased Build Plan

1. **Phase 1 — Init & Ground Rules:** this `CLAUDE.md`. *(current)*
2. **Phase 2 — Architecture (Plan Mode):** design the `DbClient` trait + JSON serialization plan.
3. **Phase 3 — Implementation (one module per session, validated before moving on):**
   - **Module A — Connection Hub & Secure Manager:** connection workspace UI, keyring storage,
     Test Connection with success/error feedback.
   - **Module B — Multi-Pane Workspace & Schema Tree:** searchable schema tree (tables/views/
     functions) via `get_schema()`, tabbed central workspace, resizable panes.
   - **Module C — High-Performance Data Grid:** virtualized grid, inline cell editing with
     edited-row badges, quick visual filters, batch "Commit Changes" bar.
   - **Module D — SQL Console & Autocomplete:** Monaco editor, multi-tab results/errors,
     schema-aware autocomplete for tables/columns.

---

## 10. Working Agreements for Claude Code

- **Keep this file alive.** When you discover a platform-specific bug (e.g. a Windows-only Rust
  compile error or a macOS styling glitch) and its fix, record the resolution in §11 so it isn't
  repeated.
- Don't over-build. Implement the current module; avoid speculative abstractions.
- Reject bloated components and heavy node modules. If a dependency is questionable, justify it
  here or find a lighter path.
- Each change should compile and run. Prefer small, reviewable commits.
- Match the surrounding code's style, naming, and structure.

---

## 11. Platform Notes & Known Fixes

> Append dated entries as issues are found and resolved. Format:
> `- [YYYY-MM-DD] <platform> — <symptom> → <fix>`

- [2026-06-05] Linux — `cargo check`/`tauri dev` fail without GTK/WebKit system libs
  (`webkit2gtk-4.1` missing) → install the apt packages listed in §8. macOS/Windows need none.
- [2026-06-05] All — `@monaco-editor/react` loads Monaco from a **CDN** by default, which
  breaks the offline desktop app and our strict CSP → bundle it locally: depend on
  `monaco-editor`, configure `self.MonacoEnvironment` + the editor `?worker`, and call
  `loader.config({ monaco })` (see `src/lib/monaco.ts`, imported first in `main.tsx`).
  Imported as `editor.api` + `editor.all` (core contributions — suggest/find/hover, needed for
  the SQL autocomplete widget) + only the SQL basic-language, instead of the full `monaco-editor`
  barrel. This drops the unused language services/grammars (TS/JSON/CSS/HTML + ~15 grammars) from
  the build; the editor core dominates, so the main chunk is ~3.58 MB (~914 KB gzip) — the
  practical floor for a full editor. NOTE: importing only `editor.api` (no `editor.all`) silently
  removes the suggest widget, breaking autocomplete.
- [2026-06-05] All — ESLint 8.57 in this env errors on `eslint . --ext` ("No files
  matching pattern") → the `lint` script uses an explicit glob `"src/**/*.{ts,tsx}"`.
- [2026-06-05] All — TLS uses **native-tls** for both drivers (SChannel/Secure Transport/
  OpenSSL), which fits the cross-platform desktop target. v1 simplifications: SSL `prefer`
  is treated like `disable`; `verifyCa`/`verifyFull` both do full verification (see
  docs/architecture.md §11). Note: `require` accepting an unverified cert matches libpq/MySQL
  `require` semantics (encrypt, don't authenticate) — it is intentional, not a bug.
- [2026-06-06] MySQL — `UPDATE` `affected_rows` counts *changed* rows, not matched ones (0 when
  the new value equals the old). The grid commit guard is therefore engine-aware: Postgres
  treats 0 rows as "row not found" (it always counts matched rows); MySQL only flags `> 1`.
- [2026-06-06] MySQL — datetime values are formatted with a **space** separator (`YYYY-MM-DD
  HH:MM:SS`), not ISO `T`, so they round-trip into DATETIME/TIMESTAMP literals on commit
  (MySQL 5.x rejects the `T` form). Postgres uses RFC-3339/ISO with `T`.
- [2026-06-06] Postgres — `execute_query` uses `prepare_cached` (deadpool per-connection
  statement cache) to avoid a PREPARE round-trip on repeated queries (paging, batch commits).
- [2026-06-06] All — Editing a connection (`update_connection`) **evicts its open pool** so the
  next `connect` rebuilds against the new host/port/credentials; an in-use connection must be
  reopened after editing. Quick-filter `<`/`>` compare numerically on numeric columns (typed
  bind), and as text (lexicographic, correct for ISO dates) otherwise.
- [2026-06-06] Dist — Packaged installers + in-app auto-update via `tauri-plugin-updater`
  (+ `tauri-plugin-process` for relaunch). `bundle.createUpdaterArtifacts: true`; the updater
  `pubkey`/`endpoints` live in `tauri.conf.json` (endpoint = GitHub Releases `latest.json`). The
  `.github/workflows/release.yml` workflow builds/signs all 3 platforms on a `v*` tag. The
  download/verify runs in the Rust plugin (not the webview), so the strict CSP is unchanged. The
  updater public key in config is a **placeholder** until a real key is set; see
  `docs/releasing.md`. Theme: `:root` = light, `.dark` = dark; `useThemeStore` defaults to dark.
- [2026-06-06] Streaming — The SQL console runs via `execute_query_stream`, which streams results
  to the webview over a Tauri `Channel<StreamChunk>` (columns → row batches of `STREAM_BATCH` →
  `done`), capped at `STREAM_MAX_ROWS` (truncated flag). Postgres uses `query_raw`; MySQL iterates
  `QueryResult::next()` — both stream row-by-row without buffering the whole set. The streaming
  command holds an abort-on-drop guard so the DB query stops if the command is cancelled (tab
  closed). The grid still uses paged `execute_query`; app-generated DML/commits stay on it.
- [2026-06-06] SSH — Optional per-connection tunnel (`src-tauri/src/ssh/`, russh). `open_tunnel`
  authenticates to the bastion (password or private key + passphrase) and starts a local
  `127.0.0.1:<ephemeral>` listener that forwards each accepted socket over a `direct-tcpip`
  channel to the DB host; the driver connects to the local addr, so `host`/`port` are overridden
  in `build_connection`. The tunnel is held by `DbConnection` (`_tunnel: Arc<SshTunnel>`) and torn
  down on disconnect (Drop aborts the accept loop, closing the SSH session). SSH secret lives in
  the keyring under `connection:{id}:ssh`; `key_path` (non-secret) is in `connections.json`.
  v1 caveats: the server host key is accepted **without** `known_hosts` verification, `agent` auth
  is unsupported (errors clearly), and over a tunnel the DB sees a `127.0.0.1` peer, so TLS
  `verifyCa`/`verifyFull` will fail hostname checks — pair a tunnel with a non-verifying SSL mode.
  Compile- and clippy-verified; not runtime-tested (no live bastion in CI/sandbox).
- [2026-06-06] Saved Queries — A **read-only** view over query-mcp's snippet store
  (`~/.query-mcp/store.db`, SQLite table `snippets`), read via `rusqlite` (bundled) in
  `src-tauri/src/saved_queries.rs` on `spawn_blocking`. Missing file/table → empty list, never an
  error. Tables++ never writes to that store — query-mcp owns it; if its schema changes, update
  both sides (the same cross-repo coupling as the §4.1 connections.json note, in the other
  direction). [2026-06-07] Moved from a SQL-console toolbar dropdown to a **sidebar group** in
  `SchemaTree` (below Functions, filtered by the sidebar search; snippets are global, not
  per-connection). Clicking one **opens a new query tab** pre-filled with its SQL
  (`openQueryTab({title, sql})`) rather than inserting at the cursor. `refetchOnWindowFocus`
  picks up snippets saved from a Claude session when the app regains focus.
- [2026-06-07] Multi-connection — Several connections can be **open at once** (backend already
  supported it — `PoolRegistry` is a per-id `DashMap`). `useWorkspaceStore` now holds
  `openConnectionIds` + an `activeConnectionId` (the focused connection that drives the sidebar and
  new-tab target) + a `hubOpen` flag; **every tab carries its own `connectionId`**. The header
  `ConnectionSwitcher` switches/disconnects connections and reaches the hub ("Open another…");
  `App` shows the hub when no connection is open or `hubOpen`. The existing **max-2 split** now
  allows the two panes to be **different connections** (compare two DBs side by side); each pane
  renders with its tab's own connection (`PaneContent`), tabs are color-tagged by connection (when
  >1 open), and the sidebar follows the active pane (follow-focus). Autocomplete was a landmine: the
  `SqlConsole` completion provider stored schema in a module-global; it now keys schema **per
  Monaco model URI** (`modelSchemas`) so each editor completes against its own connection. Disconnect
  is per-connection (`closeConnection` drops that connection's tabs and repicks the active one).
- [2026-06-07] Cell viewer — A read-only **full-cell detail dialog** (`src/features/cell/
  CellDetailDialog.tsx`) shows a cell's complete value: pretty-printed JSON, full text, or binary
  as **Base64 ⇄ Hex** (with byte count + truncation note), plus a Copy button (clipboard plugin).
  Opened from a hover **⤢** button on each grid/console cell, and on double-click of non-editable
  cells (json/bytes) in the grid. Closes the loop on the backend's 64 KB display truncation —
  oversized blobs are still capped at `MAX_BYTES` upstream, so the viewer notes "(truncated for
  display)". No backend changes.
- [2026-06-07] Column sort — Clicking a grid header sorts **server-side** (`ORDER BY` in
  `buildSelect`), cycling asc → desc → unsorted, with a header chevron indicator. Sort threads
  through `useTableData` (in the query key) and resets to page 0; it's also applied to the
  full-table **export**. Sort is dropped when switching tables, and changing it clears pending
  edits/inserts/deletes (row indices move). `dir` is a constrained union (never interpolated user
  text); the column is a quoted identifier.
- [2026-06-07] Query history — Every SQL-console run is recorded to a **local, capped** history
  (`useHistoryStore`, last 200, persisted to `localStorage` manually like `useThemeStore` — not the
  Rust config dir; it's not consumed externally). Entries hold `{connectionId, sql, status,
  rowCount, elapsedMs, error, at}` and are written in `SqlConsole.run()` for both success and
  error *before* the mounted guard (so a run still records if the tab closes mid-stream). The
  `HistoryPanel` (toolbar dropdown, `src/features/history/`) is searchable; clicking an entry
  **loads** its SQL into the editor (doesn't auto-run — avoids re-executing DML). No backend/IPC
  changes.
- [2026-06-07] Grid CRUD — The data grid now supports **insert** and **delete** alongside inline
  edits, all staged into the same batch `CommitBar` (counts shown per kind: edited/new/to-delete).
  A leading gutter column holds a delete/restore toggle per existing row (deleted rows render
  struck-through, read-only); an "Add row" button appends draft rows (rendered below the
  virtualized data rows, and scrolled into view on add) whose cells coerce via the **sampled
  column kind** (same approach as the quick filter — unset cells are omitted from the INSERT so DB
  defaults/serials apply). Commit
  order is deletes → updates → inserts; each statement is dropped from its pending set only after
  it succeeds, so a mid-batch failure never re-inserts/re-applies on retry. Inserts don't require a
  PK; edits/deletes still do (the no-PK warning only fires when those are pending). Builders live
  in `sql.ts` (`buildInsert`/`buildDelete`, parameterized like `buildUpdate`).
- [2026-06-07] Export — Result sets export to **CSV/JSON** and copy to the clipboard as **TSV**
  (`src/lib/export.ts` serializers; `src/features/export/`). Two scopes: the **grid** exports the
  whole *filtered* table by streaming the unpaged generated `SELECT` via `execute_query_stream`
  (safe to re-run), while the **SQL console** exports the in-memory result *as shown* — it never
  re-runs the console SQL, which could be DML. Both inherit the `STREAM_MAX_ROWS` cap (export
  surfaces the truncation). The native save dialog comes from `tauri-plugin-dialog` (`save()`),
  clipboard from `tauri-plugin-clipboard-manager`, and the file write from `tauri-plugin-fs`
  (`writeTextFile`). Tauri v2's dialog **grants the picked path to the fs scope at runtime**, so
  the webview writes only to the file the user chose — no arbitrary-write command is exposed (we
  deliberately avoid a custom `write_text_file` for that reason). New capabilities:
  `dialog:allow-save`, `clipboard-manager:allow-write-text`, `fs:allow-write-text-file`. Plugins
  run over IPC, so the strict CSP is unchanged.
- [2026-06-06] AI — Optional, bring-your-own-key SQL assistant (Text-to-SQL / Explain / Fix).
  Provider calls run in the **Rust backend** via `reqwest` (not the webview), so the strict CSP
  needs no `connect-src` exception; the API key lives in the OS keyring (`ai:{provider}:apiKey`),
  provider+model in `ai.json`. Anthropic requests omit `temperature`/`thinking` (removed on the
  latest Opus models) and default to model `claude-opus-4-8`; OpenAI/OpenRouter use the
  OpenAI-compatible `/chat/completions` shape. The frontend builds a compact schema context for
  Text-to-SQL and strips Markdown fences from the model output.
- [2026-06-08] Column resize — Grid columns are drag-resizable via a right-edge handle on each
  header (`ColumnResizeHandle`, pointer-capture so the drag/click never triggers the column's
  sort button). Widths persist per `connectionId/schema/table` in localStorage
  (`useColumnWidthsStore`, same pattern as history), default 184px / min 80px, applied to header,
  body cells, and draft insert rows. `totalWidth` is now the sum of per-column widths, not
  `cols * COL_WIDTH`.
- [2026-06-08] FK jump — Schema introspection surfaces **single-column** foreign keys
  (`ForeignKeyRef` on `ColumnInfo`; PG joins `constraint_column_usage`, MySQL reads
  `KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL`). Composite FKs are intentionally
  skipped (constraint_column_usage can mis-pair them). FK cells show an always-visible ↗ arrow
  that opens the referenced table in a new tab pre-filtered to `referencedColumn = value`.
  `openTableTab(table, filter?)` carries the filter onto the tab (`tableFilter` + `filterRev` so
  a re-jump re-applies to an already-open tab); `DataGrid` seeds its filter from it. The jump
  first calls `setActiveConnection(connection.id)` so it lands on the right connection even from
  a non-focused split pane.
- [2026-06-08] Database switcher — A header `DatabaseSwitcher` lists the server's databases
  (`list_databases` command: PG `pg_database` non-template/connectable, MySQL `SHOW DATABASES`)
  and opens another as a **session connection**: `open_database(rootId, database)` builds a pool
  reusing the parent (persisted) connection's keyring secret under a derived id
  `{rootId}::db::{database}`, returns a non-persisted `ConnectionConfig`. The frontend tracks
  these in `useWorkspaceStore.sessionConnections` (`{config, rootId}`); `useAllConnections()`
  merges them with the saved list so every `connFor`/`byId` lookup resolves them. Picking the
  persisted connection's own database just refocuses it (no session dupe). Session connections
  vanish on disconnect (closeConnection filters them) and on app quit (never persisted).
  `DbConnection::engine()` accessor added so `list_databases` picks engine SQL without the store.
  Also: the connection switcher's Disconnect (power) button is now always visible, not hover-only.
- [2026-06-08] Connection import/export — Share connections as a JSON file. **Metadata only —
  secrets are never written** (passwords/SSH secrets stay in the keyring per §7); the recipient
  enters the password on first connect. Frontend-only (`src/features/connections/
  connectionShare.ts`): export strips the local `id`, wraps configs in a versioned envelope
  `{ tablesplusplus: "connections", version: 1, connections: [...] }`, and writes via the dialog
  `save()` + `fs.writeTextFile` (default name `<label>.tablesplus.json`). Import uses dialog
  `open()` + `fs.readTextFile`, validates the envelope (marker/version/fields, engine, sslMode,
  ssh) and feeds each through the existing `save_connection` command (which mints a fresh id and
  leaves the secret empty) via `useImportConnections` (sequential, to avoid racing
  connections.json). The Connection Hub gets an Import button (header) + per-connection Export
  button; after import the first one opens in the edit form so the password field is right there.
  New capabilities: `dialog:allow-open`, `fs:allow-read-text-file`. No backend code added.
  Caveat: `ssh.keyPath` travels as the sharer's local path; SSH connections need the recipient to
  fix it. No dedup — re-importing makes another saved connection.
- [2026-06-23] Postgres — committing a grid edit on a **`uuid`** column (and any other
  non-natively-bound type) failed with `db error — SQLSTATE 22P03` (invalid_binary_representation).
  Root cause: tokio-postgres binds params in **binary**, and `ToSql for CellValue` declares
  `accepts(_) -> true` (bypassing the driver's per-type guard), so a `CellValue::Text` whose target
  column isn't text-binary-compatible got its UTF-8 bytes mis-read as that type's binary layout.
  `pg_cell` lowers `uuid`, enums, arrays, `inet`/`cidr`, `interval`, `timetz`, ranges, `money`, etc.
  to `CellValue::Text`, so all of them broke on commit. **Two-part fix:**
  (1) `ToSql for CellValue` re-parses the string to a `uuid::Uuid` when `ty == Type::UUID` (uuid
  has an exact 16-byte binary codec, so bind it natively — fast path, covers SET/WHERE/INSERT/DELETE).
  (2) For every other non-native type, the grid casts the param in SQL: `$n::text::"schema"."type"`,
  binding the value **as text** so Postgres coerces it via the type's own input function. This needs
  the column's PG type *name + schema*, now carried on `ColumnMeta` (`type_schema` added; populated
  from `Type::schema()` on PG, empty on MySQL). The frontend builders (`sql.ts` `bindParam`) skip
  the cast for an allowlist of natively-bound types (`PG_NATIVE_TYPES`: bool/int*/float*/numeric/
  text/varchar/uuid/timestamp*/date/time/json*) and cast everything else; `DataGrid` threads each
  result column's `dataType`/`typeSchema` into the SET/WHERE/INSERT `ColumnValue`s. MySQL is
  untouched (the cast path is gated on `engine === "postgres"`; MySQL coerces string params itself).
  Note: `varchar[]`/array cells currently *display* as a `<_typename>` placeholder (the `_ =>` arm of
  `pg_cell` can't render arrays as a String) — a separate read-side gap; the write path is now safe.
