import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { CellValue, ColumnMeta } from "@/lib/types";
import { rowsToCsv, rowsToJson, rowsToTsv } from "@/lib/export";

export type ExportFormat = "csv" | "json";

/**
 * Prompt for a destination via the native save dialog, then write the rows as CSV/JSON.
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
  const path = await save({
    defaultPath: `${defaultName}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return null;
  const contents = format === "csv" ? rowsToCsv(columns, rows) : rowsToJson(columns, rows);
  // The dialog's save() grants this exact path to the fs scope, so writeTextFile can write it
  // without broad filesystem permissions (Tauri v2). No arbitrary-write command is exposed.
  await writeTextFile(path, contents);
  return path;
}

/** Copy rows (with header) to the clipboard as TSV. */
export function copyRowsToClipboard(columns: ColumnMeta[], rows: CellValue[][]): Promise<void> {
  return writeText(rowsToTsv(columns, rows));
}
