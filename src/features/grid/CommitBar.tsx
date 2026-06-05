import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

interface CommitBarProps {
  editCount: number;
  canCommit: boolean;
  noPrimaryKey: boolean;
  committing: boolean;
  error: string | null;
  onDiscard: () => void;
  onCommit: () => void;
}

/** Floating bar summarizing pending edits and batch-committing them (Module C). */
export function CommitBar({
  editCount,
  canCommit,
  noPrimaryKey,
  committing,
  error,
  onDiscard,
  onCommit,
}: CommitBarProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 m-3 ml-auto flex max-w-2xl flex-col gap-1.5 rounded-lg border border-border bg-surface-raised p-3 shadow-lg">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-warning" />
          {editCount} edited row{editCount === 1 ? "" : "s"}
        </span>

        {noPrimaryKey ? (
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            No primary key — changes can't be committed safely.
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onDiscard} disabled={committing}>
            <X className="h-4 w-4" />
            Discard
          </Button>
          <Button size="sm" onClick={onCommit} disabled={!canCommit || committing}>
            {committing ? <Spinner /> : <Check className="h-4 w-4" />}
            Commit Changes
          </Button>
        </div>
      </div>

      {error ? <p className="selectable text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
