import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Database, LogOut, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useDisconnect } from "@/features/connections/useConnections";
import { DataGrid } from "@/features/grid/DataGrid";
import { SqlConsole } from "@/features/editor/SqlConsole";
import { SchemaTree } from "./SchemaTree";
import { TabBar } from "./TabBar";
import { useActiveConnection } from "./hooks";

export function Workspace() {
  const connection = useActiveConnection();
  const connectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const openQueryTab = useWorkspaceStore((s) => s.openQueryTab);
  const leaveWorkspace = useWorkspaceStore((s) => s.leaveWorkspace);
  const disconnect = useDisconnect();

  if (!connection || !connectionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const onDisconnect = async () => {
    await disconnect.mutateAsync(connectionId).catch(() => undefined);
    leaveWorkspace();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2">
        <Database className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{connection.label || connection.host}</span>
        <span className="text-xs text-muted-foreground">
          {connection.engine === "postgres" ? "PostgreSQL" : "MySQL"} ·{" "}
          {connection.host}:{connection.port}/{connection.database}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={openQueryTab}>
            <TerminalSquare className="h-4 w-4" />
            New Query
          </Button>
          <Button size="sm" variant="ghost" onClick={onDisconnect}>
            <LogOut className="h-4 w-4" />
            Disconnect
          </Button>
        </div>
      </header>

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={22} minSize={14} maxSize={40}>
          <SchemaTree connectionId={connectionId} />
        </Panel>
        <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring" />
        <Panel defaultSize={78}>
          <div className="flex h-full flex-col">
            <TabBar />
            <div className="flex-1 overflow-hidden bg-background">
              {!activeTab ? (
                <EmptyState onNewQuery={openQueryTab} />
              ) : activeTab.kind === "table" ? (
                <DataGrid
                  key={activeTab.id}
                  connection={connection}
                  schema={activeTab.schema as string}
                  table={activeTab.table as string}
                />
              ) : (
                <SqlConsole key={activeTab.id} connection={connection} tabId={activeTab.id} />
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function EmptyState({ onNewQuery }: { onNewQuery: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Database className="h-10 w-10 opacity-30" />
      <p className="text-sm">Select a table from the sidebar, or open a SQL query.</p>
      <Button variant="secondary" size="sm" onClick={onNewQuery}>
        <TerminalSquare className="h-4 w-4" />
        New Query
      </Button>
    </div>
  );
}
