import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CandidatesResponse, CreateShareRequest, SharesResponse } from "@/api/types";
import { api } from "@/lib/api";

/** Prefix of every Share query, so one invalidation refreshes the lists and the candidates. */
export const sharesQuery = queryOptions({
  queryKey: ["shares"],
  queryFn: () => api<SharesResponse>("/api/shares"),
});

export const candidatesQuery = queryOptions({
  queryKey: ["shares", "candidates"],
  queryFn: () => api<CandidatesResponse>("/api/shares/candidates"),
});

/** `networkMode: "always"` so offline fails at once with the toast, instead of queueing a mutation that is never persisted. */
function useShareMutation<V>(send: (value: V) => Promise<unknown>, failure: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    networkMode: "always",
    onError: () => toast.error(failure),
    // An error is often a stale list (already shared, already revoked), so refresh either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharesQuery.queryKey }),
  });
}

export function useShareActions() {
  return {
    invite: useShareMutation(
      (viewerId: string) =>
        api("/api/shares", {
          method: "POST",
          body: JSON.stringify({ viewerId } satisfies CreateShareRequest),
        }),
      "ส่งคำเชิญไม่สำเร็จ",
    ),
    accept: useShareMutation(
      (id: string) => api(`/api/shares/${id}/accept`, { method: "POST" }),
      "ยอมรับคำเชิญไม่สำเร็จ",
    ),
    decline: useShareMutation(
      (id: string) => api(`/api/shares/${id}/decline`, { method: "POST" }),
      "ปฏิเสธคำเชิญไม่สำเร็จ",
    ),
    /** The Owner revoking a Share or Invitation, or the Viewer leaving a Share. */
    remove: useShareMutation(
      (id: string) => api(`/api/shares/${id}`, { method: "DELETE" }),
      "ยกเลิกการแชร์ไม่สำเร็จ",
    ),
  };
}
