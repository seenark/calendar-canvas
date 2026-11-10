import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { dayStore } from "./sync/day-store";
import { STROKE_OPS_KEY, sendOps, strokeOpsDefaults } from "./sync/mutations";
import { bindMonthsToStore } from "./sync/queries";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true },
  },
});
queryClient.setMutationDefaults(STROKE_OPS_KEY, strokeOpsDefaults(queryClient, dayStore));
bindMonthsToStore(queryClient, dayStore);
dayStore.subscribeOps(() => sendOps(queryClient, dayStore));

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
  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
