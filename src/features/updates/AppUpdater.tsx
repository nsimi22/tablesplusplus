import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/types";

type Phase = "idle" | "downloading" | "error";

/**
 * On startup, asks the Tauri updater whether a newer signed release is available and, if so,
 * shows a prompt to download + install it. The download/install run in the Rust plugin (not the
 * webview), so the strict CSP is unaffected. In a plain browser (`npm run dev`) `check()` throws
 * and we stay silent.
 */
export function AppUpdater() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await check();
        if (!cancelled && found?.available) setUpdate(found);
      } catch {
        // No updater available (dev/web), offline, or no release yet — stay silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setMessage(null);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(errorMessage(err));
    }
  }, [update]);

  // Release the underlying Tauri resource handle when dismissed.
  const dismiss = useCallback(() => {
    update?.close().catch(() => undefined);
    setUpdate(null);
  }, [update]);

  if (!update) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-surface-raised p-3 shadow-xl">
      <div className="flex items-start gap-2">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">Update available</p>
          <p className="text-xs text-muted-foreground">
            Version {update.version} is ready to install.
          </p>
        </div>
        {phase !== "downloading" ? (
          <button
            onClick={dismiss}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {message ? <p className="selectable mt-2 text-xs text-destructive">{message}</p> : null}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={phase === "downloading"}>
          Later
        </Button>
        <Button size="sm" onClick={install} disabled={phase === "downloading"}>
          {phase === "downloading" ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
          {phase === "downloading" ? "Installing…" : "Install & Restart"}
        </Button>
      </div>
    </div>
  );
}
