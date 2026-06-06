import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import type { AiSettings, AiSettingsInput } from "@/lib/types";

const AI_SETTINGS_KEY = ["aiSettings"] as const;

export function useAiSettings() {
  return useQuery<AiSettings>({
    queryKey: AI_SETTINGS_KEY,
    queryFn: ipc.getAiSettings,
  });
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiSettingsInput) => ipc.saveAiSettings(input),
    onSuccess: (data) => qc.setQueryData(AI_SETTINGS_KEY, data),
  });
}

export function useAiGenerate() {
  return useMutation({
    mutationFn: (args: { system: string; prompt: string }) => ipc.aiGenerate(args),
  });
}
