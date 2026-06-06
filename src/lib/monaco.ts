/**
 * Bundle Monaco locally (no CDN), trimmed to the editor core + SQL only. A desktop app must
 * work offline and under a strict CSP, so we self-host the editor and its worker rather than
 * letting @monaco-editor/react fetch from jsdelivr.
 *
 * We import `editor.api` (the editor with no bundled languages) plus the single SQL
 * basic-language contribution — instead of the full `monaco-editor` barrel, which pulls every
 * language (JSON/TS/CSS/HTML services, dozens of grammars) and roughly triples the main chunk.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
// `editor.all` registers the core editor contributions (suggest/autocomplete, find, hover,
// context menu, folding, …) without the heavy language services. Required for the schema-aware
// completion widget in the SQL console.
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  // SQL highlighting is a main-thread tokenizer, so only the base editor worker is needed.
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });
