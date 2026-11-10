import { planPrune, type PruneResult } from "./plan";
import type { PruningRequest } from "./protocol";

self.onmessage = ({ data }: MessageEvent<PruningRequest>) => {
  let result: PruneResult;
  try {
    result = planPrune({
      ...data,
      protectedIds: new Set(data.protectedIds),
      createCanvas: (width, height) => new OffscreenCanvas(width, height),
    });
  } catch (e) {
    result = { aborted: String(e) };
  }
  self.postMessage(result);
};
