import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 3001,
    proxy: { "/api": "http://localhost:8080" },
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.ts"],
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    VitePWA({
      registerType: "prompt",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Calendar Canvas",
        short_name: "Cal Canvas",
        description: "Handwritten calendar PWA",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#eff1f5",
        background_color: "#eff1f5",
      },
      pwaAssets: { disabled: false, config: true },
    }),
  ],
});
