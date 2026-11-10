import { Button } from "@calendar-canvas/ui/components/button";
import { useAtomValue } from "jotai/react";

import { signInUrl } from "@/lib/api";
import { needsAuthAtom } from "@/state/auth";

import { persistNow } from "./buffer";

/** Top bar notice, never a modal. The buffer reaches IndexedDB before the page leaves for Google. */
export function SessionExpired() {
  const needsAuth = useAtomValue(needsAuthAtom);
  if (!needsAuth) return null;
  const signIn = async () => {
    await persistNow();
    window.location.href = signInUrl(location.pathname + location.search);
  };
  return (
    <div className="ml-auto flex items-center gap-2 pr-2" role="alert">
      <p className="text-destructive text-xs">กรุณาเข้าสู่ระบบอีกครั้ง</p>
      <Button size="sm" onClick={signIn}>
        เข้าสู่ระบบ
      </Button>
    </div>
  );
}
