import { create } from "zustand";
import type { TableInfo } from "@/lib/types";

/** A tab in the central workspace — either a table data view or a SQL editor. */
export interface WorkspaceTab {
  id: string;
  kind: "table" | "query";
  title: string;
  /** For table tabs. */
  schema?: string;
  table?: string;
  /** For query tabs (last edited SQL is retained while the tab is open). */
  sql?: string;
}

interface WorkspaceState {
  /** The connection currently open in the workspace; null shows the Connection Hub. */
  activeConnectionId: string | null;
  tabs: WorkspaceTab[];
  /** The tab shown in the primary (left) pane. */
  activeTabId: string | null;
  /** The tab pinned to the secondary (right) pane when split-view is active; null = no split. */
  secondaryTabId: string | null;

  enterWorkspace: (connectionId: string) => void;
  leaveWorkspace: () => void;

  openTableTab: (table: Pick<TableInfo, "schema" | "name">) => void;
  openQueryTab: () => void;
  setTabSql: (tabId: string, sql: string) => void;
  setActiveTab: (tabId: string) => void;
  /** Pin a tab to the right pane (or unpin it if already pinned). Max 2 panes. */
  toggleSecondaryTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
}

let queryCounter = 0;

function tableTabId(schema: string, table: string): string {
  return `table:${schema}.${table}`;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeConnectionId: null,
  tabs: [],
  activeTabId: null,
  secondaryTabId: null,

  enterWorkspace: (connectionId) =>
    set({ activeConnectionId: connectionId, tabs: [], activeTabId: null, secondaryTabId: null }),

  leaveWorkspace: () =>
    set({ activeConnectionId: null, tabs: [], activeTabId: null, secondaryTabId: null }),

  openTableTab: (table) =>
    set((state) => {
      const id = tableTabId(table.schema, table.name);
      if (state.tabs.some((t) => t.id === id)) {
        return { activeTabId: id };
      }
      const tab: WorkspaceTab = {
        id,
        kind: "table",
        title: table.name,
        schema: table.schema,
        table: table.name,
      };
      return { tabs: [...state.tabs, tab], activeTabId: id };
    }),

  openQueryTab: () =>
    set((state) => {
      queryCounter += 1;
      const id = `query:${queryCounter}`;
      const tab: WorkspaceTab = {
        id,
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
    set((state) => ({
      activeTabId: tabId,
      // Focusing the pinned tab collapses the split rather than leaving a stale right pane.
      secondaryTabId: state.secondaryTabId === tabId ? null : state.secondaryTabId,
    })),

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
      if (activeTabId === tabId) {
        activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
      }
      // Closing the pinned tab also exits the split.
      const secondaryTabId = state.secondaryTabId === tabId ? null : state.secondaryTabId;
      return { tabs, activeTabId, secondaryTabId };
    }),
}));
