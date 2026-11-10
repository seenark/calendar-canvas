import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
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
import { PERSIST_MAX_AGE, persistOptions } from "./sync/persister";
import { bindMonthsToStore } from "./sync/queries";

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
queryClient.setMutationDefaults(STROKE_OPS_KEY, strokeOpsDefaults(queryClient, dayStore));
bindMonthsToStore(queryClient, dayStore);

/** Runs once the persisted cache is back, and not before, so a restored Op is never sent beside its restored mutation. */
function onRestored() {
  adoptRestoredStrokeOps(queryClient, dayStore);
  void queryClient.resumePausedMutations();
  startFlushing(dayStore, () => sendOps(queryClient, dayStore));
  sendOps(queryClient, dayStore);
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
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
  await restoreBuffer(dayStore);
  persistBuffer(dayStore);
  root.render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={onRestored}
      onError={onRestored}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>,
  );
}
