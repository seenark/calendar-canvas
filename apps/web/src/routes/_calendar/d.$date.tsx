import { createFileRoute, redirect } from "@tanstack/react-router";

import { isDayKey } from "@/lib/date";

export const Route = createFileRoute("/_calendar/d/$date")({
  beforeLoad: ({ params }) => {
    if (!isDayKey(params.date)) throw redirect({ to: "/", replace: true });
  },
  component: () => null,
});
