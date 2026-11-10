import { Button } from "@calendar-canvas/ui/components/button";
import { useAtom } from "jotai/react";
import { Eraser, PenLine } from "lucide-react";

import { toolAtom, type Tool } from "@/state/tool";

import { ColorDrawer } from "./color-drawer";
import { SizeControl } from "./size-control";

const TOOLS = [
  { tool: "pen", label: "ปากกา", Icon: PenLine },
  { tool: "eraser", label: "ยางลบ", Icon: Eraser },
] as const satisfies readonly { tool: Tool }[];

/** Sits above the safe area. Every target is 44px square so one thumb reaches all of it. */
export function Toolbar({ paperWidth }: { paperWidth: number }) {
  const [active, setTool] = useAtom(toolAtom);

  return (
    <div className="bg-background border-border flex h-16 shrink-0 items-center justify-around border-t px-2">
      <div className="flex">
        {TOOLS.map(({ tool, label, Icon }) => (
          <Button
            key={tool}
            variant={tool === active ? "default" : "ghost"}
            aria-label={label}
            aria-pressed={tool === active}
            className="size-11"
            onClick={() => setTool(tool)}
          >
            <Icon className="size-5" />
          </Button>
        ))}
      </div>
      <SizeControl paperWidth={paperWidth} />
      <ColorDrawer />
    </div>
  );
}
