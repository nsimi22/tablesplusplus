import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { CellValue } from "@/lib/types";

export interface CellDetail {
  columnName: string;
  cell: CellValue;
}

/** Full text of a non-binary cell for the viewer (and clipboard): pretty JSON, raw text, etc. */
function detailText(cell: CellValue): string {
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
    case "bytes":
      return cell.value.data; // base64
    case "json":
      return JSON.stringify(cell.value, null, 2);
  }
}

/** Decode base64 → grouped hex (16 bytes/line). Empty string if the payload isn't decodable. */
function base64ToHex(b64: string): string {
  try {
    const bin = atob(b64);
    const out: string[] = [];
    for (let i = 0; i < bin.length; i += 16) {
      const line = [];
      for (let j = i; j < Math.min(i + 16, bin.length); j++) {
        line.push(bin.charCodeAt(j).toString(16).padStart(2, "0"));
      }
      out.push(line.join(" "));
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

function byteCount(b64: string): number {
  try {
    return atob(b64).length;
  } catch {
    return Math.floor((b64.length * 3) / 4);
  }
}

/** A read-only viewer for a single cell's full value. Pass `detail = null` to keep it closed. */
export function CellDetailDialog({
  detail,
  onClose,
}: {
  detail: CellDetail | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [bytesAsHex, setBytesAsHex] = useState(false);

  if (!detail) return null;
  const { cell, columnName } = detail;
  const isBytes = cell.kind === "bytes";
  const shown = isBytes && bytesAsHex ? base64ToHex(cell.value.data) : detailText(cell);

  const copy = async () => {
    try {
      await writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard is best-effort
    }
  };

  const meta = isBytes
    ? `binary · ${byteCount(cell.value.data).toLocaleString()} bytes${
        cell.value.truncated ? " (truncated for display)" : ""
      }`
    : cell.kind;

  return (
    <Dialog open onClose={onClose} title={columnName} className="max-w-2xl">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{meta}</span>
          <div className="flex items-center gap-1">
            {isBytes ? (
              <div className="mr-1 flex overflow-hidden rounded border border-border text-xs">
                <ToggleSeg active={!bytesAsHex} onClick={() => setBytesAsHex(false)}>
                  Base64
                </ToggleSeg>
                <ToggleSeg active={bytesAsHex} onClick={() => setBytesAsHex(true)}>
                  Hex
                </ToggleSeg>
              </div>
            ) : null}
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        {cell.kind === "null" ? (
          <p className="italic text-muted-foreground">NULL</p>
        ) : (
          <pre className="selectable max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-xs">
            {shown}
          </pre>
        )}
      </div>
    </Dialog>
  );
}

function ToggleSeg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
