import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ConnectionConfig,
  ConnectionInput,
  Engine,
  SshAuthMethod,
  SshConfig,
  SslMode,
} from "@/lib/types";

/** Versioned envelope for shared connection files. Holds only NON-SECRET metadata — passwords and
 *  SSH secrets live in the OS keyring and are never exported (CLAUDE.md §7). The recipient enters
 *  the password on first connect. */
interface ConnectionExportFile {
  /** Format marker so import can reject unrelated JSON. */
  tablesplusplus: "connections";
  version: 1;
  connections: SharedConnection[];
}

/** A connection's shareable fields — everything in `ConnectionConfig` except its local `id`. */
type SharedConnection = Omit<ConnectionConfig, "id">;

const ENGINES: Engine[] = ["postgres", "mysql"];
const SSL_MODES: SslMode[] = ["disable", "prefer", "require", "verifyCa", "verifyFull"];
const SSH_AUTH_METHODS: SshAuthMethod[] = ["password", "agent", "key"];

/** Export connections to a JSON file the user picks. Secrets are never included. Returns the
 *  written path, or null if the save dialog was cancelled. */
export async function exportConnections(
  configs: ConnectionConfig[],
  defaultName: string,
): Promise<string | null> {
  const file: ConnectionExportFile = {
    tablesplusplus: "connections",
    version: 1,
    // Drop the local `id` — the recipient mints a fresh one on import.
    connections: configs.map(({ id: _id, ...rest }) => rest),
  };
  const path = await save({
    defaultPath: `${defaultName}.tablesplus.json`,
    filters: [{ name: "Tables++ Connections", extensions: ["json"] }],
  });
  if (!path) return null;
  // The dialog grants this exact path to the fs scope (Tauri v2), so no broad write permission.
  await writeTextFile(path, JSON.stringify(file, null, 2));
  return path;
}

/** Prompt for a connection file and parse it into importable inputs (secrets left empty, to be
 *  entered on first connect). Returns null if the open dialog was cancelled. Throws with a clear
 *  message on a malformed/unrelated file. */
export async function importConnectionsFile(): Promise<ConnectionInput[] | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Tables++ Connections", extensions: ["json"] }],
  });
  if (picked === null) return null;
  const path = Array.isArray(picked) ? picked[0] : picked;
  const raw = await readTextFile(path);
  return parseConnectionsFile(raw);
}

/** Validate + map a connection-file's contents into `ConnectionInput`s. Exported (not just used
 *  by `importConnectionsFile`) so the parsing/validation is unit-testable without the fs plugin. */
export function parseConnectionsFile(raw: string): ConnectionInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isRecord(parsed) || parsed.tablesplusplus !== "connections") {
    throw new Error("This doesn't look like a Tables++ connections file.");
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported connections-file version: ${String(parsed.version)}.`);
  }
  if (!Array.isArray(parsed.connections) || parsed.connections.length === 0) {
    throw new Error("The file contains no connections.");
  }
  return parsed.connections.map((c, i) => toConnectionInput(c, i));
}

function toConnectionInput(value: unknown, index: number): ConnectionInput {
  const at = `Connection #${index + 1}`;
  if (!isRecord(value)) throw new Error(`${at} is not a valid object.`);
  const engine = value.engine;
  if (typeof engine !== "string" || !ENGINES.includes(engine as Engine)) {
    throw new Error(`${at} has an invalid engine (expected postgres or mysql).`);
  }
  const sslMode = value.sslMode;
  if (typeof sslMode !== "string" || !SSL_MODES.includes(sslMode as SslMode)) {
    throw new Error(`${at} has an invalid sslMode.`);
  }
  const port = value.port;
  if (typeof port !== "number" || !Number.isInteger(port)) {
    throw new Error(`${at} has an invalid port.`);
  }
  for (const key of ["host", "user", "database"] as const) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`${at} is missing "${key}".`);
    }
  }
  return {
    engine: engine as Engine,
    host: value.host as string,
    port,
    user: value.user as string,
    database: value.database as string,
    sslMode: sslMode as SslMode,
    // SSH config is non-secret (the key passphrase isn't included); keyPath points at the
    // sharer's machine, so the recipient may need to fix it. Validate it if present.
    ssh: value.ssh == null ? null : toSshConfig(value.ssh, at),
    label: typeof value.label === "string" ? value.label : null,
    color: typeof value.color === "string" ? value.color : null,
    // Secrets are never in the file — the recipient enters them on first connect.
    password: null,
    sshSecret: null,
  };
}

function toSshConfig(value: unknown, at: string): SshConfig {
  if (!isRecord(value)) throw new Error(`${at} has an invalid ssh config.`);
  const authMethod = value.authMethod;
  if (typeof authMethod !== "string" || !SSH_AUTH_METHODS.includes(authMethod as SshAuthMethod)) {
    throw new Error(`${at} has an invalid ssh.authMethod.`);
  }
  if (typeof value.host !== "string" || value.host === "") {
    throw new Error(`${at} is missing ssh.host.`);
  }
  if (typeof value.port !== "number" || !Number.isInteger(value.port)) {
    throw new Error(`${at} has an invalid ssh.port.`);
  }
  if (typeof value.user !== "string") {
    throw new Error(`${at} is missing ssh.user.`);
  }
  return {
    host: value.host,
    port: value.port,
    user: value.user,
    authMethod: authMethod as SshAuthMethod,
    keyPath: typeof value.keyPath === "string" ? value.keyPath : null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
