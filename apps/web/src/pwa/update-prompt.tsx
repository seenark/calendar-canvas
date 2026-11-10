import { useEffect, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

import { dayStore } from "@/sync/day-store";

const TOAST_ID = "app-update";

/** Offers a new build and reloads only after the User taps, and only once no Pending op is left. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const pending = useSyncExternalStore(dayStore.subscribe, dayStore.pendingCount);
  const [reloadRequested, setReloadRequested] = useState(false);
  const waitingForSave = reloadRequested && pending > 0;

  useEffect(() => {
    if (!needRefresh) return;
    if (waitingForSave) {
      toast.info("กำลังบันทึก จะโหลดใหม่เมื่อบันทึกเสร็จ", {
        id: TOAST_ID,
        duration: Infinity,
        dismissible: false,
        action: undefined,
      });
      return;
    }
    toast.info("อัปเดตพร้อมแล้ว", {
      id: TOAST_ID,
      duration: Infinity,
      dismissible: false,
      action: {
        label: "โหลดใหม่",
        onClick: (event) => {
          event.preventDefault();
          setReloadRequested(true);
        },
      },
    });
  }, [needRefresh, waitingForSave]);

  useEffect(() => {
    if (needRefresh && reloadRequested && pending === 0) void updateServiceWorker(true);
  }, [needRefresh, reloadRequested, pending, updateServiceWorker]);

  return null;
}
