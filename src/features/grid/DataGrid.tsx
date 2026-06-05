import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { errorMessage, type CellValue, type ConnectionConfig } from "@/lib/types";
import { useSchema, useTableData } from "@/features/workspace/hooks";
import {
  buildUpdate,
  coerceCellInput,
  type ColumnValue,
  type FilterOp,
  type QuickFilter,
} from "@/features/workspace/sql";
import { useExecuteSql } from "@/features/workspace/hooks";
import { CommitBar } from "./CommitBar";
import { GridCellView } from "./GridCellView";

const PAGE_SIZE = 500;
const ROW_HEIGHT = 28;
const COL_WIDTH = 184;

const FILTER_OPS: FilterOp[] = ["=", "!=", "<", ">", "contains"];

/** rowIndex → (colIndex → new value). */
type Edits = Record<number, Record<number, CellValue>>;

export function DataGrid({
  connection,
  schema,
  table,
}: {
  connection: ConnectionConfig;
  schema: string;
  table: string;
}) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<QuickFilter | null>(null);
  const [draftFilter, setDraftFilter] = useState<QuickFilter>({ column: "", op: "=", value: "" });
  const [edits, setEdits] = useState<Edits>({});
  const [commitError, setCommitError] = useState<string | null>(null);

  const { data: schemaData } = useSchema(connection.id);
  const tableInfo = useMemo(
    () =>
      [...(schemaData?.tables ?? []), ...(schemaData?.views ?? [])].find(
        (t) => t.schema === schema && t.name === table,
      ),
    [schemaData, schema, table],
  );
  const pkColumns = useMemo(
    () => (tableInfo?.columns ?? []).filter((c) => c.isPrimaryKey).map((c) => c.name),
    [tableInfo],
  );

  const query = useTableData({ connection, schema, table, page, pageSize: PAGE_SIZE, filter });
  const exec = useExecuteSql(connection.id);

  // Memoized so the references stay stable across renders (avoids effect churn).
  const columns = useMemo(() => query.data?.columns ?? [], [query.data]);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  // Row indices change when the page/filter/table changes — drop pending edits.
  useEffect(() => {
    setEdits({});
    setCommitError(null);
  }, [page, filter, schema, table, connection.id]);

  // Default the filter column to the first column once data arrives.
  useEffect(() => {
    if (columns.length && !draftFilter.column) {
      setDraftFilter((f) => ({ ...f, column: columns[0].name }));
    }
  }, [columns, draftFilter.column]);

  const editCount = Object.keys(edits).length;
  const canCommit = pkColumns.length > 0 && editCount > 0;

  const setCellEdit = (rowIndex: number, colIndex: number, raw: string) => {
    const original = rows[rowIndex]?.[colIndex];
    if (!original) return;
    const next = coerceCellInput(original, raw);
    setEdits((prev) => {
      const row = { ...(prev[rowIndex] ?? {}) };
      row[colIndex] = next;
      return { ...prev, [rowIndex]: row };
    });
  };

  const discard = () => {
    setEdits({});
    setCommitError(null);
  };

  const commit = async () => {
    setCommitError(null);
    // Drop each row from the pending set only after it commits, so a mid-batch failure
    // doesn't re-run already-applied updates when the user retries.
    const remaining: Edits = { ...edits };
    try {
      for (const [rowKey, rowEdits] of Object.entries(edits)) {
        const rowIndex = Number(rowKey);
        const set: ColumnValue[] = Object.entries(rowEdits).map(([colKey, value]) => ({
          column: columns[Number(colKey)].name,
          value,
        }));
        const where: ColumnValue[] = pkColumns.map((pk) => {
          const colIndex = columns.findIndex((c) => c.name === pk);
          return { column: pk, value: rows[rowIndex][colIndex] };
        });
        const { sql, params } = buildUpdate({
          engine: connection.engine,
          schema,
          table,
          set,
          where,
        });
        await exec.mutateAsync({ sql, params });
        delete remaining[rowIndex];
      }
      setEdits({});
      await query.refetch();
    } catch (err) {
      setEdits(remaining);
      setCommitError(errorMessage(err));
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <FilterBarView
        columns={columns.map((c) => c.name)}
        draft={draftFilter}
        onDraftChange={setDraftFilter}
        onApply={() => setFilter(draftFilter.value === "" ? null : draftFilter)}
        onClear={() => {
          setFilter(null);
          setDraftFilter((f) => ({ ...f, value: "" }));
        }}
        onRefresh={() => query.refetch()}
        loading={query.isFetching}
      />

      <GridBody
        columns={columns.map((c) => ({ name: c.name, dataType: c.dataType }))}
        rows={rows}
        edits={edits}
        onEdit={setCellEdit}
        loading={query.isLoading}
        empty={!query.isLoading && rows.length === 0}
      />

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {rows.length} rows{filter ? " (filtered)" : ""} · page {page + 1}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {editCount > 0 ? (
        <CommitBar
          editCount={editCount}
          canCommit={canCommit}
          noPrimaryKey={pkColumns.length === 0}
          committing={exec.isPending}
          error={commitError}
          onDiscard={discard}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}

interface FilterBarProps {
  columns: string[];
  draft: QuickFilter;
  onDraftChange: (f: QuickFilter) => void;
  onApply: () => void;
  onClear: () => void;
  onRefresh: () => void;
  loading: boolean;
}

function FilterBarView({
  columns,
  draft,
  onDraftChange,
  onApply,
  onClear,
  onRefresh,
  loading,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
      <Select
        value={draft.column}
        onChange={(e) => onDraftChange({ ...draft, column: e.target.value })}
        className="h-8 w-40 text-xs"
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Select
        value={draft.op}
        onChange={(e) => onDraftChange({ ...draft, op: e.target.value as FilterOp })}
        className="h-8 w-28 text-xs"
      >
        {FILTER_OPS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      <Input
        value={draft.value}
        onChange={(e) => onDraftChange({ ...draft, value: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && onApply()}
        placeholder="value"
        className="h-8 w-48 text-xs"
      />
      <Button size="sm" variant="secondary" onClick={onApply}>
        Filter
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
      <div className="ml-auto">
        <Button size="icon" variant="ghost" onClick={onRefresh} aria-label="Refresh">
          {loading ? <Spinner /> : <RotateCw className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

interface GridBodyProps {
  columns: { name: string; dataType: string }[];
  rows: CellValue[][];
  edits: Edits;
  onEdit: (rowIndex: number, colIndex: number, raw: string) => void;
  loading: boolean;
  empty: boolean;
}

function GridBody({ columns, rows, edits, onEdit, loading, empty }: GridBodyProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const totalWidth = columns.length * COL_WIDTH;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No rows
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      {/* Sticky header — shares the scroll container so horizontal scroll stays aligned. */}
      <div
        className="sticky top-0 z-10 flex border-b border-border bg-surface-raised"
        style={{ width: totalWidth }}
      >
        {columns.map((col) => (
          <div
            key={col.name}
            style={{ width: COL_WIDTH }}
            className="flex shrink-0 flex-col justify-center border-r border-border px-2 py-1"
          >
            <span className="truncate text-xs font-semibold">{col.name}</span>
            <span className="truncate text-[10px] text-muted-foreground">{col.dataType}</span>
          </div>
        ))}
      </div>

      <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const rowIndex = vRow.index;
          const rowEdits = edits[rowIndex];
          return (
            <div
              key={rowIndex}
              className={cn(
                "absolute left-0 flex border-b border-border/60",
                rowEdits ? "bg-warning/5" : rowIndex % 2 ? "bg-surface/40" : "",
              )}
              style={{ top: vRow.start, height: ROW_HEIGHT, width: totalWidth }}
            >
              {columns.map((_, colIndex) => (
                <GridCellView
                  key={colIndex}
                  width={COL_WIDTH}
                  value={rows[rowIndex][colIndex]}
                  edited={rowEdits?.[colIndex]}
                  onCommit={(raw) => onEdit(rowIndex, colIndex, raw)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
