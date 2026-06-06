# Tables++

An open-source, ultra-fast, premium desktop database GUI client — inspired by
[TablePlus](https://tableplus.com). Built with **Tauri 2 + Rust** and **React + TypeScript**,
targeting **PostgreSQL** and **MySQL** on macOS and Windows (Linux is a best-effort target).

## Highlights

- **Connection Hub** — manage connections with a clean form; secrets are stored in the OS
  keyring (Keychain / Credential Manager / Secret Service), never on disk. One-click
  **Test Connection** with success/error feedback.
- **Multi-pane workspace** — searchable schema tree (tables / views / functions), a tabbed
  center, and resizable panes.
- **High-performance data grid** — virtualized rendering for 100k+ rows, inline cell editing
  with edited-row highlights, quick visual filters, and a batch **Commit Changes** bar that
  runs parameterized `UPDATE`s.
- **SQL console** — Monaco editor with SQL highlighting and schema-aware autocomplete,
  plus a virtualized results / error view.
- **AI assistant (optional, bring-your-own-key)** — drop in an **Anthropic**, **OpenAI**, or
  **OpenRouter** key (stored in the OS keyring) to generate SQL from natural language,
  **explain** a query, or **fix** a failed one — all schema-aware, right in the console.

## Architecture

A Rust backend exposes a small, typed Tauri IPC surface. Every query result is lowered into a
generic, serde-serializable DTO (`QueryResult` / `CellValue`) before crossing the bridge, so
the React frontend is fully decoupled from the database drivers. The engine abstraction uses
enum dispatch (`DbConnection`) over the `DbClient` trait, with connection pooling and a
keyring-backed secret store.

See [`CLAUDE.md`](./CLAUDE.md) for the engineering guide and
[`docs/architecture.md`](./docs/architecture.md) for the driver/IPC design.

## Develop

```bash
npm install
npm run tauri dev      # run the desktop app (Rust backend + Vite frontend)

# quality gates
npm run typecheck && npm run lint && npm run build
(cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings)
```

> **Linux:** install the Tauri system dependencies first (see `CLAUDE.md` §8). macOS and
> Windows need no extra system libraries.

## License

See [`LICENSE`](./LICENSE).
