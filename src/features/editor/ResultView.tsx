import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, CheckCircle2, Loader2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage, type QueryResult } from "@/lib/types";
import { displayCell } from "@/features/grid/cell";
import { CellDetailDialog, type CellDetail } from "@/features/cell/CellDetailDialog";
import { ExportMenu } from "@/features/export/ExportMenu";
import {
  copyRowsToClipboard,
  exportRowsToFile,
  type ExportFormat,
} from "@/features/export/exportActions";

const ROW_HEIGHT = 26;
const COL_WIDTH = 176;

interface ResultViewProps {
  result: QueryResult | null;
  error: string | null;
  streaming?: boolean;
  streamedRows?: number;
  truncated?: boolean;
}

/** Read-only, virtualized view of a console query result (or an error/affected-rows state). */
export function ResultView({ result, error, streaming, streamedRows, truncated }: ResultViewProps) {
  if (error) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="selectable whitespace-pre-wrap break-words">{error}</span>
      </div>
    );
  }

  // While streaming, show a live row count (the table renders once the stream completes).
  if (streaming) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Streaming… {(streamedRows ?? 0).toLocaleString()} rows
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Run a query to see results
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" />
        {result.rowsAffected ?? 0} row{result.rowsAffected === 1 ? "" : "s"} affected ·{" "}
        {result.elapsedMs} ms
      </div>
    );
  }

  return <ResultTable result={result} truncated={truncated} />;
}

function ResultTable({ result, truncated }: { result: QueryResult; truncated?: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CellDetail | null>(null);

  // Export/copy the in-memory result (what's shown). Re-running the console SQL would be unsafe
  // (it may be DML), so export serializes the rows already streamed into the view.
  const exportResult = async (format: ExportFormat) => {
    setExportError(null);
    try {
      await exportRowsToFile({
        columns: result.columns,
        rows: result.rows,
        format,
        defaultName: "query-result",
      });
    } catch (err) {
      setExportError(errorMessage(err));
    }
  };

  const copyResult = async () => {
    setExportError(null);
    try {
      await copyRowsToClipboard(result.columns, result.rows);
    } catch (err) {
      setExportError(errorMessage(err));
    }
  };

  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });
  const totalWidth = result.columns.length * COL_WIDTH;

  return (
    <div className="flex h-full flex-col">
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 flex border-b border-border bg-surface-raised"
          style={{ width: totalWidth }}
        >
          {result.columns.map((col) => (
            <div
              key={col.name}
              style={{ width: COL_WIDTH }}
              className="shrink-0 truncate border-r border-border px-2 py-1 text-xs font-semibold"
              title={`${col.name} · ${col.dataType}`}
            >
              {col.name}
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => (
            <div
              key={vRow.index}
              className={cn(
                "absolute left-0 flex border-b border-border/60",
                vRow.index % 2 ? "bg-surface/40" : "",
              )}
              style={{ top: vRow.start, height: ROW_HEIGHT, width: totalWidth }}
            >
              {result.rows[vRow.index].map((cell, colIndex) => {
                const text = displayCell(cell);
                const open = () =>
                  setDetail({ columnName: result.columns[colIndex]?.name ?? "", cell });
                return (
                  <div
                    key={colIndex}
                    style={{ width: COL_WIDTH }}
                    onDoubleClick={open}
                    className="group/cell relative flex h-full shrink-0 items-center border-r border-border/60 px-2 text-sm"
                  >
                    <span
                      className={cn(
                        "selectable truncate",
                        cell.kind === "null" ? "italic text-muted-foreground/60" : "",
                      )}
                      title={text}
                    >
                      {text}
                    </span>
                    <button
                      type="button"
                      onClick={open}
                      aria-label="View full value"
                      title="View full value"
                      className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded bg-surface-raised/90 p-0.5 text-muted-foreground hover:text-foreground group-hover/cell:block"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span className={exportError ? "text-destructive" : ""}>
          {exportError ?? (
            <>
              {result.rows.length.toLocaleString()} rows · {result.elapsedMs} ms
              {truncated ? (
                <span className="ml-2 text-warning">· truncated at the streaming limit</span>
              ) : null}
            </>
          )}
        </span>
        <ExportMenu
          onExport={exportResult}
          onCopy={result.rows.length ? copyResult : undefined}
          disabled={result.columns.length === 0}
          scopeHint={truncated ? "Exports the rows shown (truncated set)." : undefined}
        />
      </div>

      <CellDetailDialog detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
