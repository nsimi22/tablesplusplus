import { ConnectionHub } from "@/features/connections/ConnectionHub";
import { Workspace } from "@/features/workspace/Workspace";
import { AppUpdater } from "@/features/updates/AppUpdater";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export default function App() {
  const openConnectionIds = useWorkspaceStore((s) => s.openConnectionIds);
  const hubOpen = useWorkspaceStore((s) => s.hubOpen);
  const showHub = hubOpen || openConnectionIds.length === 0;

  return (
    <div className="h-full w-full bg-background text-foreground">
      {showHub ? <ConnectionHub /> : <Workspace />}
      <AppUpdater />
    </div>
  );
}
