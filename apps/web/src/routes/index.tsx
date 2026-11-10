import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main className="grid flex-1 place-items-center">
      <h1 className="text-2xl font-bold">Calendar Canvas</h1>
    </main>
  );
}
