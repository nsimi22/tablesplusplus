import { useMemo, useState } from "react";
import { Database, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { errorMessage, type ConnectionConfig } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { AiSettingsDialog } from "@/features/ai/AiSettingsDialog";
import { ConnectionForm } from "./ConnectionForm";
import { CONNECTION_COLOR_CLASS } from "./connectionDefaults";
import {
  useConnect,
  useConnections,
  useDeleteConnection,
} from "./useConnections";

export function ConnectionHub() {
  const { data: connections, isLoading } = useConnections();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(true);
  const [showAiSettings, setShowAiSettings] = useState(false);

  const editing = useMemo(
    () => connections?.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  const startNew = () => {
    setCreating(true);
    setSelectedId(null);
  };

  const selectConnection = (id: string) => {
    setCreating(false);
    setSelectedId(id);
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-72 flex-col border-r border-border bg-surface">
        <header className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Database className="h-4 w-4 text-primary" />
            Tables++
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowAiSettings(true)}
              aria-label="AI settings"
              title="AI settings"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={startNew} aria-label="New connection">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div className="px-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Connections
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : connections && connections.length > 0 ? (
            connections.map((conn) => (
              <ConnectionListItem
                key={conn.id}
                conn={conn}
                active={!creating && conn.id === selectedId}
                onSelect={() => selectConnection(conn.id)}
              />
            ))
          ) : (
            <p className="p-4 text-xs text-muted-foreground">
              No connections yet. Create one to get started.
            </p>
          )}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col bg-background">
        <div className="border-b border-border px-6 py-3 text-sm font-medium">
          {creating ? "New Connection" : editing ? `Edit — ${editing.label || editing.host}` : ""}
        </div>
        <div className="flex-1 overflow-hidden">
          <ConnectionForm
            key={creating ? "new" : selectedId ?? "new"}
            editing={creating ? null : editing}
            onSaved={(id) => selectConnection(id)}
          />
        </div>
      </main>

      <AiSettingsDialog open={showAiSettings} onClose={() => setShowAiSettings(false)} />
    </div>
  );
}

function ConnectionListItem({
  conn,
  active,
  onSelect,
}: {
  conn: ConnectionConfig;
  active: boolean;
  onSelect: () => void;
}) {
  const connect = useConnect();
  const del = useDeleteConnection();
  const enterWorkspace = useWorkspaceStore((s) => s.enterWorkspace);
  const [error, setError] = useState<string | null>(null);
  // Two-click confirm guards against accidental deletion (reliable in the Tauri webview,
  // unlike window.confirm). Resets when the pointer leaves the row.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const onConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    try {
      await connect.mutateAsync(conn.id);
      enterWorkspace(conn.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    await del.mutateAsync(conn.id);
  };

  return (
    <div
      onClick={onSelect}
      onMouseLeave={() => setConfirmingDelete(false)}
      className={cn(
        "group cursor-pointer rounded-md px-2.5 py-2 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            CONNECTION_COLOR_CLASS[conn.color ?? "primary"],
          )}
        />
        <span className="flex-1 truncate text-sm">{conn.label || conn.host}</span>
        <Badge variant="default" className="shrink-0">
          {conn.engine === "postgres" ? "PG" : "MySQL"}
        </Badge>
      </div>
      <div className="mt-0.5 flex items-center justify-between pl-4">
        <span className="truncate text-xs text-muted-foreground">
          {conn.user}@{conn.host}:{conn.port}/{conn.database}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" onClick={onConnect} aria-label="Connect">
            {connect.isPending ? <Spinner /> : <Zap className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            variant={confirmingDelete ? "destructive" : "ghost"}
            onClick={onDelete}
            aria-label={confirmingDelete ? "Confirm delete" : "Delete"}
            title={confirmingDelete ? "Click again to confirm" : "Delete"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {error ? <p className="mt-1 pl-4 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
