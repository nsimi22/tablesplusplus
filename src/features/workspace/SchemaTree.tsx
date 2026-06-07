import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  Eye,
  FunctionSquare,
  Search,
  Table2,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import type { RoutineInfo, SavedQuery, TableInfo } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import * as ipc from "@/lib/ipc";
import { useSchema } from "./hooks";

export function SchemaTree({ connectionId }: { connectionId: string }) {
  const { data: schema, isLoading, error } = useSchema(connectionId);
  const [search, setSearch] = useState("");

  // Saved queries are global (query-mcp snippet store), not per-connection. refetchOnWindowFocus
  // (TanStack default) picks up snippets saved from a Claude session when the app regains focus.
  const savedQueries = useQuery({ queryKey: ["savedQueries"], queryFn: ipc.listSavedQueries });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);
    return {
      tables: (schema?.tables ?? []).filter((t) => match(t.name)),
      views: (schema?.views ?? []).filter((t) => match(t.name)),
      routines: (schema?.routines ?? []).filter((r) => match(r.name)),
      savedQueries: (savedQueries.data ?? []).filter((s) => match(s.name)),
    };
  }, [schema, savedQueries.data, search]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="relative p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search schema…"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : error ? (
          <p className="p-3 text-xs text-destructive">Failed to load schema.</p>
        ) : (
          <>
            <TableGroup
              title="Tables"
              icon={<Table2 className="h-3.5 w-3.5" />}
              tables={filtered.tables}
            />
            <TableGroup
              title="Views"
              icon={<Eye className="h-3.5 w-3.5" />}
              tables={filtered.views}
            />
            <RoutineGroup routines={filtered.routines} />
            <SavedQueriesGroup queries={filtered.savedQueries} />
          </>
        )}
      </div>
    </div>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="px-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
        <span className="ml-auto tabular-nums">{count}</span>
      </button>
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </div>
  );
}

function TableGroup({
  title,
  icon,
  tables,
}: {
  title: string;
  icon: React.ReactNode;
  tables: TableInfo[];
}) {
  const openTableTab = useWorkspaceStore((s) => s.openTableTab);
  return (
    <Group title={title} count={tables.length}>
      {tables.map((t) => (
        <button
          key={`${t.schema}.${t.name}`}
          onClick={() => openTableTab(t)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 pl-6 text-left text-sm",
            "text-foreground/90 hover:bg-accent",
          )}
          title={`${t.schema}.${t.name}`}
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="truncate">{t.name}</span>
        </button>
      ))}
    </Group>
  );
}

/** Saved Queries — read-only list of query-mcp snippets (queries saved from Claude sessions).
 *  Selecting one opens a new SQL tab pre-filled with its SQL. */
function SavedQueriesGroup({ queries }: { queries: SavedQuery[] }) {
  const openQueryTab = useWorkspaceStore((s) => s.openQueryTab);
  return (
    <Group title="Saved Queries" count={queries.length}>
      {queries.map((q) => (
        <button
          key={q.name}
          onClick={() => openQueryTab({ title: q.name, sql: q.sql })}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 pl-6 text-left text-sm",
            "text-foreground/90 hover:bg-accent",
          )}
          title={q.description ?? q.sql}
        >
          <BookMarked className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{q.name}</span>
        </button>
      ))}
    </Group>
  );
}

function RoutineGroup({ routines }: { routines: RoutineInfo[] }) {
  return (
    <Group title="Functions" count={routines.length}>
      {routines.map((r) => (
        <div
          key={`${r.schema}.${r.name}`}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 pl-6 text-left text-sm text-foreground/80"
          title={`${r.schema}.${r.name}`}
        >
          <FunctionSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{r.name}</span>
        </div>
      ))}
    </Group>
  );
}
