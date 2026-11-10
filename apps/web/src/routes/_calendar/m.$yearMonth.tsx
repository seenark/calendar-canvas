import { createFileRoute, redirect } from "@tanstack/react-router";

import { isYearMonth } from "@/lib/date";

export const Route = createFileRoute("/_calendar/m/$yearMonth")({
  beforeLoad: ({ params }) => {
    if (!isYearMonth(params.yearMonth)) throw redirect({ to: "/", replace: true });
  },
  component: () => null,
});
