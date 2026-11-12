import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@calendar-canvas/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@calendar-canvas/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@calendar-canvas/ui/components/dropdown-menu";
import { cn } from "@calendar-canvas/ui/lib/utils";

import type { PublicUser, SharedCalendar } from "@/api/types";
import { meQuery } from "@/lib/api";

import { monthLink } from "./links";
import { candidatesQuery, sharesQuery, useShareActions } from "./queries";
import { displayName, UserAvatar } from "./user";

const OWN_LABEL = "ปฏิทินของฉัน";

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-muted-foreground px-2 pb-1 text-xs font-bold">{children}</h3>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground px-2 py-3 text-xs">{children}</p>;
}

function Row({
  user,
  title = displayName(user),
  note,
  children,
}: {
  user: PublicUser;
  title?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-2">
      <UserAvatar user={user} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        {note && <span className="text-muted-foreground block text-xs">{note}</span>}
      </span>
      {children}
    </li>
  );
}

function CalendarRow({
  user,
  title,
  note,
  active,
  onSelect,
  children,
}: {
  user: PublicUser;
  title?: string;
  note: string;
  active: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center">
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className="hover:bg-muted/60 flex min-h-14 min-w-0 flex-1 items-center gap-3 px-2 text-left transition-[transform,background-color] duration-150 ease-out active:scale-[0.98]"
      >
        <UserAvatar user={user} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{title ?? displayName(user)}</span>
          <span className="text-muted-foreground block text-xs">{note}</span>
        </span>
        <Check
          aria-hidden="true"
          className={cn("size-5 shrink-0", active ? "opacity-100" : "opacity-0")}
        />
      </button>
      {children}
    </li>
  );
}

/**
 * Header button naming the open calendar, and the drawer behind it: switch between the User's own calendar and
 * the ones Shared with them, answer Invitations, and manage who can view the User's calendar.
 * `ownerId` is null on the User's own calendar; `yearMonth` is kept when switching.
 */
