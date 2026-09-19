"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { blockChatPartner, loadMatchProfile, loadOlderMessages, markChatRead, pollChatMessages, reportChatPartner, sendChatMessage, unmatchChat, type MessagingFailure } from "@/actions/messaging";
import { REPORT_REASON_LABELS } from "@/constants/labels";
import { MESSAGE_LIMITS } from "@/config/product";
import { bubbleTime } from "@/lib/chat-time";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ActionSheet, BottomSheet, ConfirmationDialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeftIcon, LockIcon, MoreIcon, VerifiedBadge } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { toDeckCard, type DeckCard } from "@/components/features/discovery/types";
import { useServerClock } from "@/components/features/discovery/use-server-clock";
import type { ConversationHeaderDto } from "@/server/conversations/list";
import type { MessageDto, MessagePageDto } from "@/server/conversations/messages";

/*
 * Prototype conversation screen: glass header (56 + safe-top) with 44 px back (phone), 40 px avatar, 16/700 name +
 * 14 px seal, 12 px location, ··· options; scrolling thread (20 px 16 px, 6 px gap) with a centred "You matched
 * with {name}. Say hello." pill, bubbles max 78 % (me: primary + ocean text, tail bottom-right 6 px; them: aqua-soft,
 * tail bottom-left), 15 px/1.45, 11 px time; composer row (10 px 12 px + safe-bottom): 44 px rounded input, 44 px
 * primary send. The prototype's "Add photo" button is omitted — image messaging is not in scope.
 *
 * Data: newest page from the server, older pages on scroll-up (scroll position preserved), incremental polling
 * every 4 s while visible (paused when hidden/offline).
 *
 * Messaging a match is unlimited on every tier, so the composer has no countdown, no disabled state waiting on a
 * timer and no upsell: Send is enabled whenever there is text and the conversation is open. The only things that
 * close it are the conversation ending, being blocked or being unmatched, which the server decides.
 */
export interface ConversationProps {
  header: ConversationHeaderDto;
  initialPage: MessagePageDto;
  serverNow: string;
}

type Pending = { clientId: string; body: string; at: string; state: "sending" | "failed"; error?: string };
const POLL_MS = 4000;
const REASONS = Object.entries(REPORT_REASON_LABELS) as [keyof typeof REPORT_REASON_LABELS, string][];

