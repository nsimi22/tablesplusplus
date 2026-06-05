import { useMutation, useQuery } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import type { CellValue, ConnectionConfig, QueryResult, Schema } from "@/lib/types";
import { useConnections } from "@/features/connections/useConnections";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { buildSelect, type QuickFilter } from "./sql";

/** The connection currently open in the workspace. */
export function useActiveConnection(): ConnectionConfig | undefined {
  const activeId = useWorkspaceStore((s) => s.activeConnectionId);
  const { data } = useConnections();
  return data?.find((c) => c.id === activeId);
}

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
}) {
  const { connection, schema, table, page, pageSize, filter } = args;
  return useQuery<QueryResult>({
    queryKey: ["tableData", connection.id, schema, table, page, pageSize, filter],
    queryFn: () => {
      const { sql, params } = buildSelect({
        engine: connection.engine,
        schema,
        table,
        filter,
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
