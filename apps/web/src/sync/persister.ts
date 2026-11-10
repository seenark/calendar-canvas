import { dehydrate, type DehydrateOptions, type QueryClient } from "@tanstack/react-query";
import type {
  PersistedClient,
  Persister,
  PersistQueryClientProviderProps,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";
const COALESCE_MS = 1000;
const buster = __APP_VERSION__;
const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (query) =>
    (query.queryKey[0] === "month" || query.queryKey[0] === "me") && query.state.data !== undefined,
};

export type QueryCachePersister = Persister & {
  /** Writes the live query cache and resolves once that write is stored. The write starts after the call. Rejects when it fails. */
  flush(): Promise<void>;
  /** Resolves after the next successful write that starts after the call, whoever scheduled it. Never rejects. */
  nextStored(): Promise<void>;
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
    nextStored: async () => {
      for (;;) {
        try {
          return await upcoming.promise;
        } catch {}
      }
    },
  };
}

/** Paused mutations (the default), month queries and the signed-in identity, so the app opens offline. A failed refetch keeps data, so test for data, not status. */
export const queryCachePersistOptions = (
  persister: QueryCachePersister,
): PersistQueryClientProviderProps["persistOptions"] => ({
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster,
  dehydrateOptions,
});
