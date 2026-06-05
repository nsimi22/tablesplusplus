/**
 * Bundle Monaco locally (no CDN). A desktop app must work offline and under a strict CSP,
 * so we self-host the editor and its worker rather than letting @monaco-editor/react fetch
 * from jsdelivr. The SQL language only needs the base editor worker.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });
