import { MAX_STROKE_POINTS } from "./constants";
import type { InkPoint } from "./point";

export type DecodedPoints = { points: InkPoint[]; hasPressure: boolean };

const FLAG_PRESSURE = 1;
const COORD_MAX = 65535;
const PRESSURE_MAX = 255;

const decoders: Record<number, (bytes: Uint8Array) => DecodedPoints> = {
  1: decodeV1,
};

export function encodePoints(
  points: readonly InkPoint[],
  { hasPressure }: { hasPressure: boolean },
): Uint8Array {
  if (points.length > MAX_STROKE_POINTS) {
    throw new RangeError(`Stroke has ${points.length} points, max is ${MAX_STROKE_POINTS}`);
  }
  const out: number[] = [1, hasPressure ? FLAG_PRESSURE : 0];
  writeVarint(out, points.length);
  let prevX = 0;
  let prevY = 0;
  for (const p of points) {
    const x = quantize(p.x, COORD_MAX);
    const y = quantize(p.y, COORD_MAX);
    writeVarint(out, zigzag(x - prevX));
    writeVarint(out, zigzag(y - prevY));
    prevX = x;
    prevY = y;
    if (hasPressure) {
      if (p.pressure === undefined)
        throw new TypeError("hasPressure is set but a point has no pressure");
      out.push(quantize(p.pressure, PRESSURE_MAX));
    }
  }
  return Uint8Array.from(out);
}

export function decodePoints(bytes: Uint8Array): DecodedPoints {
  const decode = decoders[bytes[0] ?? -1];
  if (!decode) throw new Error(`Unsupported ink codec version: ${bytes[0]}`);
  return decode(bytes);
}

function decodeV1(bytes: Uint8Array): DecodedPoints {
  if (bytes.length < 2) throw new Error("Ink data truncated");
  const flags = bytes[1]!;
  if (flags & ~FLAG_PRESSURE) throw new Error(`Unknown ink flags: ${flags}`);
  const hasPressure = (flags & FLAG_PRESSURE) !== 0;
  const cursor = { bytes, pos: 2 };
  const count = readVarint(cursor);
  if (count > MAX_STROKE_POINTS)
    throw new Error(`Stroke has ${count} points, max is ${MAX_STROKE_POINTS}`);
  const points: InkPoint[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    x += unzigzag(readVarint(cursor));
    y += unzigzag(readVarint(cursor));
    if (x < 0 || x > COORD_MAX || y < 0 || y > COORD_MAX) throw new Error("Ink point out of range");
    const point: InkPoint = { x: x / COORD_MAX, y: y / COORD_MAX };
    if (hasPressure) point.pressure = readByte(cursor) / PRESSURE_MAX;
    points.push(point);
  }
  if (cursor.pos !== bytes.length) throw new Error("Ink data has trailing bytes");
  return { points, hasPressure };
}

type Cursor = { bytes: Uint8Array; pos: number };

function quantize(v: number, max: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`Ink value is not finite: ${v}`);
  return Math.round(Math.min(1, Math.max(0, v)) * max);
}

const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

function writeVarint(out: number[], value: number): void {
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  out.push(value);
}

function readByte(c: Cursor): number {
  const b = c.bytes[c.pos++];
  if (b === undefined) throw new Error("Ink data truncated");
  return b;
}

function readVarint(c: Cursor): number {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    const b = readByte(c);
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return value;
  }
  throw new Error("Ink varint too long");
}
