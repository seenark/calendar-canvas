import { buttonVariants } from "@calendar-canvas/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@calendar-canvas/ui/components/drawer";
import { cn } from "@calendar-canvas/ui/lib/utils";
import { useAtom, useSetAtom } from "jotai/react";
import { useState } from "react";

import { PALETTE, pushRecentColor } from "@/drawing/palette";
import { penAtom, recentColorsAtom, toolAtom } from "@/state/tool";

function Swatches({
  colors,
  current,
  onPick,
}: {
  colors: readonly string[];
  current: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 justify-items-center gap-2">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={color === current}
          className={cn(
            "border-border size-11 rounded-full border",
            color === current && "ring-foreground ring-2 ring-offset-2",
          )}
          style={{ backgroundColor: color }}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

export function ColorDrawer() {
  const [open, setOpen] = useState(false);
  const [pen, setPen] = useAtom(penAtom);
  const [recent, setRecent] = useAtom(recentColorsAtom);
  const setTool = useSetAtom(toolAtom);

  const pick = (color: string) => {
    setPen((p) => ({ ...p, color }));
    setRecent((r) => pushRecentColor(r, color));
    setTool("pen");
    setOpen(false);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        aria-label="สี"
        className={cn(buttonVariants({ variant: "ghost" }), "size-11")}
      >
        <span
          className="border-border size-6 rounded-full border"
          style={{ backgroundColor: pen.color }}
        />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>สี</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {recent.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs">ใช้ล่าสุด</h3>
              <Swatches colors={recent} current={pen.color} onPick={pick} />
            </section>
          )}
          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs">จานสี</h3>
            <Swatches colors={PALETTE} current={pen.color} onPick={pick} />
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
