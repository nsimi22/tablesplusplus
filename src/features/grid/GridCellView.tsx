import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellValue } from "@/lib/types";
import { displayCell, editableText, isEditable } from "./cell";

interface GridCellViewProps {
  width: number;
  value: CellValue;
  /** The locally-edited value, if this cell has been changed. */
  edited?: CellValue;
  /** When true, the cell is read-only (e.g. a row marked for deletion). */
  disabled?: boolean;
  /** Open the full-value detail viewer for this cell (grid data rows only). */
  onExpand?: () => void;
  onCommit: (raw: string) => void;
}

/** A single grid cell. Double-click to edit scalar values; Enter commits, Esc cancels.
 *  Non-editable values (json/bytes) open the detail viewer on double-click instead. */
export function GridCellView({ width, value, edited, disabled, onExpand, onCommit }: GridCellViewProps) {
  const [editing, setEditing] = useState(false);

  // Close an open editor if the row becomes read-only (e.g. marked for deletion mid-edit).
  useEffect(() => {
    if (disabled) setEditing(false);
  }, [disabled]);

  const display = edited ?? value;
  const isNull = display.kind === "null";
  const text = displayCell(display);

  const onDoubleClick = () => {
    if (disabled) return;
    if (isEditable(value)) setEditing(true);
    else onExpand?.(); // json/bytes can't be inline-edited — show them in the viewer
  };

  return (
    <div
      style={{ width }}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group/cell relative flex h-full shrink-0 items-center border-r border-border/60 px-2 text-sm",
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
        <>
          <span
            className={cn(
              "selectable truncate",
              isNull ? "italic text-muted-foreground/60" : "",
              display.kind === "int" || display.kind === "float" || display.kind === "decimal"
                ? "tabular-nums"
                : "",
            )}
            title={text}
          >
            {text}
          </span>
          {onExpand && !disabled ? (
            <button
              type="button"
              onClick={onExpand}
              aria-label="View full value"
              title="View full value"
              className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded bg-surface-raised/90 p-0.5 text-muted-foreground hover:text-foreground group-hover/cell:block"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          ) : null}
        </>
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
