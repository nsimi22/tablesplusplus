import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Database, Search } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAllConnections, useConnections } from "@/features/connections/useConnections";
import * as ipc from "@/lib/ipc";

/** Header picker that opens another database on the active connection's server. Picking one
 *  opens it as a session connection (the active connection's own database just refocuses it).
 *  Mirrors a TablePlus-style "Open database" list. */
export function DatabaseSwitcher() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const sessionConnections = useWorkspaceStore((s) => s.sessionConnections);
  const setActiveConnection = useWorkspaceStore((s) => s.setActiveConnection);
  const addSessionConnection = useWorkspaceStore((s) => s.addSessionConnection);

  const connections = useAllConnections();
  const { data: saved } = useConnections();

  const activeConn = connections.find((c) => c.id === activeConnectionId);
  // For a session connection the secret/root lives under its parent; for a persisted one it's
  // itself. `rootConn` is the persisted connection we open further databases against.
  const session = sessionConnections.find((s) => s.config.id === activeConnectionId);
  const rootId = session ? session.rootId : (activeConnectionId ?? "");
  const rootConn = saved?.find((c) => c.id === rootId);

  const databases = useQuery({
    queryKey: ["databases", activeConnectionId],
    queryFn: () => ipc.listDatabases(activeConnectionId as string),
    enabled: open && !!activeConnectionId,
  });

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

  if (!activeConn) return null;

  const choose = async (db: string) => {
    setError(null);
    // Selecting the persisted connection's own database just refocuses it — no session dupe.
    if (rootConn && db === rootConn.database) {
      setActiveConnection(rootId);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const cfg = await ipc.openDatabase(rootId, db);
      addSessionConnection(cfg, rootId);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = (databases.data ?? []).filter((d) =>
    d.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch database"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <Database className="h-3.5 w-3.5" />
        <span className="max-w-40 truncate">{activeConn.database}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 flex max-h-96 w-72 flex-col overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
        >
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for database…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          {error ? (
            <p className="selectable border-b border-border px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex-1 overflow-y-auto py-1">
            {databases.isLoading || busy ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : databases.isError ? (
              <p className="selectable p-3 text-xs text-destructive">
                {errorMessage(databases.error)}
              </p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No databases match.</p>
            ) : (
              filtered.map((db) => {
                const current = db === activeConn.database;
                return (
                  <button
                    key={db}
                    type="button"
                    onClick={() => choose(db)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{db}</span>
                    {current ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
