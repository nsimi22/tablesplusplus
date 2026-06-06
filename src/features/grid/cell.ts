import type { CellValue } from "@/lib/types";

/** Human-readable rendering of a cell value for the grid. */
export function displayCell(cell: CellValue): string {
  switch (cell.kind) {
    case "null":
      return "NULL";
    case "bool":
      return cell.value ? "true" : "false";
    case "int":
    case "float":
      return String(cell.value);
    case "decimal":
    case "text":
    case "dateTime":
      return cell.value;
    case "bytes": {
      // base64 length → approximate byte count.
      const bytes = Math.floor((cell.value.data.length * 3) / 4);
      return `BLOB (${bytes}${cell.value.truncated ? "+" : ""} bytes)`;
    }
    case "json":
      return JSON.stringify(cell.value);
  }
}

/** Inline editing is supported for scalar kinds only (not bytes/json) in v1. */
export function isEditable(cell: CellValue): boolean {
  return cell.kind !== "bytes" && cell.kind !== "json";
}

/** The raw string shown in the inline editor. */
export function editableText(cell: CellValue): string {
  if (cell.kind === "null") return "";
  return displayCell(cell);
}
