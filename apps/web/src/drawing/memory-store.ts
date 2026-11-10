import type { Stroke } from "./stroke";

const strokesByDay = new Map<string, Stroke[]>();

/** Session-only Strokes per Day. Replaced by the Day store. */
export function getDayStrokes(day: string): Stroke[] {
  return strokesByDay.get(day) ?? [];
}

export function addDayStroke(stroke: Stroke): void {
  const list = strokesByDay.get(stroke.day);
  if (list) list.push(stroke);
  else strokesByDay.set(stroke.day, [stroke]);
}
