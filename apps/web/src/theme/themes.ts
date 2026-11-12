/** Keys double as the `data-theme` value. 'light' and 'dark' are Latte and Mocha, kept so saved preferences survive. Mirror dark keys in the `dark` variant in packages/ui/src/styles/globals.css. */
export const THEMES = [
  { key: "light", name: "Catppuccin Latte", mode: "light" },
  { key: "rose-pine-dawn", name: "Rosé Pine Dawn", mode: "light" },
  { key: "gruvbox-light", name: "Gruvbox Light", mode: "light" },
  { key: "solarized-light", name: "Solarized Light", mode: "light" },
  { key: "everforest-light", name: "Everforest Light", mode: "light" },
  { key: "dark", name: "Catppuccin Mocha", mode: "dark" },
  { key: "rose-pine", name: "Rosé Pine", mode: "dark" },
  { key: "nord", name: "Nord", mode: "dark" },
  { key: "tokyo-night", name: "Tokyo Night", mode: "dark" },
  { key: "dracula", name: "Dracula", mode: "dark" },
] as const;

export const THEME_KEYS: string[] = THEMES.map((t) => t.key);

export const isDarkTheme = (key: string | undefined) =>
  THEMES.some((t) => t.key === key && t.mode === "dark");
