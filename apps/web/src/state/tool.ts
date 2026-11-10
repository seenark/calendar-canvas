import { atom } from "jotai/vanilla";
import {
  atomWithStorage,
  createJSONStorage,
  unstable_withStorageValidator as withStorageValidator,
} from "jotai/vanilla/utils";

import { DEFAULT_PEN_COLOR, MAX_RECENT_COLORS, isHexColor } from "@/drawing/palette";
import { DEFAULT_ERASER_SIZE, DEFAULT_PEN_SIZE, isValidSize } from "@/drawing/sizes";
import type { StrokeKind } from "@/drawing/stroke";

export type Tool = StrokeKind;

/** Not persisted. The Drawing page resets it to the Pen on mount. */
export const toolAtom = atom<Tool>("pen");

export type PenSettings = { color: string; size: number };
export type EraserSettings = { size: number };

export const isPenSettings = (v: unknown): v is PenSettings =>
  typeof v === "object" &&
  v !== null &&
  "color" in v &&
  isHexColor(v.color) &&
  "size" in v &&
  isValidSize(v.size);

export const isEraserSettings = (v: unknown): v is EraserSettings =>
  typeof v === "object" && v !== null && "size" in v && isValidSize(v.size);

export const isRecentColors = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= MAX_RECENT_COLORS &&
  v.every(isHexColor) &&
  new Set(v).size === v.length;

const stored = <T>(key: string, initial: T, isValid: (v: unknown) => v is T) =>
  atomWithStorage(key, initial, withStorageValidator(isValid)(createJSONStorage<unknown>()), {
    getOnInit: true,
  });

/** `getOnInit` makes the engine's `store.get()` at the first pointerdown see the stored value. */
export const penAtom = stored<PenSettings>(
  "lastPen",
  { color: DEFAULT_PEN_COLOR, size: DEFAULT_PEN_SIZE },
  isPenSettings,
);

export const eraserAtom = stored<EraserSettings>(
  "lastEraser",
  { size: DEFAULT_ERASER_SIZE },
  isEraserSettings,
);

export const recentColorsAtom = stored<string[]>("recentColors", [], isRecentColors);
