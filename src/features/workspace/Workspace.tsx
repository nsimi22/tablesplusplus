import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Database, LogOut, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { ConnectionConfig } from "@/lib/types";
import { useWorkspaceStore, type WorkspaceTab } from "@/store/useWorkspaceStore";
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
  const secondaryTabId = useWorkspaceStore((s) => s.secondaryTabId);
  const openQueryTab = useWorkspaceStore((s) => s.openQueryTab);
  const toggleSecondaryTab = useWorkspaceStore((s) => s.toggleSecondaryTab);
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
  const secondaryTab = tabs.find((t) => t.id === secondaryTabId);
  const soloTab = activeTab ?? secondaryTab;

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
          <ThemeToggle />
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
              {!soloTab ? (
                <EmptyState onNewQuery={openQueryTab} />
              ) : activeTab && secondaryTab && activeTab.id !== secondaryTab.id ? (
                // Split only when two *distinct* tabs are selected (max 2 panes).
                <PanelGroup direction="horizontal" className="h-full">
                  <Panel defaultSize={50} minSize={20}>
                    <PaneContent connection={connection} tab={activeTab} />
                  </Panel>
                  <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring" />
                  <Panel defaultSize={50} minSize={20}>
                    <div className="flex h-full flex-col">
                      <div className="flex items-center justify-between border-b border-border bg-surface px-2 py-1">
                        <span className="truncate text-xs text-muted-foreground">
                          {secondaryTab.title}
                        </span>
                        <button
                          onClick={() => toggleSecondaryTab(secondaryTab.id)}
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label="Close split view"
                          title="Close split view"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <PaneContent connection={connection} tab={secondaryTab} />
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              ) : (
                <PaneContent connection={connection} tab={soloTab} />
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

/** Renders a single tab's content (table grid or SQL console). Used by both panes. */
function PaneContent({
  connection,
  tab,
}: {
  connection: ConnectionConfig;
  tab: WorkspaceTab;
}) {
  return tab.kind === "table" ? (
    <DataGrid
      key={tab.id}
      connection={connection}
      schema={tab.schema as string}
      table={tab.table as string}
    />
  ) : (
    <SqlConsole key={tab.id} connection={connection} tabId={tab.id} />
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
