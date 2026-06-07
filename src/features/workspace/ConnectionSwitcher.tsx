import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useConnections, useDisconnect } from "@/features/connections/useConnections";
import { CONNECTION_COLOR_CLASS } from "@/features/connections/connectionDefaults";

/** Header dropdown that switches the active (focused) connection, disconnects one, or opens
 *  another from the hub. Drives which schema tree + new-tab target the workspace uses. */
export function ConnectionSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openConnectionIds = useWorkspaceStore((s) => s.openConnectionIds);
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const setActiveConnection = useWorkspaceStore((s) => s.setActiveConnection);
  const closeConnection = useWorkspaceStore((s) => s.closeConnection);
  const setHubOpen = useWorkspaceStore((s) => s.setHubOpen);

  const { data: connections } = useConnections();
  const disconnect = useDisconnect();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const byId = (id: string): ConnectionConfig | undefined => connections?.find((c) => c.id === id);
  const active = activeConnectionId ? byId(activeConnectionId) : undefined;

  const onDisconnect = async (id: string) => {
    await disconnect.mutateAsync(id).catch(() => undefined);
    closeConnection(id);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/60"
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            CONNECTION_COLOR_CLASS[active?.color ?? "primary"],
          )}
        />
        <span className="text-sm font-semibold">{active?.label || active?.host || "Connection"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-64 overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg"
        >
          <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Open connections
          </p>
          {openConnectionIds.map((id) => {
            const conn = byId(id);
            const isActive = id === activeConnectionId;
            return (
              <div
                key={id}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5",
                  isActive ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveConnection(id);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      CONNECTION_COLOR_CLASS[conn?.color ?? "primary"],
                    )}
                  />
                  <span className="truncate text-sm">{conn?.label || conn?.host || id}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDisconnect(id)}
                  aria-label="Disconnect"
                  title="Disconnect"
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <div className="my-1 border-t border-border/60" />
          <button
            type="button"
            onClick={() => {
              setHubOpen(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Open another connection…
          </button>
        </div>
      ) : null}
    </div>
  );
}
