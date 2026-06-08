import { create } from "zustand";
import type { ConnectionConfig, TableInfo } from "@/lib/types";
import type { QuickFilter } from "@/features/workspace/sql";

/** A database opened on an existing server as a session connection (database switcher). It reuses
 *  the parent (persisted) connection's credentials and is not saved; `rootId` is that parent's id
 *  (used to open further databases / resolve the secret). */
export interface SessionConnection {
  config: ConnectionConfig;
  rootId: string;
}

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
  /** For table tabs opened/re-targeted via a foreign-key jump: the filter the grid should apply.
   *  `filterRev` bumps on each jump so the grid re-applies even when the tab already existed. */
  tableFilter?: QuickFilter;
  filterRev?: number;
}

interface WorkspaceState {
  /** Connections currently open (pools alive in the backend), in the order they were opened. */
  openConnectionIds: string[];
  /** Session connections (database-switcher targets); their metadata isn't in the saved list. */
  sessionConnections: SessionConnection[];
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
  /** Register a session connection (its pool is already open in the backend) and focus it. */
  addSessionConnection: (config: ConnectionConfig, rootId: string) => void;
  /** Focus an already-open connection (sidebar follows; activates its most-recent tab). */
  setActiveConnection: (connectionId: string) => void;
  /** Close a connection: remove it and its tabs, then pick a new active connection. */
  closeConnection: (connectionId: string) => void;
  setHubOpen: (open: boolean) => void;

  /** Open (or focus) a table tab. An optional `filter` is applied by the grid — used by the
   *  foreign-key jump to land pre-filtered on the referenced row. */
  openTableTab: (table: Pick<TableInfo, "schema" | "name">, filter?: QuickFilter) => void;
  /** Open a new SQL tab; `initial` pre-fills it (e.g. a saved query from the sidebar). */
  openQueryTab: (initial?: { title?: string; sql?: string }) => void;
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

/** Keep a secondary (split) pane only if it's still a valid, *distinct* second tab: there must be
 *  an active tab, and the secondary must still exist and differ from it. Otherwise collapse the
 *  split (null) so we never render a stale tab solo or duplicate the active tab. */
function keepSecondary(
  secondaryTabId: string | null,
  tabs: WorkspaceTab[],
  activeTabId: string | null,
): string | null {
  if (!activeTabId || !secondaryTabId || secondaryTabId === activeTabId) return null;
  return tabs.some((t) => t.id === secondaryTabId) ? secondaryTabId : null;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  openConnectionIds: [],
  sessionConnections: [],
  activeConnectionId: null,
  hubOpen: false,
  tabs: [],
  activeTabId: null,
  secondaryTabId: null,

  openConnection: (connectionId) =>
    set((state) => {
      const activeTabId = lastTabOf(state.tabs, connectionId);
      return {
        openConnectionIds: state.openConnectionIds.includes(connectionId)
          ? state.openConnectionIds
          : [...state.openConnectionIds, connectionId],
        activeConnectionId: connectionId,
        hubOpen: false,
        activeTabId,
        secondaryTabId: keepSecondary(state.secondaryTabId, state.tabs, activeTabId),
      };
    }),

  addSessionConnection: (config, rootId) =>
    set((state) => {
      const sessionConnections = state.sessionConnections.some((s) => s.config.id === config.id)
        ? state.sessionConnections
        : [...state.sessionConnections, { config, rootId }];
      const openConnectionIds = state.openConnectionIds.includes(config.id)
        ? state.openConnectionIds
        : [...state.openConnectionIds, config.id];
      const activeTabId = lastTabOf(state.tabs, config.id);
      return {
        sessionConnections,
        openConnectionIds,
        activeConnectionId: config.id,
        hubOpen: false,
        activeTabId,
        secondaryTabId: keepSecondary(state.secondaryTabId, state.tabs, activeTabId),
      };
    }),

  setActiveConnection: (connectionId) =>
    set((state) => {
      const activeTabId = lastTabOf(state.tabs, connectionId);
      return {
        activeConnectionId: connectionId,
        activeTabId,
        secondaryTabId: keepSecondary(state.secondaryTabId, state.tabs, activeTabId),
      };
    }),

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
      const secondaryTabId = keepSecondary(state.secondaryTabId, tabs, activeTabId);
      // Drop the session-connection entry too (if this was one), so it leaves the switcher.
      const sessionConnections = state.sessionConnections.filter(
        (s) => s.config.id !== connectionId,
      );
      // Returning to no open connections shows the hub (driven by openConnectionIds in App).
      return {
        openConnectionIds,
        sessionConnections,
        tabs,
        activeConnectionId,
        activeTabId,
        secondaryTabId,
      };
    }),

  openTableTab: (table, filter) =>
    set((state) => {
      const connectionId = state.activeConnectionId;
      if (!connectionId) return {};
      const id = tableTabId(connectionId, table.schema, table.name);
      const existing = state.tabs.find((t) => t.id === id);
      if (existing) {
        // Re-target an open tab. Only touch its filter when a jump supplied one (a plain reopen
        // leaves the tab's current filter alone); bump filterRev so the grid re-applies it.
        const tabs = filter
          ? state.tabs.map((t) =>
              t.id === id ? { ...t, tableFilter: filter, filterRev: (t.filterRev ?? 0) + 1 } : t,
            )
          : state.tabs;
        return { tabs, activeTabId: id };
      }
      const tab: WorkspaceTab = {
        id,
        connectionId,
        kind: "table",
        title: table.name,
        schema: table.schema,
        table: table.name,
        tableFilter: filter,
        filterRev: filter ? 1 : 0,
      };
      return { tabs: [...state.tabs, tab], activeTabId: id };
    }),

  openQueryTab: (initial) =>
    set((state) => {
      const connectionId = state.activeConnectionId;
      if (!connectionId) return {};
      queryCounter += 1;
      const id = `query:${connectionId}:${queryCounter}`;
      const tab: WorkspaceTab = {
        id,
        connectionId,
        kind: "query",
        title: initial?.title ?? `Query ${queryCounter}`,
        sql: initial?.sql ?? "",
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
      const secondaryTabId = keepSecondary(state.secondaryTabId, tabs, activeTabId);
      return { tabs, activeTabId, activeConnectionId, secondaryTabId };
    }),
}));
