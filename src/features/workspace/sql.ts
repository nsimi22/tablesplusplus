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

export type SortDir = "asc" | "desc";

export interface SortSpec {
  column: string;
  dir: SortDir;
}

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
  /** Optional ORDER BY clause (server-side sort). */
  sort?: SortSpec | null;
  /** Omit `limit` to select the whole (filtered) table — used by full-table export. */
  limit?: number;
  offset?: number;
}): { sql: string; params: CellValue[] } {
  const { engine, schema, table, filter, sort, limit, offset } = args;
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

  if (sort) {
    // `dir` is a constrained union, never user text; the column is a real identifier, quoted.
    const dir = sort.dir === "desc" ? "DESC" : "ASC";
    sql += ` ORDER BY ${quoteIdent(engine, sort.column)} ${dir}`;
  }

  if (limit !== undefined) {
    sql += ` LIMIT ${limit} OFFSET ${offset ?? 0}`;
  }
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
  // Refuse to build an unconditional UPDATE — an empty WHERE would rewrite the whole table.
  if (where.length === 0) {
    throw new Error("Refusing to build an UPDATE with no WHERE conditions.");
  }
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

/** Build a parameterized INSERT for a single new row. Columns the user never set are omitted so
 *  the database applies its defaults (serials, DEFAULT, etc.); an empty row inserts all defaults. */
export function buildInsert(args: {
  engine: Engine;
  schema: string;
  table: string;
  values: ColumnValue[];
}): { sql: string; params: CellValue[] } {
  const { engine, schema, table, values } = args;
  if (values.length === 0) {
    const sql =
      engine === "postgres"
        ? `INSERT INTO ${qualified(engine, schema, table)} DEFAULT VALUES`
        : `INSERT INTO ${qualified(engine, schema, table)} () VALUES ()`;
    return { sql, params: [] };
  }
  const params: CellValue[] = [];
  const cols = values.map((v) => quoteIdent(engine, v.column)).join(", ");
  const placeholders = values
    .map((v, i) => {
      params.push(v.value);
      return placeholder(engine, i + 1);
    })
    .join(", ");
  const sql = `INSERT INTO ${qualified(engine, schema, table)} (${cols}) VALUES (${placeholders})`;
  return { sql, params };
}

/** Build a parameterized DELETE matching a single row by its primary-key columns. */
export function buildDelete(args: {
  engine: Engine;
  schema: string;
  table: string;
  where: ColumnValue[];
}): { sql: string; params: CellValue[] } {
  const { engine, schema, table, where } = args;
  // Refuse to build an unconditional DELETE — an empty WHERE would wipe the whole table.
  if (where.length === 0) {
    throw new Error("Refusing to build a DELETE with no WHERE conditions.");
  }
  const params: CellValue[] = [];
  const whereClause = where
    .map((c, i) => {
      params.push(c.value);
      return `${quoteIdent(engine, c.column)} = ${placeholder(engine, i + 1)}`;
    })
    .join(" AND ");
  const sql = `DELETE FROM ${qualified(engine, schema, table)} WHERE ${whereClause}`;
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
