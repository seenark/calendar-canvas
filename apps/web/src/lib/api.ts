import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { requestPersistentStorage } from "./storage";

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

/** Where the Google sign-in starts and where it sends the User back to. */
export const signInUrl = (returnPath: string): string =>
  "/api/auth/google/start?return=" + encodeURIComponent(returnPath);

export interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null } | null;
  role: "user" | "admin";
}

export const meQuery = queryOptions({
  queryFn: async () => {
    const me = await api<Me>("/api/me");
    if (me.user) requestPersistentStorage();
    return me;
  },
  queryKey: ["me"],
  retry: false,
  networkMode: "always",
});

/**
 * The signed-in identity, or null when the server says there is no session. Any other failure (offline, 5xx)
 * falls back to the identity from the last sign-in, so the app opens offline; with none, the failure is rethrown.
 */
export async function fetchMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    return await queryClient.fetchQuery(meQuery);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      queryClient.removeQueries({ queryKey: meQuery.queryKey });
      return null;
    }
    const cached = queryClient.getQueryData(meQuery.queryKey);
    if (cached) return cached;
    throw err;
  }
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  strokeCount: number;
}

export const adminUsersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: () => api<AdminUser[]>("/api/admin/users"),
});
