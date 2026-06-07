/**
 * Result-set serializers for data export. Operate on the in-memory `ColumnMeta[]` + `CellValue[][]`
 * shape (the same DTO the grid/console already hold), so export is decoupled from the driver.
 */
import type { CellValue, ColumnMeta } from "@/lib/types";

/** Plain-text rendering of a cell for CSV/TSV. NULL renders as empty; bytes as base64. */
export function cellToText(cell: CellValue): string {
  switch (cell.kind) {
    case "null":
      return "";
    case "bool":
      return cell.value ? "true" : "false";
    case "int":
    case "float":
      return String(cell.value);
    case "decimal":
    case "text":
    case "dateTime":
      return cell.value;
    case "bytes":
      return cell.value.data; // base64 (possibly truncated)
    case "json":
      return JSON.stringify(cell.value);
  }
}

/** Natural JSON value of a cell for JSON export (preserves numbers/bools/null and nested JSON). */
export function cellToJson(cell: CellValue): unknown {
  switch (cell.kind) {
    case "null":
      return null;
    case "bool":
    case "int":
    case "float":
      return cell.value;
    case "decimal":
    case "text":
    case "dateTime":
      return cell.value;
    case "bytes":
      return cell.value.data;
    case "json":
      return cell.value;
  }
}

// A field needs quoting if it contains the delimiter, a quote, or a newline (RFC 4180).
const CSV_NEEDS_QUOTE = /[",\r\n]/;

function csvField(value: string): string {
  return CSV_NEEDS_QUOTE.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Index by the header columns (not the row) so a short/ragged row can't shift columns or read
// past the end — a missing cell renders as empty/null rather than crashing or misaligning.
const NULL_CELL: CellValue = { kind: "null" };

/** Serialize rows to RFC-4180 CSV (CRLF line endings, header row from column names). */
export function rowsToCsv(columns: ColumnMeta[], rows: CellValue[][]): string {
  const lines = [columns.map((c) => csvField(c.name)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((_, i) => csvField(cellToText(row[i] ?? NULL_CELL))).join(","));
  }
  return lines.join("\r\n");
}

/** Serialize rows to a pretty-printed JSON array of objects keyed by column name. */
export function rowsToJson(columns: ColumnMeta[], rows: CellValue[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = cellToJson(row[i] ?? NULL_CELL);
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

// Tabs/newlines inside a cell would break TSV columns/rows; flatten them to spaces.
function tsvField(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

/** Serialize rows to TSV for the clipboard (pastes cleanly into spreadsheets). */
export function rowsToTsv(columns: ColumnMeta[], rows: CellValue[][]): string {
  const lines = [columns.map((c) => tsvField(c.name)).join("\t")];
  for (const row of rows) {
    lines.push(columns.map((_, i) => tsvField(cellToText(row[i] ?? NULL_CELL))).join("\t"));
  }
  return lines.join("\n");
}
