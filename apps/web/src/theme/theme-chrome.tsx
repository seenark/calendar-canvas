import { Toaster } from "@calendar-canvas/ui/components/sonner";
import { useEffect } from "react";

import { useTheme } from "@/components/theme-provider";

import { isDarkTheme } from "./themes";

/** Keeps `<meta name="theme-color">` on the current --background. Watches data-theme because next-themes writes it after child effects run. */
export function ThemeColorMeta() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    const tag = meta;
    const sync = () => {
      tag.content = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return null;
}

/** Sonner only knows light/dark/system, so fold the theme key into one of them. */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster richColors theme={isDarkTheme(resolvedTheme) ? "dark" : "light"} />;
}