export function CalendarSwitcher({
  ownerId,
  yearMonth,
}: {
  ownerId: string | null;
  yearMonth: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery).data?.user;
  const shares = useQuery(sharesQuery);
  const candidates = useQuery({ ...candidatesQuery, enabled: open }).data?.users ?? [];
  const { invite, accept, decline, remove } = useShareActions();

  const self: PublicUser = {
    id: me?.id ?? "",
    name: me?.name ?? null,
    avatarUrl: me?.avatarUrl ?? null,
  };
  const calendars = shares.data?.calendars ?? [];
  const invitations = shares.data?.invitations ?? [];
  const viewers = shares.data?.viewers ?? [];
  const owner =
    ownerId === null
      ? self
      : (calendars.find((c) => c.owner.id === ownerId)?.owner ?? {
          id: ownerId,
          name: null,
          avatarUrl: null,
        });
  const pickedUser = candidates.find((u) => u.id === picked);

  const pick = (id: string | null) => {
    void navigate({ ...monthLink(id, yearMonth), replace: true });
    setOpen(false);
  };

  const leave = (calendar: SharedCalendar) => {
    if (!window.confirm(`เลิกดูปฏิทินของ ${displayName(calendar.owner)}?`)) return;
    remove.mutate(calendar.id, {
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: ["sharedMonth", calendar.owner.id] });
        if (calendar.owner.id === ownerId) pick(null);
      },
    });
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <span className="paper-shadow relative min-w-0">
        <DrawerTrigger
          aria-label="เลือกปฏิทิน"
          className="paper-tag flex h-11 max-w-full items-center gap-2 pr-3 pl-2 text-sm font-bold transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          <UserAvatar user={owner} size={28} />
          <span className="max-w-[160px] truncate">
            {ownerId === null ? OWN_LABEL : displayName(owner)}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </DrawerTrigger>
        {invitations.length > 0 && (
          <span
            aria-hidden="true"
            className="bg-destructive text-background absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] leading-none font-bold"
          >
            {invitations.length}
          </span>
        )}
      </span>
      <DrawerContent className="mx-auto w-full max-w-[430px]">
        <DrawerHeader>
          <DrawerTitle>ปฏิทิน</DrawerTitle>
        </DrawerHeader>
        <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-3 pb-24">
          {shares.isError && !shares.data && (
            <p role="alert" className="text-destructive px-2 text-xs">
              โหลดรายการแชร์ไม่สำเร็จ
            </p>
          )}
          <section>
            <SectionTitle>{OWN_LABEL}</SectionTitle>
            <ul>
              <CalendarRow
                user={self}
                title={OWN_LABEL}
                note="วาดได้ทุกวัน"
                active={ownerId === null}
                onSelect={() => pick(null)}
              />
            </ul>
          </section>
          <section>
            <SectionTitle>แชร์กับฉัน</SectionTitle>
            <ul>
              {calendars.map((c) => (
                <CalendarRow
                  key={c.id}
                  user={c.owner}
                  note="ดูอย่างเดียว"
                  active={c.owner.id === ownerId}
                  onSelect={() => pick(c.owner.id)}
                >
                  <Button
                    variant="ghost"
                    className="h-10 px-2.5"
                    aria-label={`เลิกดูปฏิทินของ ${displayName(c.owner)}`}
                    disabled={remove.isPending}
                    onClick={() => leave(c)}
                  >
                    เลิกดู
                  </Button>
                </CalendarRow>
              ))}
            </ul>
            {calendars.length === 0 && <Empty>ยังไม่มีปฏิทินที่แชร์กับคุณ</Empty>}
          </section>
          <section className="border-foreground/10 border-t pt-3">
            <SectionTitle>คำเชิญ{invitations.length > 0 && ` (${invitations.length})`}</SectionTitle>
            <ul>
              {invitations.map((i) => (
                <Row key={i.id} user={i.owner} note="เชิญคุณดูปฏิทิน">
                  <Button
                    variant="ghost"
                    className="h-10 px-2.5"
                    aria-label={`ปฏิเสธคำเชิญของ ${displayName(i.owner)}`}
                    disabled={decline.isPending || accept.isPending}
                    onClick={() => decline.mutate(i.id)}
                  >
                    ปฏิเสธ
                  </Button>
                  <Button
                    className="h-10 px-3"
                    aria-label={`ยอมรับคำเชิญของ ${displayName(i.owner)}`}
                    disabled={decline.isPending || accept.isPending}
                    onClick={() => accept.mutate(i.id)}
                  >
                    ยอมรับ
                  </Button>
                </Row>
              ))}
            </ul>
            {invitations.length === 0 && <Empty>ไม่มีคำเชิญ</Empty>}
          </section>
          <section className="border-foreground/10 border-t pt-3">
            <SectionTitle>แชร์ปฏิทินของฉัน</SectionTitle>
            <div className="flex items-center gap-2 px-2 pb-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="เลือกผู้ใช้ที่จะเชิญ"
                  disabled={candidates.length === 0}
                  className="border-border bg-background flex h-10 min-w-0 flex-1 items-center gap-2 border px-2 text-sm disabled:opacity-50"
                >
                  {pickedUser ? (
                    <>
                      <UserAvatar user={pickedUser} size={24} />
                      <span className="truncate">{displayName(pickedUser)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground truncate">
                      {candidates.length === 0 ? "ไม่มีผู้ใช้ให้เชิญ" : "เลือกผู้ใช้"}
                    </span>
                  )}
                  <ChevronDown className="ml-auto size-4 shrink-0" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup value={picked ?? ""} onValueChange={setPicked}>
                    {candidates.map((u) => (
                      <DropdownMenuRadioItem
                        key={u.id}
                        value={u.id}
                        closeOnClick
                        className="text-sm"
                      >
                        <UserAvatar user={u} size={24} />
                        <span className="truncate">{displayName(u)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className="h-10 px-3"
                disabled={!pickedUser || invite.isPending}
                onClick={() => invite.mutate(pickedUser!.id, { onSuccess: () => setPicked(null) })}
              >
                ส่งคำเชิญ
              </Button>
            </div>
            <ul>
              {viewers.map((v) => (
                <Row
                  key={v.id}
                  user={v.viewer}
                  note={v.status === "pending" ? "รอตอบรับ" : "ดูได้แล้ว"}
                >
                  <Button
                    variant="ghost"
                    className="h-10 px-2.5"
                    aria-label={`ยกเลิกการแชร์กับ ${displayName(v.viewer)}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`ยกเลิกการแชร์ปฏิทินกับ ${displayName(v.viewer)}?`))
                        remove.mutate(v.id);
                    }}
                  >
                    {v.status === "pending" ? "ยกเลิกคำเชิญ" : "เลิกแชร์"}
                  </Button>
                </Row>
              ))}
            </ul>
            {viewers.length === 0 && <Empty>ยังไม่ได้แชร์ให้ใคร</Empty>}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
