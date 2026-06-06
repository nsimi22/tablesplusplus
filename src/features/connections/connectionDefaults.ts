import type { ConnectionInput, Engine, SslMode } from "@/lib/types";

export const DEFAULT_PORTS: Record<Engine, number> = {
  postgres: 5432,
  mysql: 3306,
};

export const SSL_MODES: { value: SslMode; label: string }[] = [
  { value: "disable", label: "Disable" },
  { value: "prefer", label: "Prefer" },
  { value: "require", label: "Require" },
  { value: "verifyCa", label: "Verify CA" },
  { value: "verifyFull", label: "Verify Full" },
];

export const ENGINES: { value: Engine; label: string }[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
];

/** Accent swatches for connection labels (theme tokens, not arbitrary hex). */
export const CONNECTION_COLORS = [
  "primary",
  "success",
  "warning",
  "destructive",
] as const;

/** Maps a connection color name to its Tailwind background class (static so the content
 *  scanner keeps these utilities). Single source of truth for swatches and list dots. */
export const CONNECTION_COLOR_CLASS: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

export function emptyConnectionInput(): ConnectionInput {
  return {
    engine: "postgres",
    host: "localhost",
    port: DEFAULT_PORTS.postgres,
    user: "",
    database: "",
    sslMode: "prefer",
    ssh: null,
    label: "",
    color: "primary",
    password: "",
  };
}
