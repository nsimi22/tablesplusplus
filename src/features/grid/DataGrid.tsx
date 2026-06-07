import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Plus,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { errorMessage, type CellValue, type ColumnMeta, type ConnectionConfig } from "@/lib/types";
import { useSchema, useTableData } from "@/features/workspace/hooks";
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  coerceCellInput,
  FILTER_OPS,
  type ColumnValue,
  type FilterOp,
  type QuickFilter,
  type SortSpec,
} from "@/features/workspace/sql";
import { useExecuteSql } from "@/features/workspace/hooks";
import { executeQueryStream } from "@/lib/ipc";
import { CellDetailDialog, type CellDetail } from "@/features/cell/CellDetailDialog";
import { ExportMenu } from "@/features/export/ExportMenu";
import {
  chooseExportPath,
  copyRowsToClipboard,
  writeRowsToPath,
  type ExportFormat,
} from "@/features/export/exportActions";
import { CommitBar } from "./CommitBar";
import { GridCellView } from "./GridCellView";

const PAGE_SIZE = 500;
const ROW_HEIGHT = 28;
const COL_WIDTH = 184;
const GUTTER_WIDTH = 32;

/** rowIndex → (colIndex → new value). */
type Edits = Record<number, Record<number, CellValue>>;

/** A draft row being inserted: a stable id + the cells the user has filled (colIndex → value).
 *  Unset columns are omitted from the INSERT so the database applies its defaults. */
interface InsertRow {
  id: number;
  cells: Record<number, CellValue>;
}