export function Conversation({ header: initialHeader, initialPage, serverNow }: ConversationProps) {
  const router = useRouter();
  const toast = useToast();
  const { sync, serverTime } = useServerClock(serverNow);
  const [header, setHeader] = useState(initialHeader);
  // Oldest → newest for rendering.
  const [messages, setMessages] = useState<MessageDto[]>(() => [...initialPage.messages].reverse());
  const [olderCursor, setOlderCursor] = useState<string | null>(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [reportStep, setReportStep] = useState<null | "reason" | "done">(null);
  const [reportReason, setReportReason] = useState<keyof typeof REPORT_REASON_LABELS | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "block" | "unmatch">(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [profile, setProfile] = useState<DeckCard | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const reportTitleId = useId();

  const closed = header.status !== "ACTIVE";
  const newestId = messages.length ? messages[messages.length - 1]!.id : null;

  // Mark read when the conversation is on screen (initially and whenever new incoming messages arrive while visible).
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    void markChatRead({ conversationId: header.id }).then((r) => { if (r.ok && r.unreadCleared) router.refresh(); });
  }, [header.id, router]);
  useEffect(() => { markRead(); }, [markRead]);

  // Incremental polling, paused while hidden or offline.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let latest = newestId;
    const poll = async () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        const result = await pollChatMessages({ conversationId: header.id, afterId: latest }).catch(() => null);
        if (cancelled) return;
        if (result && result.ok) {
          sync(result.serverNow);
          if (result.status !== header.status) setHeader((h) => ({ ...h, status: result.status, canUnmatch: false }));
          if (result.messages.length) {
            latest = result.messages[result.messages.length - 1]!.id;
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              return [...prev, ...result.messages.filter((m) => !seen.has(m.id))];
            });
            if (result.messages.some((m) => !m.fromMe)) markRead();
          }
        } else if (result && !result.ok && result.code === "NOT_FOUND") {
          router.replace("/chats");
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // `newestId` intentionally not a dependency: `latest` advances locally so sends don't restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.id, header.status, sync, router, markRead]);

  // Scrolling: stick to the bottom for new messages; preserve position when older messages are prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependAnchor.current) {
      el.scrollTop = el.scrollHeight - prependAnchor.current.height + prependAnchor.current.top;
      prependAnchor.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && olderCursor && !loadingOlder) void loadOlder();
  };

  const loadOlder = async () => {
    const el = scroller.current;
    if (!olderCursor || !el) return;
    setLoadingOlder(true);
    const result = await loadOlderMessages({ conversationId: header.id, cursor: olderCursor }).catch(() => null);
    setLoadingOlder(false);
    if (!result || !result.ok) return;
    prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    setOlderCursor(result.nextCursor);
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...[...result.messages].reverse().filter((m) => !seen.has(m.id)), ...prev];
    });
  };

  const send = async (text: string, existingClientId?: string) => {
    const body = text.trim();
    if (!body || sending || closed) return;
    const clientId = existingClientId ?? crypto.randomUUID();
    setSending(true);
    setDraft("");
    stickToBottom.current = true;
    setPending((p) => [...p.filter((x) => x.clientId !== clientId), { clientId, body, at: new Date(serverTime()).toISOString(), state: "sending" }]);
    const result = await sendChatMessage({ conversationId: header.id, body }).catch((): MessagingFailure => ({ ok: false, code: "ERROR", message: "Couldn't reach Mellocrush. Try again.", serverNow: new Date().toISOString() }));
    setSending(false);
    if (result.ok) {
      sync(result.serverNow);
      setPending((p) => p.filter((x) => x.clientId !== clientId));
      setMessages((prev) => (prev.some((m) => m.id === result.message.id) ? prev : [...prev, result.message]));
      return;
    }
    sync(result.serverNow);
    if (result.code === "CLOSED" || result.code === "NOT_FOUND") {
      setPending((p) => p.filter((x) => x.clientId !== clientId));
      setHeader((h) => ({ ...h, status: "LOCKED", canUnmatch: false }));
      toast.show(result.message);
      return;
    }
    setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, state: "failed", error: result.message } : x)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const openProfile = async () => {
    const result = await loadMatchProfile({ conversationId: header.id }).catch(() => null);
    if (result && result.ok && result.profile) setProfile(toDeckCard(result.profile));
    else toast.show("That profile isn't available right now.");
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    const result = confirm === "block" ? await blockChatPartner({ conversationId: header.id }) : await unmatchChat({ conversationId: header.id });
    setConfirmBusy(false);
    setConfirm(null);
    if (!result.ok) { toast.show(result.message); return; }
    toast.show(confirm === "block" ? "Blocked. They can no longer see or contact you." : "Unmatched.");
    router.replace("/chats");
    router.refresh();
  };

  const submitReport = async () => {
    if (!reportReason) return;
    setReportBusy(true);
    const result = await reportChatPartner({ conversationId: header.id, reason: reportReason });
    setReportBusy(false);
    if (!result.ok) { toast.show(result.message); return; }
    setReportStep("done");
  };

  const canType = !closed;
  const canSend = canType && draft.trim().length > 0 && !sending;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background animate-fade-in">
      <header className="flex shrink-0 items-center gap-2.5 glass px-1.5" style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
        <Link href="/chats" aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-md text-text hover:bg-surface-muted desktop:hidden">
          <ChevronLeftIcon size={22} strokeWidth={2.2} />
        </Link>
        <button type="button" onClick={() => void openProfile()} className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-1.5 text-left text-text" aria-label={`View ${header.other.name}'s profile`}>
          <Avatar name={header.other.name} photo={{ url: header.other.photo?.url ?? null, key: header.other.photo?.demoKey ?? null, blurhash: header.other.photo?.blurhash ?? null }} size={40} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.25 text-body-lg font-medium">
              <span className="truncate">{header.other.name}</span>
              {header.other.verified ? <VerifiedBadge size={14} className="shrink-0" /> : null}
            </span>
            {header.other.location ? <span className="block text-micro text-text-secondary">{header.other.location}</span> : null}
          </span>
        </button>
        <IconButton aria-label="Conversation options" variant="ghost" onClick={() => setOptionsOpen(true)}>
          <MoreIcon size={20} />
        </IconButton>
      </header>

      <div ref={scroller} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden px-4 py-3" aria-live="polite" aria-label="Messages">
        {olderCursor ? (
          <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mx-auto mb-2 h-9 rounded-full bg-surface-muted px-4 text-caption font-medium text-text-secondary">
            {loadingOlder ? "Loading…" : "Load earlier messages"}
          </button>
        ) : (
          <div className="mb-3 self-center rounded-full bg-surface-muted px-3.5 py-1.5 text-center text-micro text-text-secondary">You matched with {header.other.name}. Say hello.</div>
        )}
        {messages.map((m) => <Bubble key={m.id} message={m} now={serverTime} />)}
        {pending.map((p) => (
          <div key={p.clientId} className="flex max-w-[78%] flex-col items-end self-end">
            <div className={cn("whitespace-pre-wrap break-words rounded-[20px] rounded-br-[6px] bg-primary px-3.75 py-2.75 text-body leading-[1.45] text-on-primary", p.state === "sending" && "opacity-60")}>{p.body}</div>
            {p.state === "failed" ? (
              <button type="button" onClick={() => void send(p.body, p.clientId)} className="mx-1.5 mt-1 mb-1.5 border-0 bg-transparent text-tiny font-medium text-danger">
                {p.error ?? "Not sent"} · Tap to retry
              </button>
            ) : (
              <div className="mx-1.5 mt-1 mb-1.5 text-tiny text-text-secondary">Sending…</div>
            )}
          </div>
        ))}
        {closed ? <div className="mt-3 self-center rounded-full bg-surface-muted px-3.5 py-1.5 text-center text-micro text-text-secondary">This conversation has ended.</div> : null}
      </div>

      {closed ? (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-background px-4 pt-3.5 text-body-sm leading-snug text-text-secondary" style={{ paddingBottom: "calc(14px + var(--safe-bottom))" }}>
          <LockIcon size={18} className="shrink-0" />
          This conversation has ended. You can still read what was said.
        </div>
      ) : (
        <div className="shrink-0 border-t border-border bg-background">
          <form
            onSubmit={(e) => { e.preventDefault(); void send(draft); }}
            className="flex items-end gap-2 px-3 pt-2.5"
            style={{ paddingBottom: "calc(12px + var(--safe-bottom))" }}
          >
            <label htmlFor="composer" className="sr-only">Message</label>
            <textarea
              id="composer"
              ref={textarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_LIMITS.maxLength))}
              onKeyDown={onKeyDown}
              placeholder="Message"
              rows={1}
              maxLength={MESSAGE_LIMITS.maxLength}
              enterKeyHint="send"
              className="max-h-30 min-h-11 flex-1 resize-none rounded-[22px] bg-surface-muted px-4 py-2.75 text-field leading-[1.4] text-text outline-none placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary field-sizing-content"
            />
            <button type="submit" aria-label="Send" disabled={!canSend} className="grid size-11 shrink-0 place-items-center rounded-full border-0 bg-primary text-on-primary pressable-round disabled:opacity-45">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </form>
          {draft.length > MESSAGE_LIMITS.maxLength - 200 ? <p className="px-4 pb-2 text-right text-micro text-text-secondary tabular-nums">{draft.length}/{MESSAGE_LIMITS.maxLength}</p> : null}
        </div>
      )}

      <ActionSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        label="Conversation options"
        items={[
          { label: "Report", onSelect: () => { setOptionsOpen(false); setReportReason(null); setReportStep("reason"); } },
          { label: "Block", onSelect: () => { setOptionsOpen(false); setConfirm("block"); } },
          ...(header.canUnmatch ? [{ label: "Unmatch", tone: "danger" as const, onSelect: () => { setOptionsOpen(false); setConfirm("unmatch"); } }] : []),
        ]}
      />

      <ConfirmationDialog
        open={confirm === "block"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
        title={`Block ${header.other.name}?`}
        description="They won't be able to see your profile or message you, and this conversation will close for both of you. Your messages are kept for safety review."
        confirmLabel="Block"
        loading={confirmBusy}
      />
      <ConfirmationDialog
        open={confirm === "unmatch"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
        title={`Unmatch ${header.other.name}?`}
        description="This ends the match and closes the conversation for both of you. Neither of you can message here again."
        confirmLabel="Unmatch"
        confirmVariant="destructive"
        loading={confirmBusy}
      />

      <BottomSheet open={reportStep !== null} onClose={() => (reportBusy ? undefined : setReportStep(null))} labelledBy={reportTitleId} dismissible={!reportBusy}>
        {reportStep === "reason" ? (
          <>
            <DialogTitle id={reportTitleId}>Why are you reporting?</DialogTitle>
            <DialogDescription>Reports are anonymous. We&apos;ll review within 24 hours. Submitting also blocks {header.other.name}.</DialogDescription>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Reason">
              {REASONS.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={reportReason === value} onClick={() => setReportReason(value)} className={cn("h-11.5 rounded-lg px-3.5 text-left text-body font-medium text-text", reportReason === value ? "bg-primary-soft" : "bg-surface-muted")}>
                  {label}
                </button>
              ))}
            </div>
            <Button variant="ocean" onClick={() => void submitReport()} disabled={!reportReason} loading={reportBusy} fullWidth>Submit report and block</Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-aqua-soft text-primary-ink" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
              </span>
              <DialogTitle id={reportTitleId}>Thanks for looking out</DialogTitle>
              <p className="max-w-75 text-body-sm leading-normal text-text-secondary">They&apos;ve been blocked and won&apos;t see your profile. Our team will review the report.</p>
            </div>
            <Button onClick={() => { setReportStep(null); router.replace("/chats"); router.refresh(); }} fullWidth>Done</Button>
          </>
        )}
      </BottomSheet>

      {profile ? <FullProfile profile={profile} onClose={() => setProfile(null)} /> : null}
    </div>
  );
}

function Bubble({ message, now }: { message: MessageDto; now: () => number }) {
  if (message.kind === "SYSTEM") {
    return <div className="my-1 self-center rounded-full bg-surface-muted px-3.5 py-1.5 text-center text-micro text-text-secondary">{message.body}</div>;
  }
  const me = message.fromMe;
  return (
    <div className={cn("flex max-w-[78%] flex-col", me ? "items-end self-end" : "items-start self-start")}>
      {/* User text is rendered as text: React escapes it and white-space keeps the author's line breaks. */}
      <div className={cn("whitespace-pre-wrap break-words rounded-[20px] px-3.75 py-2.75 text-body leading-[1.45]", me ? "rounded-br-[6px] bg-primary text-on-primary" : "rounded-bl-[6px] bg-aqua-soft text-text")}>{message.body}</div>
      <div className="mx-1.5 mt-1 mb-1.5 text-tiny text-text-secondary">{bubbleTime(message.at, new Date(now()))}</div>
    </div>
  );
}
