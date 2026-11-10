/** Catppuccin Latte. The first entry is the default Pen colour. */
export const PALETTE = [
  "#4c4f69",
  "#8c8fa1",
  "#d20f39",
  "#fe640b",
  "#df8e1d",
  "#40a02b",
  "#179299",
  "#1e66f5",
  "#8839ef",
  "#ea76cb",
] as const;

export const DEFAULT_PEN_COLOR = PALETTE[0];

export const MAX_RECENT_COLORS = 5;

export const isHexColor = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);

/** Newest first, de-duplicated, capped at MAX_RECENT_COLORS. */
export function pushRecentColor(recent: readonly string[], color: string): string[] {
  return [color, ...recent.filter((c) => c !== color)].slice(0, MAX_RECENT_COLORS);
}
