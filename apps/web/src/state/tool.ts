import { atom } from "jotai";

export type Tool = "pen" | "eraser";

export const toolAtom = atom<Tool>("pen");

/** Pen colour and size. Size is a fraction of the Day's width. */
export const penAtom = atom({ color: "#4c4f69", size: 0.012 });
