import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import type { ConnectionConfig, ConnectionInput } from "@/lib/types";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

const CONNECTIONS_KEY = ["connections"] as const;

export function useConnections() {
  return useQuery<ConnectionConfig[]>({
    queryKey: CONNECTIONS_KEY,
    queryFn: ipc.listConnections,
  });
}

/** All connections the UI can resolve by id: saved (persisted) + session ones opened via the
 *  database switcher (whose metadata isn't in the persisted store). */
export function useAllConnections(): ConnectionConfig[] {
  const { data: saved } = useConnections();
  const session = useWorkspaceStore((s) => s.sessionConnections);
  return [...(saved ?? []), ...session.map((s) => s.config)];
}

export function useSaveConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionInput) => ipc.saveConnection(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: ConnectionInput }) =>
      ipc.updateConnection(args.id, args.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

/** Import connections (metadata only — secrets are entered on first connect). Saves each
 *  sequentially to avoid racing the connections.json store, then refreshes the list once. */
export function useImportConnections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: ConnectionInput[]) => {
      const created: ConnectionConfig[] = [];
      for (const input of inputs) {
        created.push(await ipc.saveConnection(input));
      }
      return created;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

/** Test the current form values (input) or a stored connection (id). */
export function useTestConnection() {
  return useMutation({
    mutationFn: (args: { id?: string; input?: ConnectionInput }) =>
      ipc.testConnection(args),
  });
}

/** Open a pooled connection (registers it in the backend pool registry). */
export function useConnect() {
  return useMutation({ mutationFn: (id: string) => ipc.connect(id) });
}

/** Close a pooled connection. */
export function useDisconnect() {
  return useMutation({ mutationFn: (id: string) => ipc.disconnect(id) });
}
