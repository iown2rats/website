"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { refreshChats } from "@/actions/messaging";
import { chatTime } from "@/lib/chat-time";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";
import { ChatIcon, HeartIcon, SearchIcon, VerifiedBadge } from "@/components/ui/icons";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SectionLabel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Scroller } from "@/components/ui/scroller";
import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import type { ChatsListDto, ConversationListItemDto } from "@/server/conversations/list";

/*
 * Prototype Chats list: 26/800 title, 48 px surface-muted search "Search matches", "NEW MATCHES" label + 64 px
 * ringed avatars with 12 px names in a horizontal row, then 52 px avatar rows (name 16/700 + 14 px seal, preview
 * 14 px secondary, "You: " prefix; time 12 px; 20 px primary unread pill). Polled every 10 s while visible; the
 * list itself never marks anything read.
 */
const LIST_POLL_MS = 10_000;

export function ChatsList({ initial, hasEverMatched }: { initial: ChatsListDto; hasEverMatched: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  // A server refresh (router.refresh after read/block/unmatch) hands in new initial data: adopt it.
  const [adopted, setAdopted] = useState(initial);
  if (initial !== adopted) {
    setAdopted(initial);
    setData(initial);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        const result = await refreshChats().catch(() => null);
        if (cancelled) return;
        if (result && result.ok) {
          setData(result);
          setError(false);
        }
      }
      timer = setTimeout(tick, LIST_POLL_MS);
    };
    timer = setTimeout(tick, LIST_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshChats().then((r) => { if (!cancelled && r && r.ok) setData(r); }); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const q = query.trim().toLowerCase();
  const conversations = useMemo(() => (q ? data.conversations.filter((c) => c.other.name.toLowerCase().includes(q)) : data.conversations), [data.conversations, q]);
  const newMatches = useMemo(() => (q ? data.newMatches.filter((c) => c.other.name.toLowerCase().includes(q)) : data.newMatches), [data.newMatches, q]);
  const activeId = pathname.startsWith("/chats/") ? pathname.split("/")[2] : null;
  const nothing = data.conversations.length === 0 && data.newMatches.length === 0;

  return (
    <AppScreen aria-label="Chats">
      <TabHeader title="Chats" />
      <div className="mb-3 mt-1.5">
        <Input leading={<SearchIcon size={16} />} placeholder="Search matches" aria-label="Search matches" value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-lg border-0 bg-surface-muted" />
      </div>
      <ScrollArea className="flex flex-col gap-3.5">
        {error ? <ErrorState title="Couldn't refresh chats" description="We'll keep trying in the background." onRetry={() => void refreshChats().then((r) => r?.ok && setData(r))} /> : null}
        {newMatches.length > 0 ? (
          <section>
            <SectionLabel className="mb-2">New matches</SectionLabel>
            <Scroller bleed="2px" className="gap-2.5 pb-1">
              {newMatches.map((m) => (
                <Link key={m.id} href={`/chats/${m.id}`} className="flex w-15 shrink-0 flex-col items-center gap-1 text-micro text-text" aria-label={`Open chat with ${m.other.name}`}>
                  <Avatar name={m.other.name} photo={{ url: m.other.photo?.url ?? null, key: m.other.photo?.demoKey ?? null, blurhash: m.other.photo?.blurhash ?? null }} size={56} ring />
                  <span className="max-w-full truncate">{m.other.name}</span>
                </Link>
              ))}
            </Scroller>
          </section>
        ) : null}
        {conversations.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {conversations.map((c) => <ConversationRow key={c.id} item={c} active={c.id === activeId} now={data.serverNow} />)}
          </ul>
        ) : null}
        {nothing ? (
          hasEverMatched ? (
            <EmptyState icon={<ChatIcon />} title="No active chats." description="When you match with someone new, they'll appear here." actions={<Button size="sm" onClick={() => router.push("/discover")}>Keep discovering</Button>} />
          ) : (
            <EmptyState icon={<ChatIcon />} title="Match with someone to start a conversation." />
          )
        ) : null}
        {!nothing && conversations.length === 0 && newMatches.length > 0 && !q ? (
          <EmptyState icon={<HeartIcon />} title="Say hello to a new match." description="Tap a match above to start the conversation." className="py-3.5" />
        ) : null}
        {!nothing && q && conversations.length === 0 && newMatches.length === 0 ? <p className="px-2 text-body-sm text-text-secondary">No matches called “{query.trim()}”.</p> : null}
      </ScrollArea>
    </AppScreen>
  );
}

function ConversationRow({ item, active, now }: { item: ConversationListItemDto; active: boolean; now: string }) {
  const unread = item.unreadCount > 0;
  return (
    <li>
      <Link
        href={`/chats/${item.id}`}
        aria-current={active ? "page" : undefined}
        className={cn("flex items-center gap-3 rounded-2xl px-1.5 py-2 text-left text-text transition-colors hover:bg-surface-muted", active && "bg-surface-muted")}
      >
        <Avatar name={item.other.name} photo={{ url: item.other.photo?.url ?? null, key: item.other.photo?.demoKey ?? null, blurhash: item.other.photo?.blurhash ?? null }} size={44} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.25">
          <span className="flex items-center gap-1.25 text-body font-medium">
            <span className="truncate">{item.other.name}</span>
            {item.other.verified ? <VerifiedBadge size={13} className="shrink-0" /> : null}
          </span>
          <span className={cn("truncate text-caption", unread ? "font-medium text-text" : "text-text-secondary")}>
            {item.lastMessage?.fromMe ? "You: " : ""}{item.lastMessage?.preview}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 text-micro text-text-secondary">
          <span>{item.lastMessage ? chatTime(item.lastMessage.at, new Date(now)) : ""}</span>
          <span className={cn("grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1.5 text-tiny font-medium text-on-primary", !unread && "opacity-0")} aria-label={unread ? `${item.unreadCount} unread` : undefined}>
            {item.unreadCount}
          </span>
        </span>
      </Link>
    </li>
  );
}
