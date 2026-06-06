import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import "@/store/useThemeStore"; // apply the saved/dark-default theme before first paint
import "@/lib/monaco"; // self-host Monaco (no CDN) before any editor mounts
import "@/styles/globals.css";

// Server/async state lives in TanStack Query; UI state in Zustand (CLAUDE.md §5.2).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
