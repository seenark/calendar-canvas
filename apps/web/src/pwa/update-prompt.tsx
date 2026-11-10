import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

import { dayStore } from "@/sync/day-store";

import { decideUpdate, whenActivated } from "./update-policy";

const TOAST_ID = "app-update";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Counts active pointers in a ref, never in React state, so a Stroke causes no commit. `rerender` runs only
 * when the last pointer lifts while a requested reload is deferred (`deferred.current`), to re-evaluate it.
 */
function usePointersDown(deferred: { current: boolean }, rerender: () => void) {
  const down = useRef(new Set<number>());
  useEffect(() => {
    const pointers = down.current;
    const onDown = (e: PointerEvent) => void pointers.add(e.pointerId);
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && deferred.current) rerender();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, [deferred, rerender]);
  return down;
}

/**
 * Offers a new build. This client reloads only after its own tap, and only while no Pending op exists
 * and no Stroke is in progress. Another tab's tap activates the new build here without reloading.
 */
export function UpdatePrompt() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [activated, setActivated] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, r) => {
      registration.current = r;
    },
    // the default reloads this tab whenever any tab activates the new build
    onNeedReload: () => {},
  });
  const pending = useSyncExternalStore(dayStore.subscribe, dayStore.pendingCount);
  const deferred = useRef(false);
  const [tick, rerender] = useReducer((n: number) => n + 1, 0);
  const down = usePointersDown(deferred, rerender);
  const [requested, setRequested] = useState(false);
  const action = decideUpdate({
    needRefresh,
    requested,
    pending,
    drawing: down.current.size > 0,
    activated,
  });

  useEffect(() => {
    deferred.current = action === "wait";
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
    }
  }, [action]);

  useEffect(() => {
    if (action !== "activate" && action !== "reload") return;
    // the render-time snapshot may predate a pointerdown or a new Pending op; the pointer wake-up or the store re-renders when it clears
    if (down.current.size > 0 || dayStore.pendingCount() > 0) {
      deferred.current = true;
      return;
    }
    deferred.current = false;
    if (action === "reload") {
      window.location.reload();
      return;
    }
    const r = registration.current;
    const target = r?.waiting ?? r?.installing ?? r?.active;
    void updateServiceWorker(true);
    if (target)
      whenActivated(target).then(
        () => setActivated(true),
        () => setRequested(false),
      );
  }, [action, tick, down, updateServiceWorker]);

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
