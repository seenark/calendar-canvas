import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

import { useTheme } from "@/components/theme-provider";

const THEME_COLOR = { light: "#eff1f5", dark: "#1e1e2e" } as const;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = THEME_COLOR[resolvedTheme];
  }, [resolvedTheme]);

  return (
    <span className="paper-shadow">
      <button
        type="button"
        aria-label="สลับธีมสว่างหรือมืด"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="paper-tag grid size-11 place-items-center p-0"
      >
        <Sun className="size-5 dark:hidden" />
        <Moon className="hidden size-5 dark:block" />
      </button>
    </span>
  );
}
