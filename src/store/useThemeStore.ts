import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tablesplusplus-theme";

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage may be unavailable; fall through to the default.
  }
  return "dark"; // lean dark by default
}

function applyTheme(theme: Theme) {
  // Guard for non-browser environments (e.g. unit tests importing this module under Node).
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

// Apply at import time (before React renders) so there's no light/dark flash.
const initial = readInitial();
applyTheme(initial);

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persisting is best-effort.
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
