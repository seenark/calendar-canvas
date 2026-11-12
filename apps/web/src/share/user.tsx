import { useState } from "react";

import type { PublicUser } from "@/api/types";
import { cn } from "@calendar-canvas/ui/lib/utils";

export const displayName = (user: PublicUser): string => user.name ?? "ผู้ใช้";

/** The Google picture, or the first letter of the name when there is none or it does not load. */
export function UserAvatar({ user, size = 36 }: { user: PublicUser; size?: number }) {
  const [failed, setFailed] = useState(false);
  const className = "shrink-0 rounded-full select-none";
  if (user.avatarUrl && !failed)
    return (
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(className, "object-cover")}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={cn(className, "bg-muted text-muted-foreground grid place-items-center font-bold")}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {[...displayName(user)][0]}
    </span>
  );
}
