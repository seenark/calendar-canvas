export type BatchLimits = { maxOps: number; maxBytes: number };

export const BATCH_LIMITS: BatchLimits = { maxOps: 200, maxBytes: 1_500_000 };

/**
 * Splits `ops` into consecutive batches, keeping their order. A batch holds at most `maxOps` Ops and its
 * JSON-encoded payload `{"ops":[...]}` stays within `maxBytes`, measured on `wire(op)`. An Op that alone
 * exceeds `maxBytes` gets a batch of its own. Sizes count UTF-16 units, which equal bytes for the ASCII wire format.
 */
export function splitBatches<T>(
  ops: readonly T[],
  { maxOps, maxBytes }: BatchLimits,
  wire: (op: T) => unknown = (op) => op,
): T[][] {
  const overhead = '{"ops":[]}'.length;
  const batches: T[][] = [];
  let batch: T[] = [];
  let bytes = overhead;
  for (const op of ops) {
    const size = JSON.stringify(wire(op)).length + 1;
    if (batch.length > 0 && (batch.length >= maxOps || bytes + size > maxBytes)) {
      batches.push(batch);
      batch = [];
      bytes = overhead;
    }
    batch.push(op);
    bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
