import { useState } from "react";
import { Check, AlertCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { errorMessage, type ConnectionConfig, type ConnectionInput, type Engine } from "@/lib/types";
import {
  CONNECTION_COLORS,
  DEFAULT_PORTS,
  ENGINES,
  SSL_MODES,
  emptyConnectionInput,
} from "./connectionDefaults";
import {
  useSaveConnection,
  useTestConnection,
  useUpdateConnection,
} from "./useConnections";

interface ConnectionFormProps {
  editing: ConnectionConfig | null;
  onSaved: (id: string) => void;
}

function toInput(config: ConnectionConfig): ConnectionInput {
  return {
    engine: config.engine,
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    sslMode: config.sslMode,
    ssh: config.ssh,
    label: config.label ?? "",
    color: config.color ?? "primary",
    password: "", // never echoed back; blank means "leave unchanged"
  };
}

// Static class map so Tailwind's content scanner keeps these utilities.
const COLOR_BG: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "error"; message: string };

export function ConnectionForm({ editing, onSaved }: ConnectionFormProps) {
  const [input, setInput] = useState<ConnectionInput>(() =>
    editing ? toInput(editing) : emptyConnectionInput(),
  );
  const [test, setTest] = useState<TestStatus>({ state: "idle" });

  const save = useSaveConnection();
  const update = useUpdateConnection();
  const testConn = useTestConnection();

  const patch = (partial: Partial<ConnectionInput>) => {
    setInput((prev) => ({ ...prev, ...partial }));
    setTest({ state: "idle" });
  };

  const onEngineChange = (engine: Engine) => {
    // Move the port to the new engine's default only if it still matched the old default.
    const wasDefault = input.port === DEFAULT_PORTS[input.engine];
    patch({ engine, port: wasDefault ? DEFAULT_PORTS[engine] : input.port });
  };

  const onTest = async () => {
    setTest({ state: "testing" });
    try {
      // Test the live form values (including the typed password), not the stored secret.
      await testConn.mutateAsync({ input });
      setTest({ state: "ok" });
    } catch (err) {
      setTest({ state: "error", message: errorMessage(err) });
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        const saved = await update.mutateAsync({ id: editing.id, input });
        onSaved(saved.id);
      } else {
        const saved = await save.mutateAsync(input);
        onSaved(saved.id);
      }
    } catch (err) {
      setTest({ state: "error", message: errorMessage(err) });
    }
  };

  const saving = save.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2">
            <Input
              value={input.label ?? ""}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="My database"
            />
          </Field>

          <Field label="Engine">
            <Select
              value={input.engine}
              onChange={(e) => onEngineChange(e.target.value as Engine)}
            >
              {ENGINES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="SSL Mode">
            <Select
              value={input.sslMode}
              onChange={(e) => patch({ sslMode: e.target.value as ConnectionInput["sslMode"] })}
            >
              {SSL_MODES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Host" className="col-span-2">
            <Input
              value={input.host}
              onChange={(e) => patch({ host: e.target.value })}
              placeholder="localhost"
            />
          </Field>

          <Field label="Port">
            <Input
              type="number"
              value={input.port}
              onChange={(e) => patch({ port: Number(e.target.value) || 0 })}
            />
          </Field>

          <Field label="Database">
            <Input
              value={input.database}
              onChange={(e) => patch({ database: e.target.value })}
              placeholder="postgres"
            />
          </Field>

          <Field label="User">
            <Input
              value={input.user}
              onChange={(e) => patch({ user: e.target.value })}
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              value={input.password ?? ""}
              onChange={(e) => patch({ password: e.target.value })}
              placeholder={editing ? "•••••• (unchanged)" : ""}
              autoComplete="off"
            />
          </Field>

          <Field label="Color" className="col-span-2">
            <div className="flex gap-2">
              {CONNECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => patch({ color: c })}
                  className={cn(
                    "h-6 w-6 rounded-full border-2 transition",
                    COLOR_BG[c],
                    input.color === c ? "border-foreground" : "border-transparent",
                  )}
                />
              ))}
            </div>
          </Field>
        </div>

        <TestResult status={test} />
      </div>

      <div className="flex items-center justify-between border-t border-border p-4">
        <Button type="button" variant="secondary" onClick={onTest} disabled={test.state === "testing"}>
          {test.state === "testing" ? <Spinner /> : <Plug className="h-4 w-4" />}
          Test Connection
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          {editing ? "Save Changes" : "Create Connection"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TestResult({ status }: { status: TestStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "ok") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-success">
        <Check className="h-4 w-4" />
        <span>Connection successful</span>
      </div>
    );
  }
  if (status.state === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="selectable break-words">{status.message}</span>
      </div>
    );
  }
  return null;
}
