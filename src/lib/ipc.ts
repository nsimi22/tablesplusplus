/**
 * Thin, typed wrappers over Tauri `invoke`. ALL IPC goes through this module —
 * components never call `invoke` directly (CLAUDE.md §5.2).
 *
 * Command names are snake_case verb-first to match the Rust #[tauri::command]
 * handlers (CLAUDE.md §5.3).
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  AiSettingsInput,
  ConnectionConfig,
  ConnectionInput,
  QueryResult,
  Schema,
  StreamChunk,
} from "@/lib/types";

/** List all saved connections (non-secret metadata only). */
export function listConnections(): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>("list_connections");
}

/** Persist a new connection; password (if any) is written to the OS keyring. */
export function saveConnection(input: ConnectionInput): Promise<ConnectionConfig> {
  return invoke<ConnectionConfig>("save_connection", { input });
}

/** Update an existing connection. A null password leaves the stored secret untouched. */
export function updateConnection(
  id: string,
  input: ConnectionInput,
): Promise<ConnectionConfig> {
  return invoke<ConnectionConfig>("update_connection", { id, input });
}

/** Delete a connection and its keyring secrets. */
export function deleteConnection(id: string): Promise<void> {
  return invoke<void>("delete_connection", { id });
}

/**
 * Validate credentials/tunnel with a trivial round-trip. When `input` is provided,
 * the not-yet-saved form values are tested (using the typed password); pass `id`
 * alongside it when editing so blank secret fields fall back to the stored keyring
 * secrets. Without `input`, the stored `id` is tested against its keyring secret.
 */
export function testConnection(args: {
  id?: string;
  input?: ConnectionInput;
}): Promise<void> {
  return invoke<void>("test_connection", args);
}

/** Open a pooled (optionally tunneled) connection and register it. */
export function connect(id: string): Promise<void> {
  return invoke<void>("connect", { id });
}

/** Close the pool and tear down any tunnel. */
export function disconnect(id: string): Promise<void> {
  return invoke<void>("disconnect", { id });
}

/** Introspect tables/views/routines for a connected database. */
export function getSchema(id: string): Promise<Schema> {
  return invoke<Schema>("get_schema", { id });
}

/**
 * Run SQL against a connected database. `params` carries bind values so
 * app-generated DML is parameterized; pass [] for user-authored SQL (CLAUDE.md §7).
 */
export function executeQuery(args: {
  id: string;
  sql: string;
  params?: import("@/lib/types").CellValue[];
}): Promise<QueryResult> {
  return invoke<QueryResult>("execute_query", {
    id: args.id,
    sql: args.sql,
    params: args.params ?? [],
  });
}

/**
 * Stream a query's results: `onChunk` receives `columns`, then `rows` batches, then `done`.
 * Resolves when the stream completes; rejects on error (after any partial chunks).
 */
export function executeQueryStream(
  args: { id: string; sql: string; params?: import("@/lib/types").CellValue[] },
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  const channel = new Channel<StreamChunk>();
  channel.onmessage = onChunk;
  return invoke<void>("execute_query_stream", {
    id: args.id,
    sql: args.sql,
    params: args.params ?? [],
    onEvent: channel,
  });
}

/** Write text to an absolute path (chosen via the native save dialog) — used by data export. */
export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}

// ---- AI assistant ----

/** Current AI provider/model and whether a key is stored (never returns the key). */
export function getAiSettings(): Promise<AiSettings> {
  return invoke<AiSettings>("get_ai_settings");
}

/** Save provider/model; a non-empty `apiKey` is written to the OS keyring. */
export function saveAiSettings(input: AiSettingsInput): Promise<AiSettings> {
  return invoke<AiSettings>("save_ai_settings", {
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
  });
}

/** Run a single completion (system + prompt → text) via the configured provider. */
export function aiGenerate(args: { system: string; prompt: string }): Promise<string> {
  return invoke<string>("ai_generate", { system: args.system, prompt: args.prompt });
}
