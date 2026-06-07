import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { CellValue, ColumnMeta } from "@/lib/types";
import { rowsToCsv, rowsToJson, rowsToTsv } from "@/lib/export";

export type ExportFormat = "csv" | "json";

/** Prompt for a destination via the native save dialog. Returns the path, or `null` if cancelled. */
export function chooseExportPath(format: ExportFormat, defaultName: string): Promise<string | null> {
  return save({
    defaultPath: `${defaultName}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
}

/** Serialize rows to `format` and write them to an already-chosen path. */
export function writeRowsToPath(
  path: string,
  columns: ColumnMeta[],
  rows: CellValue[][],
  format: ExportFormat,
): Promise<void> {
  const contents = format === "csv" ? rowsToCsv(columns, rows) : rowsToJson(columns, rows);
  // The dialog's save() grants this exact path to the fs scope, so writeTextFile can write it
  // without broad filesystem permissions (Tauri v2). No arbitrary-write command is exposed.
  return writeTextFile(path, contents);
}

/**
 * Prompt for a destination and write the (already in-memory) rows as CSV/JSON.
 * Returns the chosen path, or `null` if the user cancelled the dialog.
 */
export async function exportRowsToFile(args: {
  columns: ColumnMeta[];
  rows: CellValue[][];
  format: ExportFormat;
  /** Suggested file name (without extension). */
  defaultName: string;
}): Promise<string | null> {
  const { columns, rows, format, defaultName } = args;
  const path = await chooseExportPath(format, defaultName);
  if (!path) return null;
  await writeRowsToPath(path, columns, rows, format);
  return path;
}

/** Copy rows (with header) to the clipboard as TSV. */
export function copyRowsToClipboard(columns: ColumnMeta[], rows: CellValue[][]): Promise<void> {
  return writeText(rowsToTsv(columns, rows));
}
