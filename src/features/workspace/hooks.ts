import { useMutation, useQuery } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import type { CellValue, ConnectionConfig, QueryResult, Schema } from "@/lib/types";
import { buildSelect, type QuickFilter, type SortSpec } from "./sql";

export function useSchema(connectionId: string | null) {
  return useQuery<Schema>({
    queryKey: ["schema", connectionId],
    queryFn: () => ipc.getSchema(connectionId as string),
    enabled: !!connectionId,
  });
}

export function useTableData(args: {
  connection: ConnectionConfig;
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  filter: QuickFilter | null;
  sort: SortSpec | null;
}) {
  const { connection, schema, table, page, pageSize, filter, sort } = args;
  return useQuery<QueryResult>({
    queryKey: ["tableData", connection.id, schema, table, page, pageSize, filter, sort],
    queryFn: () => {
      const { sql, params } = buildSelect({
        engine: connection.engine,
        schema,
        table,
        filter,
        sort,
        limit: pageSize,
        offset: page * pageSize,
      });
      return ipc.executeQuery({ id: connection.id, sql, params });
    },
    placeholderData: (prev) => prev,
  });
}

/** Run arbitrary SQL (SQL console + grid commits). */
export function useExecuteSql(connectionId: string) {
  return useMutation<QueryResult, unknown, { sql: string; params?: CellValue[] }>({
    mutationFn: ({ sql, params }) =>
      ipc.executeQuery({ id: connectionId, sql, params }),
  });
}
