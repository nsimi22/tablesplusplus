import { create } from "zustand";
import type { TableInfo } from "@/lib/types";

/** A tab in the central workspace — either a table data view or a SQL editor. Each tab belongs
 *  to a specific connection, so tabs from different connections can coexist (and be split). */
export interface WorkspaceTab {
  id: string;
  connectionId: string;
  kind: "table" | "query";
  title: string;
  /** For table tabs. */
  schema?: string;
  table?: string;
  /** For query tabs (last edited SQL is retained while the tab is open). */
  sql?: string;
}

interface WorkspaceState {
  /** Connections currently open (pools alive in the backend), in the order they were opened. */
  openConnectionIds: string[];
  /** The focused connection — drives the schema-tree sidebar and where new tabs are created. */
  activeConnectionId: string | null;
  /** Show the Connection Hub over the workspace (to open/manage another connection). */
  hubOpen: boolean;
  tabs: WorkspaceTab[];
  /** The tab shown in the primary (left) pane. */
  activeTabId: string | null;
  /** The tab pinned to the secondary (right) pane when split-view is active; null = no split.
   *  May belong to a different connection than the active tab (compare two databases). */
  secondaryTabId: string | null;

  /** Open (or focus) a connection and make it active. */
  openConnection: (connectionId: string) => void;
  /** Focus an already-open connection (sidebar follows; activates its most-recent tab). */
  setActiveConnection: (connectionId: string) => void;
  /** Close a connection: remove it and its tabs, then pick a new active connection. */
  closeConnection: (connectionId: string) => void;
  setHubOpen: (open: boolean) => void;

  openTableTab: (table: Pick<TableInfo, "schema" | "name">) => void;
  openQueryTab: () => void;
  setTabSql: (tabId: string, sql: string) => void;
  setActiveTab: (tabId: string) => void;
  /** Pin a tab to the right pane (or unpin it if already pinned). Max 2 panes. */
  toggleSecondaryTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
}

let queryCounter = 0;

function tableTabId(connectionId: string, schema: string, table: string): string {
  return `table:${connectionId}:${schema}.${table}`;
}

/** The most-recently-added tab for a connection, or null if it has none. */
function lastTabOf(tabs: WorkspaceTab[], connectionId: string | null): string | null {
  if (!connectionId) return null;
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].connectionId === connectionId) return tabs[i].id;
  }
  return null;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  openConnectionIds: [],
  activeConnectionId: null,
  hubOpen: false,
  tabs: [],
  activeTabId: null,
  secondaryTabId: null,

  openConnection: (connectionId) =>
    set((state) => ({
      openConnectionIds: state.openConnectionIds.includes(connectionId)
        ? state.openConnectionIds
        : [...state.openConnectionIds, connectionId],
      activeConnectionId: connectionId,
      hubOpen: false,
      activeTabId: lastTabOf(state.tabs, connectionId),
    })),

  setActiveConnection: (connectionId) =>
    set((state) => ({
      activeConnectionId: connectionId,
      activeTabId: lastTabOf(state.tabs, connectionId),
    })),

  setHubOpen: (open) => set({ hubOpen: open }),

  closeConnection: (connectionId) =>
    set((state) => {
      const openConnectionIds = state.openConnectionIds.filter((id) => id !== connectionId);
      const tabs = state.tabs.filter((t) => t.connectionId !== connectionId);
      let activeConnectionId = state.activeConnectionId;
      if (activeConnectionId === connectionId) {
        activeConnectionId = openConnectionIds[openConnectionIds.length - 1] ?? null;
      }
      let activeTabId = state.activeTabId;
      if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
        activeTabId = lastTabOf(tabs, activeConnectionId);
      }
      const secondaryTabId =
        state.secondaryTabId && tabs.some((t) => t.id === state.secondaryTabId)
          ? state.secondaryTabId
          : null;
      // Returning to no open connections shows the hub (driven by openConnectionIds in App).
      return { openConnectionIds, tabs, activeConnectionId, activeTabId, secondaryTabId };
    }),

  openTableTab: (table) =>
    set((state) => {
      const connectionId = state.activeConnectionId;
      if (!connectionId) return {};
      const id = tableTabId(connectionId, table.schema, table.name);
      if (state.tabs.some((t) => t.id === id)) {
        return { activeTabId: id };
      }
      const tab: WorkspaceTab = {
        id,
        connectionId,
        kind: "table",
        title: table.name,
        schema: table.schema,
        table: table.name,
      };
      return { tabs: [...state.tabs, tab], activeTabId: id };
    }),

  openQueryTab: () =>
    set((state) => {
      const connectionId = state.activeConnectionId;
      if (!connectionId) return {};
      queryCounter += 1;
      const id = `query:${connectionId}:${queryCounter}`;
      const tab: WorkspaceTab = {
        id,
        connectionId,
        kind: "query",
        title: `Query ${queryCounter}`,
        sql: "",
      };
      return { tabs: [...state.tabs, tab], activeTabId: id };
    }),

  setTabSql: (tabId, sql) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sql } : t)),
    })),

  setActiveTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      return {
        activeTabId: tabId,
        // Focusing a tab follows its connection (sidebar + new-tab target track the active pane).
        activeConnectionId: tab ? tab.connectionId : state.activeConnectionId,
        // Focusing the pinned tab collapses the split rather than leaving a stale right pane.
        secondaryTabId: state.secondaryTabId === tabId ? null : state.secondaryTabId,
      };
    }),

  toggleSecondaryTab: (tabId) =>
    set((state) => {
      // A tab can't be split against itself; ignore the request on the active tab.
      if (tabId === state.activeTabId) return {};
      return { secondaryTabId: state.secondaryTabId === tabId ? null : tabId };
    }),

  closeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      let activeTabId = state.activeTabId;
      let activeConnectionId = state.activeConnectionId;
      if (activeTabId === tabId) {
        // Prefer another tab of the same connection; else fall back to any remaining tab.
        const next =
          lastTabOf(tabs, activeConnectionId) ?? tabs[tabs.length - 1]?.id ?? null;
        activeTabId = next;
        const nextTab = tabs.find((t) => t.id === next);
        if (nextTab) activeConnectionId = nextTab.connectionId;
      }
      const secondaryTabId = state.secondaryTabId === tabId ? null : state.secondaryTabId;
      return { tabs, activeTabId, activeConnectionId, secondaryTabId };
    }),
}));
