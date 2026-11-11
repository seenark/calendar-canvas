import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Cal Admin icons: the calendar logo on black, written next to the source as admin-*.png.
// Run with `bun run generate-pwa-assets:admin`.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0, favicons: [] },
    maskable: { ...minimal2023Preset.maskable, padding: 0 },
    apple: { ...minimal2023Preset.apple, padding: 0 },
    assetName: (type, { width, height }) =>
      ({
        transparent: `admin-pwa-${width}x${height}.png`,
        maskable: `admin-maskable-icon-${width}x${height}.png`,
        apple: `admin-apple-touch-icon-${width}x${height}.png`,
      })[type],
  },
  images: ["public/logo-admin.svg"],
});
