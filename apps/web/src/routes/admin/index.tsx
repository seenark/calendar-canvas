import { Button } from "@calendar-canvas/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { adminUsersQuery, api, fetchMe, signOut, type AdminUser } from "@/lib/api";

export const Route = createFileRoute("/admin/")({
  beforeLoad: async ({ context }) => {
    const me = await fetchMe(context.queryClient);
    if (me?.role !== "admin") throw redirect({ to: "/admin/login" });
  },
  component: AdminPage,
});

const formatTime = (ms: number | null) =>
  ms === null
    ? "-"
    : new Date(ms).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

type UserAction = "approve" | "remove";

/** Admin page sections in display order, one per Approval status. */
const SECTIONS: {
  status: AdminUser["status"];
  title: (count: number) => string;
  actions: UserAction[];
}[] = [
  { status: "pending", title: (count) => `รออนุมัติ (${count})`, actions: ["approve", "remove"] },
  { status: "approved", title: () => "ใช้งานอยู่", actions: ["remove"] },
];

interface ActionButton {
  label: string;
  variant: "default" | "destructive";
  run: (user: AdminUser) => void;
}

function AdminPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery(adminUsersQuery);

  const remove = useMutation({
    mutationFn: (user: AdminUser) => api(`/api/admin/users/${user.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries(adminUsersQuery),
    onError: () => toast.error("ลบผู้ใช้ไม่สำเร็จ"),
  });

  const approve = useMutation({
    mutationFn: (user: AdminUser) =>
      api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      }),
    onSuccess: () => queryClient.invalidateQueries(adminUsersQuery),
    onError: () => toast.error("อนุมัติผู้ใช้ไม่สำเร็จ"),
  });

  const confirmRemove = (user: AdminUser) => {
    const message = `ลบ ${user.email} และข้อมูลทั้งหมดของผู้ใช้นี้? การลบไม่สามารถย้อนกลับได้`;
    if (window.confirm(message)) remove.mutate(user);
  };

  const actions: Record<UserAction, ActionButton> = {
    approve: { label: "อนุมัติ", variant: "default", run: (user) => approve.mutate(user) },
    remove: { label: "ลบ", variant: "destructive", run: confirmRemove },
  };
  const busy = approve.isPending || remove.isPending;

  const leave = async () => {
    await signOut(queryClient);
    await navigate({ to: "/admin/login" });
  };

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">ผู้ใช้</h1>
        <Button variant="outline" onClick={leave}>
          ออกจากระบบ
        </Button>
      </header>
      {users.isPending && <p>กำลังโหลด…</p>}
      {users.isError && (
        <p role="alert" className="text-destructive">
          โหลดรายชื่อผู้ใช้ไม่สำเร็จ
        </p>
      )}
      {users.data?.length === 0 && <p>ยังไม่มีผู้ใช้</p>}
      {SECTIONS.map(({ status, title, actions: sectionActions }) => {
        const rows = users.data?.filter((user) => user.status === status) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={status} className="mb-6">
            <h2 className="mb-2 font-bold">{title(rows.length)}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-2">ผู้ใช้</th>
                    <th className="p-2">เข้าสู่ระบบล่าสุด</th>
                    <th className="p-2 text-right">ลายเส้น</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((user) => (
                    <tr key={user.id} className="border-t">
                      <td className="p-2">
                        <div>{user.name ?? user.email}</div>
                        {user.name && (
                          <div className="text-muted-foreground text-xs">{user.email}</div>
                        )}
                      </td>
                      <td className="p-2">{formatTime(user.lastLoginAt)}</td>
                      <td className="p-2 text-right">{user.strokeCount}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-2">
                          {sectionActions.map((action) => (
                            <Button
                              key={action}
                              variant={actions[action].variant}
                              disabled={busy}
                              onClick={() => actions[action].run(user)}
                            >
                              {actions[action].label}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </main>
  );
}
