import { Button } from "@calendar-canvas/ui/components/button";
import { Input } from "@calendar-canvas/ui/components/input";
import { Label } from "@calendar-canvas/ui/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { ApiError, api, meQuery } from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  rate_limited: "ลองเข้าสู่ระบบบ่อยเกินไป โปรดรอสักครู่แล้วลองใหม่",
  not_found: "ยังไม่ได้ตั้งค่าบัญชีผู้ดูแลระบบ",
};

export const Route = createFileRoute("/admin/login")({
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      queryClient.removeQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: "/admin" });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
      setPending(false);
    }
  };

  return (
    <main className="grid flex-1 place-items-center p-6">
      <form
        onSubmit={submit}
        className="bg-paper text-paper-foreground flex w-full max-w-xs flex-col gap-4 p-6"
      >
        <h1 className="text-xl font-bold">ผู้ดูแลระบบ</h1>
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">ชื่อผู้ใช้</Label>
          <Input id="username" name="username" autoComplete="username" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">รหัสผ่าน</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          เข้าสู่ระบบ
        </Button>
      </form>
    </main>
  );
}
