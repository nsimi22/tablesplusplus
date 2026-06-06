import { ConnectionHub } from "@/features/connections/ConnectionHub";
import { Workspace } from "@/features/workspace/Workspace";
import { AppUpdater } from "@/features/updates/AppUpdater";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export default function App() {
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);

  return (
    <div className="h-full w-full bg-background text-foreground">
      {activeConnectionId ? <Workspace /> : <ConnectionHub />}
      <AppUpdater />
    </div>
  );
}
