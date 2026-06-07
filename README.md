<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.png">
    <img src="docs/assets/wordmark-light.png" alt="Tables++" height="96">
  </picture>
</p>

> An open-source, ultra-fast, **native** desktop database client — inspired by
> [TablePlus](https://tableplus.com). Built with **Tauri 2 + Rust** and **React + TypeScript**.

Tables++ is a lightweight, premium-feeling GUI for **PostgreSQL** and **MySQL** on macOS and
Windows (Linux is a best-effort target). It aims for instant startup, a tiny footprint, and a
data grid that stays smooth at 100,000+ rows — with secrets kept in your OS keyring and an
optional, bring-your-own-key AI assistant for SQL.

---

## Contents

- [Features](#features)
- [Supported databases](#supported-databases)
- [Install](#install)
- [Auto-updates](#auto-updates)
- [The AI assistant](#the-ai-assistant)
- [UI at a glance](#ui-at-a-glance)
- [Security model](#security-model)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Development](#development)
- [Releasing](#releasing)
- [Status & roadmap](#status--roadmap)
- [License](#license)

---

## Features

- **Connection hub** — manage connections with a clean form and a one-click **Test Connection**.
  Passwords are stored in the OS keyring, never on disk.
- **Multi-pane workspace** — a searchable schema tree (tables / views / functions), a tabbed
  center, and resizable panes. Open many tables/queries at once, and **split two side by side**.
- **High-performance data grid** — virtualized rendering for 100k+ rows, **inline cell editing**
  with edited-row highlights, **quick filters**, and a batch **Commit Changes** bar that runs
  safe, parameterized `UPDATE`s keyed on the primary key.
- **SQL console** — Monaco editor with SQL highlighting and **schema-aware autocomplete**, run
  the selection or the whole buffer (⌘/Ctrl + Enter), and a virtualized results / error view.
- **AI SQL assistant (optional)** — bring your own **Anthropic / OpenAI / OpenRouter** key to
  **generate** SQL from natural language, **explain** a query, or **fix** a failed one — all
  schema-aware.
- **Saved Queries** — queries saved from Claude sessions via
  [query-mcp](https://github.com/completesolar/query-mcp) (`save_snippet`) appear in the SQL
  console's Saved Queries menu; one click inserts them at the cursor.
- **Dark & light themes** — a refined low-contrast dark mode by default, with a one-click toggle.
- **Native packaging + auto-update** — ships as a per-platform installer and updates itself in
  place via Tauri's signed updater.

## Supported databases

| Engine | Driver | Notes |
|--------|--------|-------|
| **PostgreSQL** | `tokio-postgres` + `deadpool` | Async, pooled; `prepare_cached` for repeated queries. |
| **MySQL** | `mysql_async` | Async; the driver's built-in pool. |

SSL/TLS modes are first-class per connection (via `native-tls`), and each connection can
optionally tunnel through an **SSH bastion** (password or private-key auth) — see the v1
caveats in [Status & roadmap](#status--roadmap).

## Install

Pre-built installers are attached to each
[GitHub Release](https://github.com/nsimi22/tablesplusplus/releases) — current version: **v0.1.1**.

| Platform | Download |
|----------|----------|
| macOS (universal — Apple Silicon + Intel) | [`.dmg`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B_0.1.1_universal.dmg) |
| Windows | [`.msi`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B_0.1.1_x64_en-US.msi) / [`.exe`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B_0.1.1_x64-setup.exe) |
| Linux | [`.AppImage`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B_0.1.1_amd64.AppImage) / [`.deb`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B_0.1.1_amd64.deb) / [`.rpm`](https://github.com/nsimi22/tablesplusplus/releases/download/v0.1.1/Tables%2B%2B-0.1.1-1.x86_64.rpm) |

The macOS build is **signed and notarized**; once installed, the app keeps itself current via
[auto-updates](#auto-updates), so these links only matter the first time.

> The **Windows** build is currently unsigned, so SmartScreen shows a one-time warning
> ("More info → Run anyway"). macOS builds are Developer ID-signed and notarized — no warning.

Prefer building it yourself? See [Development](#development).

## Auto-updates

On launch the app checks the release feed and, when a newer **signed** build exists, shows an
**“Update available → Install & Restart”** prompt. The download and signature verification happen
in the Rust updater plugin (not the webview), so the strict CSP is unaffected and a tampered
update is rejected. Configuration lives in `src-tauri/tauri.conf.json` (`plugins.updater`);
the release flow and signing-key setup are in [`docs/releasing.md`](./docs/releasing.md).

## The AI assistant

Entirely **opt-in** — with no key configured, nothing is sent anywhere and the console behaves
normally. Open the **✨ / ⚙ AI settings**, pick a provider, paste a key, and you get three tools
in the SQL console:

| Tool | What it does |
|------|--------------|
| **Generate** | Natural-language request → a single SQL query inserted at your cursor. |
| **Explain** | Plain-English summary of the selected (or full) query. |
| **Fix** | Repairs a query that just errored, using the database's error message. |

How it works and what's sent:

- Provider calls run in the **Rust backend** (`reqwest`), so your **key stays in the OS keyring**,
  off the webview, and the CSP needs no exception.
- Requests include a **compact schema context** (table/column names) and, for **Fix**, the error
  message — **query results are never sent**. The AI **never executes SQL**; it only writes into
  the editor, and you press **Run**.
- Defaults: Anthropic `claude-opus-4-8`, OpenAI `gpt-4o`, OpenRouter `anthropic/claude-sonnet-4-6`
  (all editable). Anthropic uses `/v1/messages`; OpenAI/OpenRouter use the OpenAI-compatible
  `/chat/completions` shape.

## UI at a glance

```
Connection Hub                          │  Workspace
┌──────────────┬───────────────────┐    │  ┌───────────────────────────────────────────┐
│ Tables++ ☀✨＋│  New Connection   │    │  │ Prod PG  PostgreSQL · db:5432/app  ☀ ⌨ ⎋ │
│ CONNECTIONS  │  [ form: host,    │    │  ├──────────┬────────────────────────────────┤
│ ● Prod PG PG │   port, user,     │    │  │ search…  │ users  Query 1            ＋   │
│   ⚡ 🗑       │   password, SSL,  │    │  │ ▾ TABLES │  (data grid or SQL console;   │
│ ● Local MySQL│   color ]         │    │  │   users  │   split two tabs side by side)│
│              │  [Test] [Create]  │    │  │ ▾ VIEWS  │                                │
└──────────────┴───────────────────┘    │  └──────────┴────────────────────────────────┘
```

The SQL console toolbar: `✨ [Ask AI to write SQL…] [Generate] [Explain] [Fix]  …  ⚙  ▶ Run`.

## Security model

- **Secrets only in the OS keyring** — DB passwords (`connection:{id}:password`) and AI keys
  (`ai:{provider}:apiKey`) live in Keychain / Credential Manager / Secret Service. Never in config
  files, logs, or git; never echoed back to the UI (edit shows a masked placeholder).
- **Parameterized DML** — app-generated writes (grid commits) are always bound parameters, never
  string-interpolated. User-authored console SQL runs as written.
- **Strict CSP** — the webview is `default-src 'self'`; database, AI, and update traffic all
  originate in the Rust backend, so no `connect-src` exceptions are needed.
- **Signed updates** — update payloads are verified against a public key baked into the app.

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 (Rust) |
| Backend | Rust (2021), tokio, deadpool/mysql_async, keyring, reqwest (rustls) |
| Frontend | React 18 + TypeScript (strict), Vite |
| Styling | TailwindCSS + design tokens (shadcn-style primitives) |
| State | Zustand (UI) + TanStack Query (server state) |
| Data grid | `@tanstack/react-virtual` |
| SQL editor | Monaco (bundled locally — no CDN) |
| Layout | `react-resizable-panels` |

## Project structure

```
tablesplusplus/
├── src/                       # React frontend
│   ├── lib/                   # ipc.ts (all Tauri invoke), types.ts (DTO mirrors)
│   ├── components/ui/         # shadcn-style primitives + ThemeToggle/Dialog
│   ├── features/              # connections, workspace, grid, editor, ai, updates
│   └── store/                 # Zustand stores (workspace, theme)
├── src-tauri/                 # Rust backend
│   └── src/
│       ├── commands/          # #[tauri::command] handlers (thin)
│       ├── db/                # DbClient trait, postgres/mysql, pool registry
│       ├── secrets/           # keyring wrapper
│       ├── ai/                # provider gateway
│       └── config/            # connections.json + ai.json stores
├── docs/                      # architecture.md, releasing.md
└── .github/workflows/         # release.yml
```

See [`CLAUDE.md`](./CLAUDE.md) for the full engineering guide and
[`docs/architecture.md`](./docs/architecture.md) for the driver/IPC design.

## Development

**Prerequisites:** Node 20+, Rust (stable). On **Linux**, install the Tauri system libraries
first (macOS/Windows need none):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev \
  build-essential libssl-dev libxdo-dev pkg-config
```

```bash
npm install
npm run tauri dev      # run the desktop app (Rust backend + Vite frontend, HMR)
npm run tauri build    # production installers

# Quality gates
npm run typecheck && npm run lint && npm run build
(cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

## Releasing

Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`, which builds and signs installers for
all three platforms and publishes a **draft** GitHub Release with the updater manifest.

> Bump the version in **all three** of `package.json`, `src-tauri/Cargo.toml`, and
> `src-tauri/tauri.conf.json` before tagging.

Full instructions — including the updater signing key and optional OS code-signing — are in
[`docs/releasing.md`](./docs/releasing.md).

## Status & roadmap

**Done:** connection management + keyring, schema tree, virtualized grid with editing/commit,
SQL console with autocomplete, AI assistant, SSH tunneling, dark/light themes,
packaging + auto-update.

**Not yet implemented / known limitations:**
- **SSH tunneling** v1 caveats: the bastion's host key is accepted **without** `known_hosts`
  verification, `agent` auth isn't supported (password / private key only), and over a tunnel
  the database sees a `127.0.0.1` peer — so pair a tunnel with a non-verifying SSL mode
  (`verifyCa`/`verifyFull` will fail hostname checks).
- **TLS** v1 simplifications: `prefer` is treated like `disable`; `verifyCa`/`verifyFull` both do
  full verification (`require` encrypts without authenticating, matching libpq/MySQL semantics).
- Large result sets are **paged**; a streaming/cursor protocol is a future optimization.
- The bundled Monaco core is the largest chunk; trimming it to editor-core + SQL is open.

## License

[MIT](./LICENSE).
