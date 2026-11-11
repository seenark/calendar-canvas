import { Button } from "@calendar-canvas/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { ApiError, fetchMe, meQuery, signOut } from "@/lib/api";
import { onAppResumed } from "@/sync/session";

export const Route = createFileRoute("/waiting")({
  beforeLoad: async ({ context }) => {
    const me = await fetchMe(context.queryClient).catch((err) => {
      if (err instanceof ApiError) throw err;
      throw redirect({ to: "/login", search: { error: "offline" } });
    });
    if (!me) throw redirect({ to: "/login" });
    if (me.role !== "user") throw redirect({ to: "/admin" });
    if (me.user?.status !== "pending") throw redirect({ to: "/" });
  },
  component: WaitingPage,
});

function WaitingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(
    () =>
      onAppResumed(async () => {
        try {
          const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
          if (me.user?.status !== "pending") await navigate({ to: "/" });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            queryClient.removeQueries({ queryKey: meQuery.queryKey });
            await navigate({ to: "/login" });
          }
        }
      }),
    [queryClient, navigate],
  );

  const leave = async () => {
    try {
      await signOut(queryClient);
    } catch {
      toast.error("ออกจากระบบไม่สำเร็จ ลองอีกครั้ง");
      return;
    }
    await navigate({ to: "/login" });
  };

  return (
    <main className="grid flex-1 place-items-center p-6">
      <div className="paper-shadow w-full max-w-xs">
        <section className="paper-torn bg-paper text-paper-foreground flex flex-col items-center gap-5 px-6 py-10 text-center">
          <h1 className="text-2xl font-bold">รอผู้ดูแลอนุมัติ</h1>
          <p className="text-sm">
            คุณเข้าสู่ระบบแล้ว แต่บัญชีนี้ยังรอการอนุมัติจากผู้ดูแลระบบ เมื่ออนุมัติแล้วคุณจะเข้าใช้ปฏิทินได้ทันที
          </p>
          <Button variant="outline" onClick={leave}>
            ออกจากระบบ
          </Button>
        </section>
      </div>
    </main>
  );
}
