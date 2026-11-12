import { createFileRoute, redirect } from "@tanstack/react-router";

import { isDayKey } from "@/lib/date";

export const Route = createFileRoute("/_calendar/u/$ownerId/d/$date")({
  beforeLoad: ({ params }) => {
    if (!isDayKey(params.date)) throw redirect({ to: "/", replace: true });
  },
  component: () => null,
});
