import type { Engine, Schema } from "@/lib/types";

const MAX_TABLES = 60;
const MAX_COLS = 40;

export function engineName(engine: Engine): string {
  return engine === "postgres" ? "PostgreSQL" : "MySQL";
}

/** Compact schema description for the model: `schema.table(col type, ...)`, bounded for tokens. */
export function buildSchemaContext(schema: Schema | undefined): string {
  if (!schema) return "(schema unavailable)";
  const all = [...schema.tables, ...schema.views].slice(0, MAX_TABLES);
  const lines = all.map((t) => {
    const cols = t.columns
      .slice(0, MAX_COLS)
      .map((c) => `${c.name} ${c.dataType}${c.isPrimaryKey ? " PK" : ""}`)
      .join(", ");
    return `${t.schema}.${t.name}(${cols})`;
  });
  return lines.join("\n");
}

/** Extract SQL from the model output, unwrapping a Markdown code block even when it's
 *  surrounded by conversational text. Uses the LAST fenced block — when a model shows the
 *  original query first and the answer second, the answer is last. */
export function stripSqlFences(text: string): string {
  const out = text.trim();
  const blocks = [...out.matchAll(/```(?:sql)?\s*([\s\S]*?)\s*```/gi)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() : out;
}

export function textToSqlPrompts(args: {
  engine: Engine;
  schema: Schema | undefined;
  request: string;
}): { system: string; prompt: string } {
  const system =
    `You are an expert ${engineName(args.engine)} SQL assistant. Generate a single valid ` +
    `SQL query that satisfies the user's request, using ONLY the tables and columns in the ` +
    `provided schema. Output ONLY the SQL query — no Markdown fences, no commentary.\n\n` +
    `Schema:\n${buildSchemaContext(args.schema)}`;
  return { system, prompt: args.request };
}

export function explainPrompts(args: { engine: Engine; sql: string }): {
  system: string;
  prompt: string;
} {
  const system =
    `You are a ${engineName(args.engine)} expert. Explain the following SQL query concisely ` +
    `in plain English. Be brief and clear; do not restate the SQL.`;
  return { system, prompt: args.sql };
}

export function fixPrompts(args: {
  engine: Engine;
  sql: string;
  error: string;
}): { system: string; prompt: string } {
  const system =
    `You are an expert ${engineName(args.engine)} SQL assistant. The user's query failed with ` +
    `an error. Return ONLY the corrected SQL query — no Markdown fences, no commentary.`;
  return { system, prompt: `SQL:\n${args.sql}\n\nError:\n${args.error}` };
}
