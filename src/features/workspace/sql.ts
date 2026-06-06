import type { CellValue, Engine } from "@/lib/types";

/** Quote an identifier for the engine ("pg" → double quotes, mysql → backticks). */
export function quoteIdent(engine: Engine, name: string): string {
  if (engine === "postgres") {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `\`${name.replace(/`/g, "``")}\``;
}

/** Positional placeholder for the engine (Postgres `$1..`, MySQL `?`). */
export function placeholder(engine: Engine, index: number): string {
  return engine === "postgres" ? `$${index}` : "?";
}

export function qualified(engine: Engine, schema: string, table: string): string {
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
}

export type FilterOp = "=" | "!=" | "<" | ">" | "contains";

export const FILTER_OPS: FilterOp[] = ["=", "!=", "<", ">", "contains"];

export interface QuickFilter {
  column: string;
  op: FilterOp;
  value: string;
  /** Sampled kind of the column's cells, set when the filter is applied; drives typed vs
   *  text comparison so numeric ranges aren't compared lexicographically. */
  columnKind?: CellValue["kind"];
}

function textCast(engine: Engine, column: string): string {
  return engine === "postgres"
    ? `${quoteIdent(engine, column)}::text`
    : `CAST(${quoteIdent(engine, column)} AS CHAR)`;
}

/** Build a paged `SELECT *` with an optional quick filter.
 *
 *  Numeric columns use a native typed comparison (so `> 9` orders numerically); text and
 *  date/time columns compare as text (lexicographic order is correct for ISO-8601 dates and
 *  natural for text), and `contains` always uses a `LIKE`/`ILIKE` text match. */
export function buildSelect(args: {
  engine: Engine;
  schema: string;
  table: string;
  filter: QuickFilter | null;
  limit: number;
  offset: number;
}): { sql: string; params: CellValue[] } {
  const { engine, schema, table, filter, limit, offset } = args;
  const params: CellValue[] = [];
  let sql = `SELECT * FROM ${qualified(engine, schema, table)}`;

  if (filter && filter.value !== "") {
    // Defense in depth: the operator comes from a constrained <select>, but never interpolate
    // an unrecognized token into SQL.
    if (!FILTER_OPS.includes(filter.op)) {
      throw new Error(`Unsupported filter operator: ${filter.op}`);
    }
    const ph = placeholder(engine, 1);
    const numeric =
      filter.columnKind === "int" ||
      filter.columnKind === "float" ||
      filter.columnKind === "decimal";
    const looksNumeric = /^-?\d+(\.\d+)?$/.test(filter.value);

    if (filter.op === "contains") {
      const like = engine === "postgres" ? "ILIKE" : "LIKE";
      sql += ` WHERE ${textCast(engine, filter.column)} ${like} ${ph}`;
      params.push({ kind: "text", value: `%${filter.value}%` });
    } else if (numeric && looksNumeric) {
      // Native numeric comparison — no text cast, so ordering is correct.
      sql += ` WHERE ${quoteIdent(engine, filter.column)} ${filter.op} ${ph}`;
      params.push(numericParam(filter.columnKind, filter.value));
    } else {
      sql += ` WHERE ${textCast(engine, filter.column)} ${filter.op} ${ph}`;
      params.push({ kind: "text", value: filter.value });
    }
  }

  sql += ` LIMIT ${limit} OFFSET ${offset}`;
  return { sql, params };
}

function numericParam(kind: CellValue["kind"] | undefined, value: string): CellValue {
  if (kind === "int") return { kind: "int", value: Number.parseInt(value, 10) };
  if (kind === "float") return { kind: "float", value: Number.parseFloat(value) };
  return { kind: "decimal", value };
}

export interface ColumnValue {
  column: string;
  value: CellValue;
}

/** Build a parameterized UPDATE for a single edited row (CLAUDE.md §7). */
export function buildUpdate(args: {
  engine: Engine;
  schema: string;
  table: string;
  set: ColumnValue[];
  where: ColumnValue[];
}): { sql: string; params: CellValue[] } {
  const { engine, schema, table, set, where } = args;
  const params: CellValue[] = [];
  let i = 1;

  const setClause = set
    .map((c) => {
      const ph = placeholder(engine, i++);
      params.push(c.value);
      return `${quoteIdent(engine, c.column)} = ${ph}`;
    })
    .join(", ");

  const whereClause = where
    .map((c) => {
      const ph = placeholder(engine, i++);
      params.push(c.value);
      return `${quoteIdent(engine, c.column)} = ${ph}`;
    })
    .join(" AND ");

  const sql = `UPDATE ${qualified(engine, schema, table)} SET ${setClause} WHERE ${whereClause}`;
  return { sql, params };
}

/** Coerce a raw editor string into a `CellValue` matching the original cell's kind.
 *  An empty string is a valid empty TEXT value; for non-text kinds (which have no empty
 *  representation) it means NULL. */
export function coerceCellInput(original: CellValue, raw: string): CellValue {
  if (raw === "") {
    return original.kind === "text" ? { kind: "text", value: "" } : { kind: "null" };
  }
  switch (original.kind) {
    case "int": {
      const n = Number.parseInt(raw, 10);
      return Number.isNaN(n) ? { kind: "text", value: raw } : { kind: "int", value: n };
    }
    case "float": {
      const n = Number.parseFloat(raw);
      return Number.isNaN(n) ? { kind: "text", value: raw } : { kind: "float", value: n };
    }
    case "decimal":
      return { kind: "decimal", value: raw };
    case "bool":
      return { kind: "bool", value: /^(true|1|t|yes)$/i.test(raw) };
    case "dateTime":
      return { kind: "dateTime", value: raw };
    default:
      return { kind: "text", value: raw };
  }
}
