import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@calendar-canvas/ui/components/drawer";
import { Check, Moon, Palette, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { THEMES } from "@/theme/themes";

/** `data-theme` on the swatch re-scopes the theme variables, so it previews the real palette. */
function Swatch({ themeKey }: { themeKey: string }) {
  return (
    <span
      data-theme={themeKey}
      className="bg-background border-border flex h-9 w-14 shrink-0 items-center justify-center gap-1.5 rounded-md border"
    >
      <span className="bg-paper border-border h-5 w-3.5 rounded-xs border" />
      <span className="bg-cream h-3 w-4 rounded-xs" />
      <span className="bg-ema size-2.5 rounded-full" />
    </span>
  );
}

function SystemSwatch() {
  return (
    <span className="border-border flex h-9 w-14 shrink-0 overflow-hidden rounded-md border">
      <span
        data-theme="light"
        className="bg-background text-foreground grid flex-1 place-items-center"
      >
        <Sun className="size-4" />
      </span>
      <span
        data-theme="dark"
        className="bg-background text-foreground grid flex-1 place-items-center"
      >
        <Moon className="size-4" />
      </span>
    </span>
  );
}

function Row({
  active,
  label,
  swatch,
  onPick,
}: {
  active: boolean;
  label: string;
  swatch: React.ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className="aria-pressed:bg-accent flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-transform duration-150 ease-out active:scale-[0.98]"
    >
      {swatch}
      <span className="flex-1">{label}</span>
      {active && <Check className="size-4" />}
    </button>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Drawer>
      <span className="paper-shadow">
        <DrawerTrigger
          aria-label="เลือกธีม"
          className="paper-tag grid size-11 place-items-center p-0"
        >
          <Palette className="size-5" />
        </DrawerTrigger>
      </span>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>ธีม</DrawerTitle>
        </DrawerHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Row
            active={theme === "system"}
            label="ตามระบบ"
            swatch={<SystemSwatch />}
            onPick={() => setTheme("system")}
          />
          {(["light", "dark"] as const).map((mode) => (
            <section key={mode} className="flex flex-col gap-1">
              <h3 className="text-muted-foreground px-3 pb-1 text-xs">
                {mode === "light" ? "สว่าง" : "มืด"}
              </h3>
              {THEMES.filter((t) => t.mode === mode).map((t) => (
                <Row
                  key={t.key}
                  active={theme === t.key}
                  label={t.name}
                  swatch={<Swatch themeKey={t.key} />}
                  onPick={() => setTheme(t.key)}
                />
              ))}
            </section>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
