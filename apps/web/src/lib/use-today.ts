import { useEffect, useState } from "react";

import { toDayKey } from "./date";

/** Today's Day key, refreshed at local midnight and whenever the page becomes visible again. */
export function useToday(): string {
  const [today, setToday] = useState(() => toDayKey(new Date()));

  useEffect(() => {
    let timer: number;
    const refresh = () => setToday(toDayKey(new Date()));
    const schedule = () => {
      window.clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, midnight.getTime() - now.getTime());
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refresh();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
