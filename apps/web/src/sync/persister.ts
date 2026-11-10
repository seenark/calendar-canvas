import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
});

/** Paused mutations (the default), month queries and the signed-in identity, so the app opens offline. A failed refetch keeps data, so test for data, not status. */
export const persistOptions: PersistQueryClientProviderProps["persistOptions"] = {
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster: __APP_VERSION__,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      (query.queryKey[0] === "month" || query.queryKey[0] === "me") &&
      query.state.data !== undefined,
  },
};
