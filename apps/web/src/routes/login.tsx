import { Button } from "@calendar-canvas/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";

interface LoginSearch {
  return?: string;
  error?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง ลองใหม่อีกครั้ง",
  access_denied: "คุณยกเลิกการเข้าสู่ระบบด้วย Google",
  email_unverified: "อีเมล Google นี้ยังไม่ได้รับการยืนยัน",
  not_allowed: "อีเมลนี้ไม่ได้รับอนุญาตให้ใช้งานแอปนี้",
  sign_in_failed: "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    return: typeof search.return === "string" ? search.return : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { return: returnPath, error } = Route.useSearch();

  const signIn = () => {
    window.location.href = "/api/auth/google/start?return=" + encodeURIComponent(returnPath ?? "/");
  };

  return (
    <main className="grid flex-1 place-items-center p-6">
      <div className="paper-shadow w-full max-w-xs">
        <section className="paper-torn bg-paper text-paper-foreground flex flex-col items-center gap-5 px-6 py-10 text-center">
          <h1 className="text-2xl font-bold">Calendar Canvas</h1>
          <p className="text-sm">ปฏิทินที่เขียนด้วยลายมือของคุณเอง</p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {Object.hasOwn(ERROR_MESSAGES, error) ? ERROR_MESSAGES[error] : ERROR_MESSAGES.sign_in_failed}
            </p>
          )}
          <div className="paper-shadow">
            <Button size="lg" className="paper-torn h-11 px-6 text-sm" onClick={signIn}>
              เข้าสู่ระบบด้วย Google
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
