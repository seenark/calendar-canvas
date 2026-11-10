import { Button } from "@calendar-canvas/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { adminUsersQuery, api, fetchMe, meQuery, type AdminUser } from "@/lib/api";

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

function AdminPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery(adminUsersQuery);

  const remove = useMutation({
    mutationFn: (user: AdminUser) => api(`/api/admin/users/${user.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries(adminUsersQuery),
    onError: () => toast.error("ลบผู้ใช้ไม่สำเร็จ"),
  });

  const confirmRemove = (user: AdminUser) => {
    const message = `ลบ ${user.email} และข้อมูลทั้งหมดของผู้ใช้นี้? การลบไม่สามารถย้อนกลับได้`;
    if (window.confirm(message)) remove.mutate(user);
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" });
    queryClient.removeQueries({ queryKey: meQuery.queryKey });
    await navigate({ to: "/admin/login" });
  };

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">ผู้ใช้</h1>
        <Button variant="outline" onClick={signOut}>
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
      {users.data && users.data.length > 0 && (
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
              {users.data.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="p-2">
                    <div>{user.name ?? user.email}</div>
                    {user.name && <div className="text-muted-foreground text-xs">{user.email}</div>}
                  </td>
                  <td className="p-2">{formatTime(user.lastLoginAt)}</td>
                  <td className="p-2 text-right">{user.strokeCount}</td>
                  <td className="p-2 text-right">
                    <Button
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => confirmRemove(user)}
                    >
                      ลบ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
