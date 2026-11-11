import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

// iOS reads these head links when the user taps Add to Home Screen, and the SPA has one HTML shell,
// so the calendar's links are repointed in place while an Admin route is mounted.
function pointLinkAt(rel: string, href: string) {
  const existing = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (existing) {
    const previous = existing.getAttribute("href");
    existing.setAttribute("href", href);
    return () => {
      if (previous === null) existing.removeAttribute("href");
      else existing.setAttribute("href", previous);
    };
  }
  const created = Object.assign(document.createElement("link"), { rel, href });
  document.head.append(created);
  return () => created.remove();
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Cal Admin" }, { name: "apple-mobile-web-app-title", content: "Cal Admin" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  useEffect(() => {
    const restoreManifest = pointLinkAt("manifest", "/admin.webmanifest");
    const restoreIcon = pointLinkAt("apple-touch-icon", "/admin-apple-touch-icon-180x180.png");
    return () => {
      restoreManifest();
      restoreIcon();
    };
  }, []);

  return <Outlet />;
}
