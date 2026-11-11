import { QueryClient, onlineManager, useIsRestoring } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { persistBuffer, restoreBuffer } from "./sync/buffer";
import { dayStore } from "./sync/day-store";
import { startFlushing } from "./sync/flush";
import {
  STROKE_OPS_KEY,
  adoptRestoredStrokeOps,
  sendOps,
  strokeOpsDefaults,
} from "./sync/mutations";
import {
  createQueryCachePersister,
  PERSIST_MAX_AGE,
  queryCachePersistOptions,
} from "./sync/persister";
import { bindMonthsToStore } from "./sync/queries";
import { watchSession } from "./sync/session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: PERSIST_MAX_AGE,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});
const queryCachePersister = createQueryCachePersister(queryClient);
onlineManager.setOnline(navigator.onLine);
queryClient.setMutationDefaults(
  STROKE_OPS_KEY,
  strokeOpsDefaults(queryClient, dayStore, queryCachePersister),
);
bindMonthsToStore(queryClient, dayStore);

/** Route guards read the persisted cache, so the router starts only after it is restored. */
function AfterRestore({ children }: { children: ReactNode }) {
  return useIsRestoring() ? <Loader /> : children;
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // The Month view keeps its own scroll position. The router's restoration would overwrite it after each navigation.
  scrollRestoration: ({ location }) => !/^\/[md]\//.test(location.pathname),
  defaultPendingComponent: () => <Loader />,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  const bufferRestored = await restoreBuffer(dayStore);
  persistBuffer(dayStore);
  let started = false;
  /** Runs once the persisted cache is back, and not before, so a restored Op is never sent beside its restored mutation. */
  const onRestored = () => {
    if (started) return;
    started = true;
    adoptRestoredStrokeOps(queryClient, dayStore, bufferRestored);
    void queryClient.resumePausedMutations();
    startFlushing(dayStore, () => sendOps(queryClient, dayStore));
    watchSession(queryClient, dayStore);
    sendOps(queryClient, dayStore);
  };
  root.render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={queryCachePersistOptions(queryCachePersister)}
      onSuccess={onRestored}
      onError={onRestored}
    >
      <AfterRestore>
        <RouterProvider router={router} />
      </AfterRestore>
    </PersistQueryClientProvider>,
  );
}
