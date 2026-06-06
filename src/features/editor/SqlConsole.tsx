import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { useMonaco, type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Lightbulb, Play, Settings2, Sparkles, Wand2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage, type ConnectionConfig, type QueryResult, type Schema } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useSchema } from "@/features/workspace/hooks";
import * as ipc from "@/lib/ipc";
import { useAiGenerate } from "@/features/ai/useAi";
import { AiSettingsDialog } from "@/features/ai/AiSettingsDialog";
import { explainPrompts, fixPrompts, stripSqlFences, textToSqlPrompts } from "@/features/ai/prompts";
import { ResultView } from "./ResultView";

type MonacoApi = Parameters<OnMount>[1];
type CodeEditor = Parameters<OnMount>[0];

// Monaco is a global singleton; register the schema-aware provider once and let it read the
// active connection's schema from a module-level ref (all query tabs share one connection).
let providerRegistered = false;
let activeSchema: Schema | undefined;

const DARK_THEME = "tablesplusplus-dark";
const LIGHT_THEME = "tablesplusplus-light";

let themesDefined = false;

function ensureThemes(monaco: MonacoApi) {
  // Monaco is a global singleton; define each theme only once (defineTheme on every toggle is
  // redundant). Themes require hex (editor-internal; not Tailwind tokens); these approximate
  // the app's dark/light palettes.
  if (themesDefined) return;
  themesDefined = true;
  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#14171c",
      "editor.foreground": "#dadfe5",
      "editorLineNumber.foreground": "#4a525e",
      "editor.selectionBackground": "#2a3340",
      "editor.lineHighlightBackground": "#191d24",
    },
  });
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1f2733",
      "editorLineNumber.foreground": "#9aa4b2",
      "editor.selectionBackground": "#cfe3ff",
      "editor.lineHighlightBackground": "#f2f5f9",
    },
  });
}

function registerProvider(monaco: MonacoApi) {
  if (providerRegistered) return;
  providerRegistered = true;
  monaco.languages.registerCompletionItemProvider("sql", {
    provideCompletionItems(
      model: import("monaco-editor").editor.ITextModel,
      position: import("monaco-editor").Position,
    ) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const tables = [...(activeSchema?.tables ?? []), ...(activeSchema?.views ?? [])];
      const suggestions: import("monaco-editor").languages.CompletionItem[] = [];
      for (const t of tables) {
        suggestions.push({
          label: t.name,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: t.name,
          detail: `${t.kind} · ${t.schema}`,
          range,
        });
        for (const c of t.columns) {
          suggestions.push({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: c.name,
            detail: `${t.name}.${c.name} · ${c.dataType}`,
            range,
          });
        }
      }
      return { suggestions };
    },
  });
}

