import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Database, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/lib/types";
import { useWorkspaceStore, type WorkspaceTab } from "@/store/useWorkspaceStore";
import { useAllConnections } from "@/features/connections/useConnections";
import { CONNECTION_COLOR_CLASS } from "@/features/connections/connectionDefaults";
import { DataGrid } from "@/features/grid/DataGrid";
import { SqlConsole } from "@/features/editor/SqlConsole";
import { SchemaTree } from "./SchemaTree";
import { TabBar } from "./TabBar";
import { ConnectionSwitcher } from "./ConnectionSwitcher";
import { DatabaseSwitcher } from "./DatabaseSwitcher";

export function Workspace() {
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const secondaryTabId = useWorkspaceStore((s) => s.secondaryTabId);
  const openQueryTab = useWorkspaceStore((s) => s.openQueryTab);
  const toggleSecondaryTab = useWorkspaceStore((s) => s.toggleSecondaryTab);

  const connections = useAllConnections();
  const connFor = (id: string | undefined) => connections.find((c) => c.id === id);

  if (!activeConnectionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const secondaryTab = tabs.find((t) => t.id === secondaryTabId);
  const soloTab = activeTab ?? secondaryTab;
  const activeConn = connFor(activeConnectionId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Database className="h-4 w-4 text-primary" />
        <ConnectionSwitcher />
        <DatabaseSwitcher />
        {activeConn ? (
          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            {activeConn.engine === "postgres" ? "PostgreSQL" : "MySQL"} · {activeConn.host}:
            {activeConn.port}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button size="sm" variant="ghost" onClick={() => openQueryTab()}>
            <TerminalSquare className="h-4 w-4" />
            New Query
          </Button>
        </div>
      </header>

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={22} minSize={14} maxSize={40}>
          <SchemaTree connectionId={activeConnectionId} />
        </Panel>
        <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring" />
        <Panel defaultSize={78}>
          <div className="flex h-full flex-col">
            <TabBar />
            <div className="flex-1 overflow-hidden bg-background">
              {!soloTab ? (
                <EmptyState onNewQuery={() => openQueryTab()} />
              ) : activeTab && secondaryTab && activeTab.id !== secondaryTab.id ? (
                // Split only when two *distinct* tabs are selected (max 2 panes). The two panes
                // may belong to different connections (compare two databases side by side).
                <PanelGroup direction="horizontal" className="h-full">
                  <Panel defaultSize={50} minSize={20}>
                    <PaneContent tab={activeTab} connection={connFor(activeTab.connectionId)} />
                  </Panel>
                  <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring" />
                  <Panel defaultSize={50} minSize={20}>
                    <div className="flex h-full flex-col">
                      <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            CONNECTION_COLOR_CLASS[connFor(secondaryTab.connectionId)?.color ?? "primary"],
                          )}
                        />
                        <span className="truncate text-xs text-muted-foreground">
                          {connFor(secondaryTab.connectionId)?.label ||
                            connFor(secondaryTab.connectionId)?.host}{" "}
                          · {secondaryTab.title}
                        </span>
                        <button
                          onClick={() => toggleSecondaryTab(secondaryTab.id)}
                          className="ml-auto rounded p-0.5 hover:bg-muted"
                          aria-label="Close split view"
                          title="Close split view"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <PaneContent
                          tab={secondaryTab}
                          connection={connFor(secondaryTab.connectionId)}
                        />
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              ) : (
                <PaneContent tab={soloTab} connection={connFor(soloTab.connectionId)} />
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

/** Renders a single tab's content (table grid or SQL console) for its own connection. */
function PaneContent({
  tab,
  connection,
}: {
  tab: WorkspaceTab;
  connection: ConnectionConfig | undefined;
}) {
  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  return tab.kind === "table" ? (
    <DataGrid
      key={tab.id}
      connection={connection}
      schema={tab.schema as string}
      table={tab.table as string}
      initialFilter={tab.tableFilter}
      filterRev={tab.filterRev}
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
