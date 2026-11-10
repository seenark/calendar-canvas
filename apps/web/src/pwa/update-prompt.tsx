import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

import { dayStore } from "@/sync/day-store";

import { decideUpdate, whenActivated } from "./update-policy";

const TOAST_ID = "app-update";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function useIsDrawing(): boolean {
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    const down = new Set<number>();
    const track = (add: boolean) => (e: PointerEvent) => {
      if (add) down.add(e.pointerId);
      else down.delete(e.pointerId);
      setDrawing(down.size > 0);
    };
    const onDown = track(true);
    const onUp = track(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
  return drawing;
}

/**
 * Offers a new build. This client reloads only after its own tap, and only while no Pending op exists
 * and no Stroke is in progress. Another tab's tap activates the new build here without reloading.
 */
export function UpdatePrompt() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [activated, setActivated] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, r) => {
      registration.current = r;
    },
    // the default reloads this tab whenever any tab activates the new build
    onNeedReload: () => {},
  });
  const pending = useSyncExternalStore(dayStore.subscribe, dayStore.pendingCount);
  const drawing = useIsDrawing();
  const [requested, setRequested] = useState(false);
  const action = decideUpdate({ needRefresh, requested, pending, drawing, activated });

  useEffect(() => {
    if (action === "prompt") {
      toast.info("อัปเดตพร้อมแล้ว", {
        id: TOAST_ID,
        position: "top-center",
        duration: Infinity,
        dismissible: false,
        action: {
          label: "โหลดใหม่",
          onClick: (event) => {
            event.preventDefault();
            setRequested(true);
          },
        },
      });
    } else if (action === "wait") {
      toast.info("กำลังบันทึก จะโหลดใหม่เมื่อบันทึกเสร็จ", {
        id: TOAST_ID,
        position: "top-center",
        duration: Infinity,
        dismissible: true,
        action: {
          label: "ยกเลิก",
          onClick: (event) => {
            event.preventDefault();
            setRequested(false);
          },
        },
        // sonner removes a dismissed toast by id 200ms later, so re-showing the prompt sooner would be removed too
        onDismiss: () => setTimeout(() => setRequested(false), 250),
      });
    } else if (action === "activate") {
      const r = registration.current;
      const target = r?.waiting ?? r?.installing ?? r?.active;
      void updateServiceWorker(true);
      if (target)
        whenActivated(target).then(
          () => setActivated(true),
          () => setRequested(false),
        );
    } else if (action === "reload") window.location.reload();
  }, [action, updateServiceWorker]);

  useEffect(() => {
    const check = () => void registration.current?.update().catch(() => {});
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      check();
      timer = setInterval(check, CHECK_INTERVAL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return null;
}
