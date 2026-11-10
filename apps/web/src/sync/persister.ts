import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
});

/** Paused mutations (the default) and month queries. Nothing else, so a session never outlives its sign-in. */
export const persistOptions: PersistQueryClientProviderProps["persistOptions"] = {
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster: __APP_VERSION__,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.queryKey[0] === "month" && query.state.status === "success",
  },
};
