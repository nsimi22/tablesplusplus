import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage, type ConnectionConfig, type QueryResult, type Schema } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useExecuteSql, useSchema } from "@/features/workspace/hooks";
import { ResultView } from "./ResultView";

type MonacoApi = Parameters<OnMount>[1];
type CodeEditor = Parameters<OnMount>[0];

// Monaco is a global singleton; register the schema-aware provider once and let it read the
// active connection's schema from a module-level ref (all query tabs share one connection).
let providerRegistered = false;
let activeSchema: Schema | undefined;

const THEME = "tablesplusplus-dark";

function ensureTheme(monaco: MonacoApi) {
  // Monaco themes require hex (editor-internal; not Tailwind tokens). Approximates the theme.
  monaco.editor.defineTheme(THEME, {
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
  const exec = useExecuteSql(connection.id);
  const { data: schema } = useSchema(connection.id);

  const editorRef = useRef<CodeEditor | null>(null);
  const runRef = useRef<() => void>(() => {});
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    activeSchema = schema;
  }, [schema]);

  const run = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    const selection = ed.getSelection();
    const text =
      selection && model && !selection.isEmpty()
        ? model.getValueInRange(selection)
        : ed.getValue();
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await exec.mutateAsync({ sql: trimmed, params: [] });
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    }
  }, [exec]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    ensureTheme(monaco);
    monaco.editor.setTheme(THEME);
    registerProvider(monaco);
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to run</span>
        <Button size="sm" onClick={run} disabled={exec.isPending}>
          {exec.isPending ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
          Run
        </Button>
      </div>

      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={55} minSize={20}>
          <Editor
            height="100%"
            defaultLanguage="sql"
            theme={THEME}
            value={sql}
            onChange={(value) => setTabSql(tabId, value ?? "")}
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
            <ResultView result={result} error={error} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
