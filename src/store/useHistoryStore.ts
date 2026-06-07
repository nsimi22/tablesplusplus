import { create } from "zustand";

/** A recorded console query execution. */
export interface HistoryEntry {
  id: string;
  /** The connection the query ran against. */
  connectionId: string;
  sql: string;
  status: "ok" | "error";
  /** Row count (ok, row-returning) or affected rows; undefined for errors. */
  rowCount?: number;
  elapsedMs?: number;
  /** Error message (status === "error"). */
  error?: string;
  /** Epoch milliseconds when the query ran. */
  at: number;
}

const STORAGE_KEY = "tablesplusplus-history";
/** Cap the stored history so localStorage stays small; oldest entries are dropped. */
const MAX_ENTRIES = 200;

function readInitial(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // Corrupt or unavailable storage — start empty rather than crashing.
    return [];
  }
}

function persist(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Persisting is best-effort.
  }
}

interface HistoryState {
  /** Most-recent-first. */
  entries: HistoryEntry[];
  add: (entry: Omit<HistoryEntry, "id" | "at">) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: readInitial(),
  add: (entry) => {
    const full: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${seq++}`,
      at: Date.now(),
    };
    const entries = [full, ...get().entries].slice(0, MAX_ENTRIES);
    persist(entries);
    set({ entries });
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    persist(entries);
    set({ entries });
  },
  clear: () => {
    persist([]);
    set({ entries: [] });
  },
}));
