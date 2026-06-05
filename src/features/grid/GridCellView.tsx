import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CellValue } from "@/lib/types";
import { displayCell, editableText, isEditable } from "./cell";

interface GridCellViewProps {
  width: number;
  value: CellValue;
  /** The locally-edited value, if this cell has been changed. */
  edited?: CellValue;
  onCommit: (raw: string) => void;
}

/** A single grid cell. Double-click to edit scalar values; Enter commits, Esc cancels. */
export function GridCellView({ width, value, edited, onCommit }: GridCellViewProps) {
  const [editing, setEditing] = useState(false);
  const display = edited ?? value;
  const isNull = display.kind === "null";

  const startEdit = () => {
    if (isEditable(value)) setEditing(true);
  };

  return (
    <div
      style={{ width }}
      onDoubleClick={startEdit}
      className={cn(
        "flex h-full shrink-0 items-center border-r border-border/60 px-2 text-sm",
        edited ? "bg-warning/20" : "",
      )}
    >
      {editing ? (
        <CellEditor
          initial={editableText(display)}
          onDone={(raw, changed) => {
            setEditing(false);
            if (changed) onCommit(raw);
          }}
        />
      ) : (
        <span
          className={cn(
            "selectable truncate",
            isNull ? "italic text-muted-foreground/60" : "",
            display.kind === "int" || display.kind === "float" || display.kind === "decimal"
              ? "tabular-nums"
              : "",
          )}
          title={displayCell(display)}
        >
          {displayCell(display)}
        </span>
      )}
    </div>
  );
}

function CellEditor({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (raw: string, changed: boolean) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Enter/Esc unmounts the input, which also fires blur → guard against a double onDone.
  const doneRef = useRef(false);

  const handleDone = (raw: string, changed: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(raw, changed);
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => handleDone(text, text !== initial)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleDone(text, text !== initial);
        } else if (e.key === "Escape") {
          e.preventDefault();
          handleDone(initial, false);
        }
      }}
      className="selectable h-6 w-full rounded-sm border border-ring bg-background px-1 text-sm outline-none"
    />
  );
}