/** A typed empty value for a sampled column kind, so draft-row input coerces like the column. */
function seedForKind(kind: CellValue["kind"] | undefined): CellValue {
  switch (kind) {
    case "int":
      return { kind: "int", value: 0 };
    case "float":
      return { kind: "float", value: 0 };
    case "decimal":
      return { kind: "decimal", value: "" };
    case "bool":
      return { kind: "bool", value: false };
    case "dateTime":
      return { kind: "dateTime", value: "" };
    default:
      return { kind: "text", value: "" };
  }
}

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
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [draftFilter, setDraftFilter] = useState<QuickFilter>({ column: "", op: "=", value: "" });
  const [edits, setEdits] = useState<Edits>({});
  const [deletes, setDeletes] = useState<Set<number>>(new Set());
  const [inserts, setInserts] = useState<InsertRow[]>([]);
  const insertIdRef = useRef(0);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<CellDetail | null>(null);

  // Reset table-scoped state *during render* when the table/connection changes, so the very first
  // render of a new table can't query it with the previous table's page/filter/sort (which could
  // reference a column that doesn't exist). This is the React "reset state on prop change" pattern;
  // it also makes the grid correct even if the parent stops keying it by tab.
  const tableKey = `${connection.id}/${schema}/${table}`;
  const [prevTableKey, setPrevTableKey] = useState(tableKey);
  if (tableKey !== prevTableKey) {
    setPrevTableKey(tableKey);
    setPage(0);
    setFilter(null);
    setSort(null);
    setEdits({});
    setDeletes(new Set());
    setInserts([]);
    setCommitError(null);
  }

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

  const query = useTableData({ connection, schema, table, page, pageSize: PAGE_SIZE, filter, sort });
  const exec = useExecuteSql(connection.id);

  // Memoized so the references stay stable across renders (avoids effect churn).
  const columns = useMemo(() => query.data?.columns ?? [], [query.data]);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  // Row indices change when the page/filter/sort changes within a table — drop pending edits.
  // (Table/connection changes are handled by the render-phase reset above.)
  useEffect(() => {
    setEdits({});
    setDeletes(new Set());
    setInserts([]);
    setCommitError(null);
  }, [page, filter, sort]);

  // Sample each column's value kind from the loaded page so draft-row input coerces correctly
  // (mirrors the quick-filter approach). Columns with no sampled value fall back to text.
  const columnKinds = useMemo(
    () =>
      columns.map((_, i) => rows.find((r) => r[i] && r[i].kind !== "null")?.[i]?.kind),
    [columns, rows],
  );

  // Default the filter column to the first column once data arrives.
  useEffect(() => {
    if (columns.length && !draftFilter.column) {
      setDraftFilter((f) => ({ ...f, column: columns[0].name }));
    }
  }, [columns, draftFilter.column]);

  const editCount = Object.keys(edits).length;
  const deleteCount = deletes.size;
  const insertCount = inserts.length;
  const pendingCount = editCount + deleteCount + insertCount;
  // Updates and deletes target existing rows by primary key; inserts don't need one.
  const needsPrimaryKey = editCount > 0 || deleteCount > 0;
  const canCommit = pendingCount > 0 && (!needsPrimaryKey || pkColumns.length > 0);

  // Cycle a column through asc → desc → unsorted; sorting resets to the first page.
  const onSort = (column: string) => {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
    setPage(0);
  };

  const openDetail = (rowIndex: number, colIndex: number) => {
    const cell = edits[rowIndex]?.[colIndex] ?? rows[rowIndex]?.[colIndex];
    if (cell) setDetail({ columnName: columns[colIndex].name, cell });
  };

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

  const toggleDelete = (rowIndex: number) => {
    setCommitError(null);
    setDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const addInsertRow = () => {
    setCommitError(null);
    // Advance the ref outside the updater — updaters can run twice under Strict/concurrent mode.
    const id = insertIdRef.current++;
    setInserts((prev) => [...prev, { id, cells: {} }]);
  };

  const discardInsert = (id: number) => {
    setInserts((prev) => prev.filter((r) => r.id !== id));
  };

  const setInsertCell = (id: number, colIndex: number, raw: string) => {
    const next = coerceCellInput(seedForKind(columnKinds[colIndex]), raw);
    setInserts((prev) =>
      prev.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, [colIndex]: next } } : r)),
    );
  };

  const discard = () => {
    setEdits({});
    setDeletes(new Set());
    setInserts([]);
    setCommitError(null);
  };

  const pkWhere = (rowIndex: number): ColumnValue[] =>
    pkColumns.map((pk) => {
      const colIndex = columns.findIndex((c) => c.name === pk);
      return { column: pk, value: rows[rowIndex][colIndex] };
    });

  // Apply pending deletes, then updates, then inserts. Each statement is removed from its pending
  // set only after it succeeds, so a mid-batch failure leaves the rest pending without re-running
  // (re-inserting) applied changes when the user retries.
  const commit = async () => {
    setCommitError(null);
    const remainingEdits: Edits = { ...edits };
    const remainingDeletes = new Set(deletes);
    let remainingInserts = [...inserts];
    try {
      // 1. Deletes — by primary key; a PK match must touch at most one row.
      for (const rowIndex of deletes) {
        const { sql, params } = buildDelete({
          engine: connection.engine,
          schema,
          table,
          where: pkWhere(rowIndex),
        });
        const res = await exec.mutateAsync({ sql, params });
        if (res.rowsAffected !== null && res.rowsAffected > 1) {
          throw new Error(
            `This delete matched ${res.rowsAffected} rows but expected one; aborting to avoid unintended deletes.`,
          );
        }
        remainingDeletes.delete(rowIndex);
        delete remainingEdits[rowIndex]; // edits on a deleted row are moot
      }

      // 2. Updates — skip rows that were just deleted.
      for (const [rowKey, rowEdits] of Object.entries(edits)) {
        const rowIndex = Number(rowKey);
        if (deletes.has(rowIndex)) {
          delete remainingEdits[rowIndex];
          continue;
        }
        const set: ColumnValue[] = Object.entries(rowEdits).map(([colKey, value]) => ({
          column: columns[Number(colKey)].name,
          value,
        }));
        const { sql, params } = buildUpdate({
          engine: connection.engine,
          schema,
          table,
          set,
          where: pkWhere(rowIndex),
        });
        const res = await exec.mutateAsync({ sql, params });
        // Guard against silent data loss / over-broad writes. A PK update must touch one row.
        // Postgres counts matched rows, so 0 reliably means "not found". MySQL reports 0 when
        // the new value equals the old (matched but unchanged), so there we only flag > 1.
        const affected = res.rowsAffected;
        if (affected !== null) {
          if (affected > 1) {
            throw new Error(
              `This update matched ${affected} rows but expected exactly one; aborting to avoid unintended writes.`,
            );
          }
          if (affected === 0 && connection.engine === "postgres") {
            throw new Error(
              "No matching row was found — it may have been changed or deleted. Refresh and retry.",
            );
          }
        }
        delete remainingEdits[rowIndex];
      }

      // 3. Inserts — only the columns the user set; the rest take database defaults.
      for (const insert of inserts) {
        const values: ColumnValue[] = columns
          .map((c, i) =>
            insert.cells[i] !== undefined ? { column: c.name, value: insert.cells[i] } : null,
          )
          .filter((v): v is ColumnValue => v !== null);
        const { sql, params } = buildInsert({ engine: connection.engine, schema, table, values });
        await exec.mutateAsync({ sql, params });
        remainingInserts = remainingInserts.filter((r) => r.id !== insert.id);
      }

      setEdits({});
      setDeletes(new Set());
      setInserts([]);
      await query.refetch();
    } catch (err) {
      setEdits(remainingEdits);
      setDeletes(remainingDeletes);
      setInserts(remainingInserts);
      setCommitError(errorMessage(err));
    }
  };

  // Export the entire (filtered) table, not just the visible page: stream the unpaged SELECT
  // and serialize the accumulated rows. Safe to re-run — it's an app-generated SELECT. The path
  // is chosen first so cancelling the dialog skips the (potentially large) fetch entirely.
  const exportAll = async (format: ExportFormat) => {
    setExportNote(null);
    try {
      const path = await chooseExportPath(format, table);
      if (!path) return;
      const { sql, params } = buildSelect({ engine: connection.engine, schema, table, filter, sort });
      const cols: ColumnMeta[] = [];
      const allRows: CellValue[][] = [];
      let didTruncate = false;
      await executeQueryStream({ id: connection.id, sql, params }, (chunk) => {
        if (chunk.kind === "columns") cols.push(...chunk.columns);
        else if (chunk.kind === "rows") for (const r of chunk.rows) allRows.push(r);
        else didTruncate = chunk.truncated;
      });
      await writeRowsToPath(path, cols.length ? cols : columns, allRows, format);
      if (didTruncate) {
        setExportNote(
          `Exported ${allRows.length.toLocaleString()} rows (stopped at the streaming limit).`,
        );
      }
    } catch (err) {
      setExportNote(errorMessage(err));
    }
  };

  const copyPage = async () => {
    setExportNote(null);
    try {
      await copyRowsToClipboard(columns, rows);
    } catch (err) {
      setExportNote(errorMessage(err));
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <FilterBarView
        columns={columns.map((c) => c.name)}
        draft={draftFilter}
        onDraftChange={setDraftFilter}
        onApply={() => {
          if (draftFilter.value === "") {
            setFilter(null);
            return;
          }
          // Sample the column's kind from a non-null cell so numeric ranges compare numerically.
          const colIndex = columns.findIndex((c) => c.name === draftFilter.column);
          const sample =
            colIndex >= 0
              ? rows.find((r) => r[colIndex] && r[colIndex].kind !== "null")?.[colIndex]
              : undefined;
          setFilter({ ...draftFilter, columnKind: sample?.kind });
        }}
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
        deletes={deletes}
        inserts={inserts}
        sort={sort}
        onSort={onSort}
        onEdit={setCellEdit}
        onExpand={openDetail}
        onToggleDelete={toggleDelete}
        onInsertEdit={setInsertCell}
        onDiscardInsert={discardInsert}
        loading={query.isLoading}
        empty={!query.isLoading && rows.length === 0 && inserts.length === 0}
      />

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className={exportNote ? "text-warning" : ""}>
          {exportNote ?? `${rows.length} rows${filter ? " (filtered)" : ""} · page ${page + 1}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={addInsertRow}
            disabled={columns.length === 0}
            aria-label="Add row"
          >
            <Plus className="h-3.5 w-3.5" />
            Add row
          </Button>
          <ExportMenu
            onExport={exportAll}
            onCopy={rows.length ? copyPage : undefined}
            disabled={columns.length === 0}
            scopeHint="Export covers the whole (filtered) table; copy is this page."
          />
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

      {pendingCount > 0 ? (
        <CommitBar
          editCount={editCount}
          insertCount={insertCount}
          deleteCount={deleteCount}
          canCommit={canCommit}
          noPrimaryKey={needsPrimaryKey && pkColumns.length === 0}
          committing={exec.isPending}
          error={commitError}
          onDiscard={discard}
          onCommit={commit}
        />
      ) : null}

      <CellDetailDialog detail={detail} onClose={() => setDetail(null)} />
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
  deletes: Set<number>;
  inserts: InsertRow[];
  sort: SortSpec | null;
  onSort: (column: string) => void;
  onEdit: (rowIndex: number, colIndex: number, raw: string) => void;
  onExpand: (rowIndex: number, colIndex: number) => void;
  onToggleDelete: (rowIndex: number) => void;
  onInsertEdit: (id: number, colIndex: number, raw: string) => void;
  onDiscardInsert: (id: number) => void;
  loading: boolean;
  empty: boolean;
}

function GridBody({
  columns,
  rows,
  edits,
  deletes,
  inserts,
  sort,
  onSort,
  onEdit,
  onExpand,
  onToggleDelete,
  onInsertEdit,
  onDiscardInsert,
  loading,
  empty,
}: GridBodyProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const totalWidth = GUTTER_WIDTH + columns.length * COL_WIDTH;
  // Draft insert rows render below the (virtualized) data rows, so extend the canvas height.
  const dataHeight = virtualizer.getTotalSize();
  const canvasHeight = dataHeight + inserts.length * ROW_HEIGHT;

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
        <div className="shrink-0 border-r border-border" style={{ width: GUTTER_WIDTH }} />
        {columns.map((col) => {
          const active = sort?.column === col.name;
          return (
            <button
              key={col.name}
              type="button"
              onClick={() => onSort(col.name)}
              style={{ width: COL_WIDTH }}
              title={`Sort by ${col.name}`}
              className="group flex shrink-0 items-center gap-1 border-r border-border px-2 py-1 text-left hover:bg-accent/50"
            >
              <span className="flex min-w-0 flex-col justify-center">
                <span className="truncate text-xs font-semibold">{col.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">{col.dataType}</span>
              </span>
              <span className="ml-auto shrink-0">
                {active ? (
                  sort?.dir === "asc" ? (
                    <ChevronUp className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-primary" />
                  )
                ) : (
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ height: canvasHeight, width: totalWidth, position: "relative" }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const rowIndex = vRow.index;
          const rowEdits = edits[rowIndex];
          const deleted = deletes.has(rowIndex);
          return (
            <div
              key={rowIndex}
              className={cn(
                "absolute left-0 flex border-b border-border/60",
                deleted
                  ? "bg-destructive/10 text-muted-foreground line-through"
                  : rowEdits
                    ? "bg-warning/5"
                    : rowIndex % 2
                      ? "bg-surface/40"
                      : "",
              )}
              style={{ top: vRow.start, height: ROW_HEIGHT, width: totalWidth }}
            >
              <GutterButton
                onClick={() => onToggleDelete(rowIndex)}
                title={deleted ? "Restore row" : "Delete row"}
                ariaLabel={deleted ? "Restore row" : "Delete row"}
              >
                {deleted ? (
                  <Undo2 className="h-3.5 w-3.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                )}
              </GutterButton>
              {columns.map((_, colIndex) => (
                <GridCellView
                  key={colIndex}
                  width={COL_WIDTH}
                  value={rows[rowIndex][colIndex]}
                  edited={rowEdits?.[colIndex]}
                  disabled={deleted}
                  onExpand={() => onExpand(rowIndex, colIndex)}
                  onCommit={(raw) => onEdit(rowIndex, colIndex, raw)}
                />
              ))}
            </div>
          );
        })}

        {inserts.map((insert, i) => (
          <div
            key={`insert-${insert.id}`}
            className="absolute left-0 flex border-b border-border/60 bg-success/5"
            style={{ top: dataHeight + i * ROW_HEIGHT, height: ROW_HEIGHT, width: totalWidth }}
          >
            <GutterButton
              onClick={() => onDiscardInsert(insert.id)}
              title="Discard new row"
              ariaLabel="Discard new row"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </GutterButton>
            {columns.map((_, colIndex) => (
              <GridCellView
                key={colIndex}
                width={COL_WIDTH}
                value={insert.cells[colIndex] ?? { kind: "text", value: "" }}
                onCommit={(raw) => onInsertEdit(insert.id, colIndex, raw)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GutterButton({
  onClick,
  title,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center border-r border-border/60"
      style={{ width: GUTTER_WIDTH }}
    >
      <button type="button" onClick={onClick} title={title} aria-label={ariaLabel} className="p-1">
        {children}
      </button>
    </div>
  );
}
