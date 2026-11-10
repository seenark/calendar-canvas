import { Button } from "@calendar-canvas/ui/components/button";
import { useAtomValue } from "jotai/react";

import { needsAuthAtom } from "@/state/auth";

import { persistThenSignIn } from "./session";

/** Top bar notice, never a modal. The buffer reaches IndexedDB before the page leaves for Google. */
export function SessionExpired() {
  const needsAuth = useAtomValue(needsAuthAtom);
  if (!needsAuth) return null;
  return (
    <div className="ml-auto flex items-center gap-2 pr-2" role="alert">
      <p className="text-destructive text-xs">กรุณาเข้าสู่ระบบอีกครั้ง</p>
      <Button size="sm" onClick={() => persistThenSignIn(location.pathname + location.search)}>
        เข้าสู่ระบบ
      </Button>
    </div>
  );
}
