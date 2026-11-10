import { queryOptions } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? res.statusText,
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null } | null;
  role: "user" | "admin";
}

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => api<Me>("/api/me"),
  retry: false,
});
