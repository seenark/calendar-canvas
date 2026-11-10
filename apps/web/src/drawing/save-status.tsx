import { onlineManager } from "@tanstack/react-query";
import { useAtomValue } from "jotai/react";
import { useSyncExternalStore } from "react";

import { needsAuthAtom } from "@/state/auth";
import { dayStore } from "@/sync/day-store";
import { SessionExpired } from "@/sync/session-expired";

/** Text only, never a modal. Pending counts Ops not yet confirmed, in flight included. */
export function SaveStatus() {
  const pending = useSyncExternalStore(dayStore.subscribe, dayStore.pendingCount);
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  if (useAtomValue(needsAuthAtom)) return <SessionExpired />;
  return (
    <p className="text-muted-foreground ml-auto pr-2 text-xs" role="status">
      {pending === 0 ? "บันทึกแล้ว" : online ? "กำลังบันทึก…" : "ออฟไลน์ จะบันทึกเมื่อเชื่อมต่อ"}
    </p>
  );
}
