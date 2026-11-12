import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { ThemeProvider } from "@/components/theme-provider";
import { UpdatePrompt } from "@/pwa/update-prompt";
import { ThemeColorMeta, ThemedToaster } from "@/theme/theme-chrome";
import { THEME_KEYS } from "@/theme/themes";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Calendar Canvas",
      },
      {
        name: "description",
        content: "Handwritten calendar PWA",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="data-theme"
        themes={THEME_KEYS}
        defaultTheme="system"
        enableSystem
        enableColorScheme={false}
        disableTransitionOnChange
      >
        <div className="app-shell">
          <Outlet />
        </div>
        <ThemedToaster />
        <ThemeColorMeta />
        <UpdatePrompt />
      </ThemeProvider>
    </>
  );
}
