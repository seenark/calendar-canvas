import { createFileRoute, redirect } from "@tanstack/react-router";

import { startMonth } from "@/month/last-month";

export const Route = createFileRoute("/_calendar/")({
  beforeLoad: () => {
    throw redirect({
      to: "/m/$yearMonth",
      params: { yearMonth: startMonth() },
      replace: true,
    });
  },
});
