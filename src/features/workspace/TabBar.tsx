import { Columns2, Plus, Table2, TerminalSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const secondaryTabId = useWorkspaceStore((s) => s.secondaryTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const toggleSecondaryTab = useWorkspaceStore((s) => s.toggleSecondaryTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openQueryTab = useWorkspaceStore((s) => s.openQueryTab);

  return (
    <div className="flex items-stretch border-b border-border bg-surface">
      <div className="flex flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group flex max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-sm",
                active
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {tab.kind === "table" ? (
                <Table2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSecondaryTab(tab.id);
                }}
                className={cn(
                  "ml-1 rounded p-0.5 hover:bg-muted",
                  tab.id === secondaryTabId
                    ? "text-primary opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
                aria-label={tab.id === secondaryTabId ? "Unsplit" : "Open in split view"}
                title={tab.id === secondaryTabId ? "Remove from split" : "Open in split view"}
              >
                <Columns2 className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={openQueryTab}
        className="flex items-center px-3 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        aria-label="New query tab"
        title="New SQL query"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
