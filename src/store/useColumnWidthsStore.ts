import { create } from "zustand";

/** Per-table column widths (px), keyed by a `connectionId/schema/table` string, then column name.
 *  Persisted to localStorage (like useHistoryStore) so a table's layout survives reopening. */
type WidthsByTable = Record<string, Record<string, number>>;

const STORAGE_KEY = "tablesplusplus-column-widths";

function readInitial(): WidthsByTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WidthsByTable) : {};
  } catch {
    return {};
  }
}

function persist(widths: WidthsByTable) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Best-effort.
  }
}

interface ColumnWidthsState {
  widths: WidthsByTable;
  setWidth: (tableKey: string, column: string, width: number) => void;
}

export const useColumnWidthsStore = create<ColumnWidthsState>((set, get) => ({
  widths: readInitial(),
  setWidth: (tableKey, column, width) => {
    const widths = {
      ...get().widths,
      [tableKey]: { ...get().widths[tableKey], [column]: width },
    };
    persist(widths);
    set({ widths });
  },
}));
