import { monthOfDay } from "@/lib/date";
import { useToday } from "@/lib/use-today";

export function TodayButton({ onJump }: { onJump: (yearMonth: string) => void }) {
  const today = useToday();

  return (
    <span className="paper-shadow">
      <button
        type="button"
        onClick={() => onJump(monthOfDay(today))}
        className="paper-tag h-11 px-4 text-sm font-bold"
      >
        วันนี้
      </button>
    </span>
  );
}
