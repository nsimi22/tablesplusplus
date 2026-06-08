import { useMemo, useState } from "react";
import { ArrowLeft, Download, Plus, Sparkles, Trash2, Upload, Zap } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";
import { errorMessage, type ConnectionConfig } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { AiSettingsDialog } from "@/features/ai/AiSettingsDialog";
import { ConnectionForm } from "./ConnectionForm";
import { CONNECTION_COLOR_CLASS } from "./connectionDefaults";
import { exportConnections, importConnectionsFile } from "./connectionShare";
import {
  useConnect,
  useConnections,
  useDeleteConnection,
  useImportConnections,
} from "./useConnections";

export function ConnectionHub() {
  const { data: connections, isLoading } = useConnections();
  const openConnectionIds = useWorkspaceStore((s) => s.openConnectionIds);
  const setHubOpen = useWorkspaceStore((s) => s.setHubOpen);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(true);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importConnections = useImportConnections();

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

  const onImport = async () => {
    setImportNote(null);
    setImportError(null);
    try {
      const inputs = await importConnectionsFile();
      if (!inputs) return; // cancelled
      const created = await importConnections.mutateAsync(inputs);
      const n = created.length;
      setImportNote(
        `Imported ${n} connection${n === 1 ? "" : "s"} — select one and enter its password to connect.`,
      );
      // Open the first import in the edit form so the password field is right there.
      if (created[0]) selectConnection(created[0].id);
    } catch (err) {
      setImportError(errorMessage(err));
    }
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-72 flex-col border-r border-border bg-surface">
        <header className="flex items-center justify-between px-4 py-3">
          <Wordmark />
          <div className="flex items-center gap-0.5">
            {openConnectionIds.length > 0 ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setHubOpen(false)}
                aria-label="Back to workspace"
                title="Back to workspace"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <ThemeToggle />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowAiSettings(true)}
              aria-label="AI settings"
              title="AI settings"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onImport}
              aria-label="Import connections"
              title="Import connections from a file"
            >
              {importConnections.isPending ? <Spinner /> : <Upload className="h-4 w-4" />}
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
                isOpen={openConnectionIds.includes(conn.id)}
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
        {importError ? (
          <p className="selectable border-b border-border bg-destructive/10 px-6 py-2 text-xs text-destructive">
            {importError}
          </p>
        ) : importNote ? (
          <p className="border-b border-border bg-primary/10 px-6 py-2 text-xs text-foreground">
            {importNote}
          </p>
        ) : null}
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
  isOpen,
  onSelect,
}: {
  conn: ConnectionConfig;
  active: boolean;
  isOpen: boolean;
  onSelect: () => void;
}) {
  const connect = useConnect();
  const del = useDeleteConnection();
  const openConnection = useWorkspaceStore((s) => s.openConnection);
  const [error, setError] = useState<string | null>(null);
  // Two-click confirm guards against accidental deletion (reliable in the Tauri webview,
  // unlike window.confirm). Resets when the pointer leaves the row.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const onConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    // Already open — just focus it (and close the hub) without re-opening the pool.
    if (isOpen) {
      openConnection(conn.id);
      return;
    }
    try {
      await connect.mutateAsync(conn.id);
      openConnection(conn.id);
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

  const onExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    try {
      await exportConnections([conn], conn.label || conn.host);
    } catch (err) {
      setError(errorMessage(err));
    }
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
        {isOpen ? (
          <span className="shrink-0 text-[10px] font-semibold tracking-wide text-success">OPEN</span>
        ) : null}
        <Badge variant="default" className="shrink-0">
          {conn.engine === "postgres" ? "PG" : "MySQL"}
        </Badge>
      </div>
      <div className="mt-0.5 flex items-center justify-between pl-4">
        <span className="truncate text-xs text-muted-foreground">
          {conn.user}@{conn.host}:{conn.port}/{conn.database}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            onClick={onConnect}
            aria-label={isOpen ? "Switch to connection" : "Connect"}
            title={isOpen ? "Switch to connection" : "Connect"}
          >
            {connect.isPending ? <Spinner /> : <Zap className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onExport}
            aria-label="Export connection"
            title="Export connection to a file (no password)"
          >
            <Download className="h-3.5 w-3.5" />
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
