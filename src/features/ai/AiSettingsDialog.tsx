import { useEffect, useState } from "react";
import { Check, KeyRound, Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { errorMessage, type AiProvider } from "@/lib/types";
import { useAiGenerate, useAiSettings, useSaveAiSettings } from "./useAi";

const PROVIDERS: { value: AiProvider; label: string; defaultModel: string; hint: string }[] = [
  {
    value: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-opus-4-8",
    hint: "e.g. claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5",
  },
  {
    value: "openAi",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    hint: "e.g. gpt-4o, gpt-4o-mini",
  },
  {
    value: "openRouter",
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-4-6",
    hint: "e.g. anthropic/claude-sonnet-4-6, openai/gpt-4o",
  },
];

type Status =
  | { state: "idle" }
  | { state: "saved" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "error"; message: string };

export function AiSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: settings } = useAiSettings();
  const save = useSaveAiSettings();
  const test = useAiGenerate();

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("claude-opus-4-8");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [initialized, setInitialized] = useState(false);

  // Initialize the form once per open. Re-running on every `settings` change would wipe
  // unsaved edits whenever the cache updates (e.g. after a save, or a background refetch).
  useEffect(() => {
    if (!open) {
      setInitialized(false);
    } else if (!initialized && settings) {
      setProvider(settings.provider);
      setModel(settings.model);
      setApiKey("");
      setStatus({ state: "idle" });
      setInitialized(true);
    }
  }, [open, settings, initialized]);

  const meta = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];

  const onProviderChange = (next: AiProvider) => {
    setProvider(next);
    setModel(PROVIDERS.find((p) => p.value === next)?.defaultModel ?? "");
    setStatus({ state: "idle" });
  };

  const persist = async () => {
    await save.mutateAsync({ provider, model, apiKey: apiKey || null });
  };

  const onSave = async () => {
    try {
      await persist();
      setApiKey("");
      setStatus({ state: "saved" });
    } catch (err) {
      setStatus({ state: "error", message: errorMessage(err) });
    }
  };

  const onTest = async () => {
    setStatus({ state: "testing" });
    try {
      await persist();
      setApiKey("");
      await test.mutateAsync({
        system: "Reply with the single word: OK.",
        prompt: "ping",
      });
      setStatus({ state: "ok" });
    } catch (err) {
      setStatus({ state: "error", message: errorMessage(err) });
    }
  };

  const keyStored = settings?.hasKey ?? false;

  return (
    <Dialog open={open} onClose={onClose} title="AI Assistant">
      <div className="space-y-4 p-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Connect a provider to generate, explain, and fix SQL. Your key is stored in the OS
          keyring — never on disk.
        </p>

        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={provider} onChange={(e) => onProviderChange(e.target.value as AiProvider)}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Model</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>API Key</Label>
            {keyStored ? (
              <Badge variant="success" className="gap-1">
                <KeyRound className="h-3 w-3" /> stored
              </Badge>
            ) : null}
          </div>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyStored ? "•••••• (leave blank to keep)" : "Paste your API key"}
            autoComplete="off"
          />
        </div>

        <StatusLine status={status} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button variant="secondary" onClick={onTest} disabled={status.state === "testing"}>
          {status.state === "testing" ? <Spinner /> : null}
          Save &amp; Test
        </Button>
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === "idle") return null;
  if (status.state === "error") {
    return <p className="selectable text-xs text-destructive">{status.message}</p>;
  }
  const label =
    status.state === "ok"
      ? "Connection works — you're ready to go."
      : status.state === "saved"
        ? "Settings saved."
        : "Testing…";
  return (
    <p className="flex items-center gap-1.5 text-xs text-success">
      {status.state !== "testing" ? <Check className="h-3.5 w-3.5" /> : <Spinner />}
      {label}
    </p>
  );
}
