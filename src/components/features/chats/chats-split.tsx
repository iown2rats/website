"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Prototype Chats layout: on phones the list and the conversation are separate screens; on desktop (≥ 900 px)
 * the list is a 360 px master pane with a right border and the conversation (or "Select a conversation") is the detail.
 */
export function ChatsSplit({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const inConversation = /^\/chats\/[^/]+/.test(pathname);
  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col desktop:max-w-90 desktop:flex-none desktop:border-r desktop:border-border", inConversation && "hidden desktop:flex")}>{list}</div>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !inConversation && "hidden desktop:flex")}>{children}</div>
    </div>
  );
}
