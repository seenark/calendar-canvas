import { Toaster } from "@calendar-canvas/ui/components/sonner";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export interface RouterAppContext {}

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
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <div className="app-shell">
          <Outlet />
        </div>
        <Toaster richColors />
      </ThemeProvider>
    </>
  );
}
