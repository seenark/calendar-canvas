import { createFileRoute, redirect } from "@tanstack/react-router";

import { monthOfDay, toDayKey } from "@/lib/date";

export const Route = createFileRoute("/_calendar/")({
  beforeLoad: () => {
    throw redirect({
      to: "/m/$yearMonth",
      params: { yearMonth: monthOfDay(toDayKey(new Date())) },
      replace: true,
    });
  },
});
