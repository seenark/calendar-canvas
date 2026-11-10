import { ApiError } from "@/lib/api";

/** Network errors (a `fetch` TypeError), 408, 429 and 5xx. Never other 4xx: the server rejected the batch itself, and a 401 needs the User to sign in. */
export function shouldRetry(_failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError)
    return error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

/** 1 s, 2 s, 4 s, ... capped at 30 s. */
export const retryDelay = (failureCount: number): number =>
  Math.min(1000 * 2 ** failureCount, 30_000);
