import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { DehydrateOptions, QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientSave,
  type PersistQueryClientProviderProps,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const storage = { getItem: get, setItem: set, removeItem: del };
const persister = createAsyncStoragePersister({ storage });
// The default persister throttles to 1 s and resolves early when a save is already scheduled, so it cannot say when data is durable.
const immediatePersister = createAsyncStoragePersister({ storage, throttleTime: 0 });
const buster = __APP_VERSION__;
const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (query) =>
    (query.queryKey[0] === "month" || query.queryKey[0] === "me") && query.state.data !== undefined,
};

/** Paused mutations (the default), month queries and the signed-in identity, so the app opens offline. A failed refetch keeps data, so test for data, not status. */
export const persistOptions: PersistQueryClientProviderProps["persistOptions"] = {
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster,
  dehydrateOptions,
};

/** Writes the query cache now and resolves once it is stored. A storage failure is swallowed by the persister, so it resolves anyway. */
export const saveQueryCacheNow = (queryClient: QueryClient): Promise<void> =>
  persistQueryClientSave({ queryClient, persister: immediatePersister, buster, dehydrateOptions });
