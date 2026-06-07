import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookMarked } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/types";
import * as ipc from "@/lib/ipc";

/**
 * Saved Queries — read-only list of query-mcp snippets (queries saved from Claude sessions).
 * Selecting one inserts its SQL into the console at the cursor.
 */
export function SavedQueriesMenu({ onInsert }: { onInsert: (sql: string) => void }) {
  const [open, setOpen] = useState(false);
  const queries = useQuery({
    queryKey: ["savedQueries"],
    queryFn: ipc.listSavedQueries,
    enabled: open,
    refetchOnMount: "always",
  });

  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
        <BookMarked className="h-3.5 w-3.5" />
        Saved Queries
      </Button>
      {open ? (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-96 overflow-y-auto rounded-md border border-border bg-surface-raised shadow-xl">
            {queries.isLoading ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : queries.isError ? (
              <p className="selectable p-3 text-xs text-destructive">
                {errorMessage(queries.error)}
              </p>
            ) : queries.data && queries.data.length > 0 ? (
              queries.data.map((q) => (
                <button
                  key={q.name}
                  className="block w-full px-3 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    onInsert(q.sql);
                    setOpen(false);
                  }}
                >
                  <span className="block truncate text-xs font-medium">{q.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {q.description ?? q.sql}
                  </span>
                </button>
              ))
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                No saved queries yet. Ask Claude to save one (query-mcp `save_snippet`) and it
                will show up here.
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
