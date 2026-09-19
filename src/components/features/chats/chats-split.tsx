"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Chats layout: on phones the list and the conversation are separate screens; from 900 px the list is a master pane
 * with a right border and the conversation is the detail. At the desktop tier the list is a fixed 352 px and the
 * conversation takes everything else in the content group, which is the proportion a desktop messenger wants —
 * the thread is the subject, the list is navigation.
 */
export function ChatsSplit({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const inConversation = /^\/chats\/[^/]+/.test(pathname);
  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col desktop:max-w-90 desktop:flex-none desktop:border-r desktop:border-border wide:w-[var(--chat-list-wide)] wide:max-w-none", inConversation && "hidden desktop:flex")}>{list}</div>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !inConversation && "hidden desktop:flex")}>{children}</div>
    </div>
  );
}
