/**
 * TypeScript mirror of the Rust DTOs in src-tauri/src/db/client.rs and error.rs.
 * MUST be kept in sync with the Rust definitions (CLAUDE.md §4.3, docs/architecture.md §4).
 * Wire format is camelCase (Rust uses #[serde(rename_all = "camelCase")]).
 */

export type Engine = "postgres" | "mysql";

export type SslMode = "disable" | "prefer" | "require" | "verifyCa" | "verifyFull";

export interface SshConfig {
  host: string;
  port: number;
  user: string;
  /** "password" | "agent" | "key"; secret material is stored in the keyring, never here. */
  authMethod: "password" | "agent" | "key";
}

/** Non-secret connection metadata. The password lives only in the OS keyring. */
export interface ConnectionConfig {
  id: string;
  engine: Engine;
  host: string;
  port: number;
  user: string;
  database: string;
  sslMode: SslMode;
  ssh: SshConfig | null;
  label: string | null;
  color: string | null;
}

/** Payload for creating/updating a connection — the password crosses the bridge inbound only. */
export interface ConnectionInput {
  engine: Engine;
  host: string;
  port: number;
  user: string;
  database: string;
  sslMode: SslMode;
  ssh: SshConfig | null;
  label: string | null;
  color: string | null;
  /** Plaintext password; backend writes it to the keyring and never echoes it back. */
  password: string | null;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
}

/** Base64 (possibly truncated) binary payload — mirrors Rust `BytesCell`. */
export interface BytesCell {
  data: string;
  truncated: boolean;
}

/**
 * Adjacently-tagged union mirroring the Rust `CellValue` enum
 * (#[serde(tag = "kind", content = "value")]). The `bytes` variant nests a
 * `BytesCell` carrying the truncation flag for large blobs (docs/architecture.md §4.1, §8).
 */
export type CellValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "float"; value: number }
  | { kind: "decimal"; value: string }
  | { kind: "text"; value: string }
  | { kind: "bytes"; value: BytesCell }
  | { kind: "dateTime"; value: string }
  | { kind: "json"; value: unknown };

export interface QueryResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
  rowsAffected: number | null;
  elapsedMs: number;
}

export type TableKind = "table" | "view";
export type RoutineKind = "function" | "procedure";

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
  columns: ColumnInfo[];
}

export interface RoutineInfo {
  schema: string;
  name: string;
  kind: RoutineKind;
}

export interface Schema {
  tables: TableInfo[];
  views: TableInfo[];
  routines: RoutineInfo[];
}

/** Structured error payload mirroring Rust `AppError` (docs/architecture.md §9). */
export type AppErrorKind =
  | "connection"
  | "auth"
  | "query"
  | "schema"
  | "keyring"
  | "ssh"
  | "tunnel"
  | "serialization"
  | "timeout"
  | "notFound"
  | "internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
  detail?: string | null;
}

/** Type guard for the structured error payload thrown across `invoke`. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as AppError).message === "string"
  );
}

/** Render any thrown IPC value as a human-readable string. */
export function errorMessage(value: unknown): string {
  if (isAppError(value)) {
    return value.detail ? `${value.message} — ${value.detail}` : value.message;
  }
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "An unexpected error occurred.";
}
