import {
  dehydrate,
  type DehydratedState,
  type DehydrateOptions,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  PersistedClient,
  Persister,
  PersistQueryClientProviderProps,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";
const COALESCE_MS = 1000;
const buster = __APP_VERSION__;
const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: ({ queryKey, state }) =>
    (["month", "sharedMonth", "me"].includes(queryKey[0] as string) ||
      // the Share lists, not ['shares', 'candidates']
      (queryKey[0] === "shares" && queryKey.length === 1)) &&
    state.data !== undefined,
};

export type QueryCachePersister = Persister & {
  /** Writes the live query cache and resolves once that write is stored. The write starts after the call. Rejects when it fails. */
  flush(): Promise<void>;
  /** Calls `listener` with the dehydrated cache of every successful write, whoever scheduled it. Returns the unsubscribe function. */
  onStored(listener: (stored: DehydratedState) => void): () => void;
};

const outcome = () => {
  const deferred = Promise.withResolvers<void>();
  deferred.promise.catch(() => {});
  return deferred;
};

/**
 * The one writer of the query cache record. Writes run one at a time and each serializes the live cache when it
 * starts, so an older snapshot never lands after a newer one. `persistClient` only marks the cache dirty.
 */
export function createQueryCachePersister(queryClient: QueryClient): QueryCachePersister {
  let dirty = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  let upcoming = outcome();
  const listeners = new Set<(stored: DehydratedState) => void>();

  const write = async () => {
    queued = false;
    const mine = upcoming;
    upcoming = outcome();
    dirty = false;
    try {
      const client: PersistedClient = {
        buster,
        timestamp: Date.now(),
        clientState: dehydrate(queryClient, dehydrateOptions),
      };
      await set(CACHE_KEY, JSON.stringify(client));
      for (const listener of listeners) listener(client.clientState);
      mine.resolve();
    } catch (error) {
      dirty = true;
      console.warn("Could not save the query cache", error);
      mine.reject(error);
    }
  };

  const enqueue = () => {
    if (queued) return;
    queued = true;
    chain = chain.then(write);
  };

  return {
    persistClient: () => {
      dirty = true;
      timer ??= setTimeout(() => {
        timer = undefined;
        if (dirty) enqueue();
      }, COALESCE_MS);
    },
    restoreClient: async () => {
      const saved = await get<string>(CACHE_KEY);
      return saved ? (JSON.parse(saved) as PersistedClient) : undefined;
    },
    removeClient: () => del(CACHE_KEY),
    flush: () => {
      const result = upcoming.promise;
      enqueue();
      return result;
    },
    onStored: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Paused mutations (the default), month queries (own and Shared), the Share lists and the signed-in identity, so the app opens offline. A failed refetch keeps data, so test for data, not status. */
export const queryCachePersistOptions = (
  persister: QueryCachePersister,
): PersistQueryClientProviderProps["persistOptions"] => ({
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster,
  dehydrateOptions,
});
