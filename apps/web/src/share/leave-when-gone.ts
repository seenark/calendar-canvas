import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { startMonth } from "@/month/last-month";

import { monthLink } from "./links";
import { sharesQuery } from "./queries";

/** A 404 on the Owner's months means the Share was revoked or either side is Blocked: back to the User's own calendar. */
export function useLeaveWhenGone(ownerId: string | null): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (ownerId === null) return;
    let left = false;
    return queryClient.getQueryCache().subscribe(({ query }) => {
      const { error } = query.state;
      if (
        left ||
        query.queryKey[0] !== "sharedMonth" ||
        query.queryKey[1] !== ownerId ||
        !(error instanceof ApiError && error.status === 404)
      )
        return;
      left = true;
      queryClient.removeQueries({ queryKey: ["sharedMonth", ownerId] });
      void queryClient.invalidateQueries({ queryKey: sharesQuery.queryKey });
      toast.error("ปฏิทินนี้ไม่ได้แชร์กับคุณแล้ว");
      void navigate({ ...monthLink(null, startMonth()), replace: true });
    });
  }, [queryClient, navigate, ownerId]);
}
