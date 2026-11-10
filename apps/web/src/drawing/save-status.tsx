import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { dayStore } from "@/sync/day-store";

/** Text only, never a modal. Pending counts Ops not yet confirmed, in flight included. */
export function SaveStatus() {
  const pending = useSyncExternalStore(dayStore.subscribe, dayStore.pendingCount);
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  return (
    <p className="text-muted-foreground ml-auto pr-2 text-xs" role="status">
      {pending === 0 ? "บันทึกแล้ว" : online ? "กำลังบันทึก…" : "ออฟไลน์ จะบันทึกเมื่อเชื่อมต่อ"}
    </p>
  );
}