export function SqlConsole({
  connection,
  tabId,
}: {
  connection: ConnectionConfig;
  tabId: string;
}) {
  const sql = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId)?.sql ?? "");
  const setTabSql = useWorkspaceStore((s) => s.setTabSql);
  const { data: schema } = useSchema(connection.id);

  const appTheme = useThemeStore((s) => s.theme);
  const monacoTheme = appTheme === "dark" ? DARK_THEME : LIGHT_THEME;
  const monaco = useMonaco();
  // Re-apply the editor theme when the app theme toggles (setTheme is global to Monaco).
  useEffect(() => {
    if (monaco) {
      ensureThemes(monaco);
      monaco.editor.setTheme(monacoTheme);
    }
  }, [monaco, monacoTheme]);

  const ai = useAiGenerate();
  const editorRef = useRef<CodeEditor | null>(null);
  const runRef = useRef<() => void>(() => {});
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamedRows, setStreamedRows] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [showAiSettings, setShowAiSettings] = useState(false);

  useEffect(() => {
    activeSchema = schema;
  }, [schema]);

  /** The selected SQL if any, else the full editor contents. */
  const currentSql = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return sql;
    const model = ed.getModel();
    const selection = ed.getSelection();
    const text =
      selection && model && !selection.isEmpty() ? model.getValueInRange(selection) : ed.getValue();
    return text.trim();
  }, [sql]);

  /** Capture the edit target *before* the async request so a selection change mid-flight can't
   *  silently widen a "replace selection" into "replace whole document".
   *  "insert" → the selection (empty = cursor); "replace" → the selection, or the whole doc. */
  const captureRange = useCallback(
    (mode: "insert" | "replace"): import("monaco-editor").IRange | null => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (!ed || !model) return null;
      const selection = ed.getSelection();
      if (mode === "replace") {
        return selection && !selection.isEmpty() ? selection : model.getFullModelRange();
      }
      return selection ?? model.getFullModelRange();
    },
    [],
  );

  /** Apply AI output to the captured range via Monaco (preserves surrounding content + undo). */
  const applyEdit = useCallback(
    (range: import("monaco-editor").IRange | null, text: string) => {
      const ed = editorRef.current;
      if (!ed || !range) {
        setTabSql(tabId, text);
        return;
      }
      ed.executeEdits("ai-assistant", [{ range, text, forceMoveMarkers: true }]);
      ed.focus();
    },
    [tabId, setTabSql],
  );

  const generateSql = useCallback(async () => {
    const request = aiPrompt.trim();
    if (!request) return;
    setAiError(null);
    setAiNote(null);
    const range = captureRange("insert");
    try {
      const { system, prompt } = textToSqlPrompts({ engine: connection.engine, schema, request });
      const sqlText = stripSqlFences(await ai.mutateAsync({ system, prompt }));
      if (!sqlText) {
        setAiError("The model returned an empty response. Try rephrasing your request.");
        return;
      }
      applyEdit(range, sqlText);
    } catch (err) {
      setAiError(errorMessage(err));
    }
  }, [aiPrompt, ai, connection.engine, schema, captureRange, applyEdit]);

  const explainSql = useCallback(async () => {
    const target = currentSql();
    if (!target) return;
    setAiError(null);
    setAiNote(null);
    try {
      const { system, prompt } = explainPrompts({ engine: connection.engine, sql: target });
      const text = await ai.mutateAsync({ system, prompt });
      setAiNote(text);
    } catch (err) {
      setAiError(errorMessage(err));
    }
  }, [currentSql, ai, connection.engine]);

  const fixSql = useCallback(async () => {
    const target = currentSql();
    if (!target || !error) return;
    setAiError(null);
    setAiNote(null);
    const range = captureRange("replace");
    try {
      const { system, prompt } = fixPrompts({ engine: connection.engine, sql: target, error });
      const sqlText = stripSqlFences(await ai.mutateAsync({ system, prompt }));
      if (!sqlText) {
        setAiError("The model returned an empty response. Try again.");
        return;
      }
      applyEdit(range, sqlText);
    } catch (err) {
      setAiError(errorMessage(err));
    }
  }, [currentSql, error, ai, connection.engine, captureRange, applyEdit]);

  const run = useCallback(async () => {
    const trimmed = currentSql();
    if (!trimmed || streaming) return;
    setError(null);
    setResult(null);
    setStreamedRows(0);
    setTruncated(false);
    setStreaming(true);

    // Accumulate the streamed chunks; render the table once `done` arrives.
    let columns: QueryResult["columns"] = [];
    const rows: QueryResult["rows"] = [];
    let elapsedMs = 0;
    let rowsAffected: number | null = null;
    let didTruncate = false;
    try {
      await ipc.executeQueryStream({ id: connection.id, sql: trimmed, params: [] }, (chunk) => {
        if (chunk.kind === "columns") {
          columns = chunk.columns;
        } else if (chunk.kind === "rows") {
          for (const r of chunk.rows) rows.push(r);
          setStreamedRows(rows.length);
        } else {
          elapsedMs = chunk.elapsedMs;
          rowsAffected = chunk.rowsAffected;
          didTruncate = chunk.truncated;
        }
      });
      setResult({ columns, rows, rowsAffected, elapsedMs });
      setTruncated(didTruncate);
    } catch (err) {
      // Surface the error; keep any rows already streamed so partial output is visible.
      setResult(rows.length || columns.length ? { columns, rows, rowsAffected: null, elapsedMs } : null);
      setError(errorMessage(err));
    } finally {
      setStreaming(false);
    }
  }, [currentSql, streaming, connection.id]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    ensureThemes(monaco);
    monaco.editor.setTheme(monacoTheme);
    registerProvider(monaco);
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <Input
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !ai.isPending && generateSql()}
          placeholder="Ask AI to write SQL…"
          className="h-8 max-w-md text-xs"
        />
        <Button size="sm" variant="secondary" onClick={generateSql} disabled={ai.isPending}>
          {ai.isPending ? <Spinner /> : <Wand2 className="h-3.5 w-3.5" />}
          Generate
        </Button>
        <Button size="sm" variant="ghost" onClick={explainSql} disabled={ai.isPending}>
          <Lightbulb className="h-3.5 w-3.5" />
          Explain
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={fixSql}
          disabled={ai.isPending || !error}
          title={error ? "Fix the failed query with AI" : "Run a query that errors to enable Fix"}
        >
          <Wrench className="h-3.5 w-3.5" />
          Fix
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowAiSettings(true)}
            aria-label="AI settings"
            title="AI settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">⌘/Ctrl + Enter</span>
          <Button size="sm" onClick={run} disabled={streaming}>
            {streaming ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            Run
          </Button>
        </div>
      </div>

      {aiError ? (
        <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span className="selectable flex-1 break-words">{aiError}</span>
          <button onClick={() => setAiError(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {aiNote ? (
        <div className="flex items-start gap-2 border-b border-border bg-primary/10 px-3 py-1.5 text-xs">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="selectable flex-1 whitespace-pre-wrap break-words">{aiNote}</span>
          <button onClick={() => setAiNote(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <AiSettingsDialog open={showAiSettings} onClose={() => setShowAiSettings(false)} />

      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={55} minSize={20}>
          <Editor
            height="100%"
            defaultLanguage="sql"
            theme={monacoTheme}
            value={sql}
            onChange={(value) => setTabSql(tabId, value ?? "")}
            beforeMount={ensureThemes}
            onMount={onMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              lineNumbers: "on",
              renderLineHighlight: "line",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "off",
            }}
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring" />
        <Panel defaultSize={45} minSize={15}>
          <div className="h-full overflow-hidden bg-surface">
            <ResultView
              result={result}
              error={error}
              streaming={streaming}
              streamedRows={streamedRows}
              truncated={truncated}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
