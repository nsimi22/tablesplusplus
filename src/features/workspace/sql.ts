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

export interface QuickFilter {
  column: string;
  op: FilterOp;
  value: string;
}

/** Build a paged `SELECT *` with an optional quick filter. Filter comparisons cast the
 *  column to text so a single text param works for any column type (a deliberate v1
 *  simplification for the "quick visual filter"). */
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
    const colText =
      engine === "postgres"
        ? `${quoteIdent(engine, filter.column)}::text`
        : `CAST(${quoteIdent(engine, filter.column)} AS CHAR)`;
    const ph = placeholder(engine, 1);
    if (filter.op === "contains") {
      const op = engine === "postgres" ? "ILIKE" : "LIKE";
      sql += ` WHERE ${colText} ${op} ${ph}`;
      params.push({ kind: "text", value: `%${filter.value}%` });
    } else {
      sql += ` WHERE ${colText} ${filter.op} ${ph}`;
      params.push({ kind: "text", value: filter.value });
    }
  }

  sql += ` LIMIT ${limit} OFFSET ${offset}`;
  return { sql, params };
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

/** Coerce a raw editor string into a `CellValue` matching the original cell's kind. */
export function coerceCellInput(original: CellValue, raw: string): CellValue {
  if (raw === "") return { kind: "null" };
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
