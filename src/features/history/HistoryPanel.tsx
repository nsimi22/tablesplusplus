import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useHistoryStore, type HistoryEntry } from "@/store/useHistoryStore";

interface HistoryPanelProps {
  /** Load a past query's SQL into the editor. */
  onPick: (sql: string) => void;
}

/** Compact, searchable dropdown of recent console queries. Click an entry to load it. */
export function HistoryPanel({ onPick }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const entries = useHistoryStore((s) => s.entries);
  const remove = useHistoryStore((s) => s.remove);
  const clear = useHistoryStore((s) => s.clear);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => e.sql.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  // Stable callbacks so memoized rows don't re-render on every keystroke in the search box.
  const handlePick = useCallback(
    (sql: string) => {
      onPick(sql);
      setOpen(false);
    },
    [onPick],
  );
  const handleRemove = useCallback((id: string) => remove(id), [remove]);

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Query history"
      >
        <History className="h-3.5 w-3.5" />
        History
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 flex max-h-96 w-[28rem] flex-col overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search history…"
              className="h-8 text-xs"
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={clear}
              disabled={entries.length === 0}
              title="Clear all history"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {entries.length === 0 ? "No queries yet" : "No matches"}
              </p>
            ) : (
              filtered.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onPick={handlePick}
                  onRemove={handleRemove}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const HistoryRow = memo(function HistoryRow({
  entry,
  onPick,
  onRemove,
}: {
  entry: HistoryEntry;
  onPick: (sql: string) => void;
  onRemove: (id: string) => void;
}) {
  const meta =
    entry.status === "error"
      ? "error"
      : `${(entry.rowCount ?? 0).toLocaleString()} rows · ${entry.elapsedMs ?? 0} ms`;

  // Cap before the regex/normalize so a pathologically large query doesn't churn on each render.
  const raw = entry.sql.length > 200 ? `${entry.sql.slice(0, 200)}…` : entry.sql;
  const preview = raw.replace(/\s+/g, " ").trim();

  return (
    <div className="group flex items-center gap-2 border-b border-border/50 px-2 hover:bg-accent">
      <button
        type="button"
        onClick={() => onPick(entry.sql)}
        title={entry.sql}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            entry.status === "error" ? "bg-destructive" : "bg-success",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{preview}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(entry.at)}</span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        aria-label="Remove from history"
        className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});

function timeAgo(at: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
