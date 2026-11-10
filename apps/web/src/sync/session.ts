import type { QueryClient } from "@tanstack/react-query";
import { getDefaultStore } from "jotai/vanilla";

import { api } from "@/lib/api";
import { needsAuthAtom } from "@/state/auth";

import type { DayStore } from "./day-store";
import { sendOps } from "./mutations";

/** While `needsAuth` is set, asks the server whether the session is back. If it is, flushing resumes. */
export async function resumeIfSignedIn(queryClient: QueryClient, store: DayStore): Promise<void> {
  const atoms = getDefaultStore();
  if (!atoms.get(needsAuthAtom)) return;
  try {
    await api("/api/me");
  } catch {
    return;
  }
  atoms.set(needsAuthAtom, false);
  sendOps(queryClient, store);
}

/**
 * A full reload after sign-in starts with `needsAuth` cleared, so this covers a page that outlived the sign-in
 * (restored from the back-forward cache, or signed in from another tab). Returns the stop function.
 */
export function watchSession(queryClient: QueryClient, store: DayStore): () => void {
  const check = () => void resumeIfSignedIn(queryClient, store);
  const onVisibility = () => {
    if (document.visibilityState === "visible") check();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", check);
    window.removeEventListener("focus", check);
  };
}
