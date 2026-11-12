import { linkOptions } from "@tanstack/react-router";

/** Month view of the User's own calendar (`ownerId` null) or of an Owner's. */
export const monthLink = (ownerId: string | null, yearMonth: string) =>
  ownerId === null
    ? linkOptions({ to: "/m/$yearMonth", params: { yearMonth } })
    : linkOptions({ to: "/u/$ownerId/m/$yearMonth", params: { ownerId, yearMonth } });

/** Drawing page of a Day of the User's own calendar or of an Owner's. */
export const dayLink = (ownerId: string | null, date: string) =>
  ownerId === null
    ? linkOptions({ to: "/d/$date", params: { date } })
    : linkOptions({ to: "/u/$ownerId/d/$date", params: { ownerId, date } });
