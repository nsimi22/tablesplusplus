import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clipboard, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import type { ExportFormat } from "./exportActions";

interface ExportMenuProps {
  /** Run the export for the chosen format. Must handle its own errors (never rejects). */
  onExport: (format: ExportFormat) => void | Promise<void>;
  /** Optional "copy to clipboard" action. Must handle its own errors. */
  onCopy?: () => void | Promise<void>;
  disabled?: boolean;
  /** Hint shown under the menu items (e.g. "Entire table" vs "These results"). */
  scopeHint?: string;
}

/** Compact "Export ▾" dropdown (CSV / JSON / Copy). Self-contained: closes on outside click. */
export function ExportMenu({ onExport, onCopy, disabled, scopeHint }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const run = async (fn: () => void | Promise<void>) => {
    setOpen(false);
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
        Export
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1 min-w-44 overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg"
        >
          <MenuItem onClick={() => run(() => onExport("csv"))}>
            <Download className="h-3.5 w-3.5" />
            Export as CSV
          </MenuItem>
          <MenuItem onClick={() => run(() => onExport("json"))}>
            <Download className="h-3.5 w-3.5" />
            Export as JSON
          </MenuItem>
          {onCopy ? (
            <MenuItem onClick={() => run(onCopy)}>
              <Clipboard className="h-3.5 w-3.5" />
              Copy to clipboard
            </MenuItem>
          ) : null}
          {scopeHint ? (
            <div className="border-t border-border/60 px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground">
              {scopeHint}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground",
        "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
