"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { blockChatPartner, editChatMessage, loadMatchProfile, loadMessageReactors, loadOlderMessages, markChatRead, pollChatMessages, reactToChatMessage, reportChatPartner, sendChatMessage, unmatchChat, type MessagingFailure } from "@/actions/messaging";
import { REPORT_REASON_LABELS } from "@/constants/labels";
import { MESSAGE_LIMITS } from "@/config/product";
import { bubbleTime } from "@/lib/chat-time";
import { cn } from "@/lib/cn";
import type { ReactionKey } from "@/lib/reactions";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ActionSheet, BottomSheet, ConfirmationDialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeftIcon, LockIcon, MoreIcon, VerifiedBadge } from "@/components/ui/icons";
import { useLongPress, useSwipeToReply } from "@/components/ui/long-press";
import { ReactionPicker, ReactionSummary, ReactorSheet, type ReactorRow } from "@/components/ui/reactions";
import { useToast } from "@/components/ui/toast";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { toDeckCard, type DeckCard } from "@/components/features/discovery/types";
import { useServerClock } from "@/components/features/discovery/use-server-clock";
import type { ConversationHeaderDto } from "@/server/conversations/list";
import type { MessageDto, MessagePageDto } from "@/server/conversations/messages";

/*
 * MESSAGE INTERACTIONS (docs/ARCHITECTURE.md §9.4).
 *
 * Long-press a bubble and a sheet offers Reply, React and — on your own messages only — Edit. The offer is a
 * convenience; the server decides. `editChatMessage` matches `{ id, senderId }` together, so a client that showed
 * Edit on somebody else's bubble would simply be refused.
 *
 * Desktop gets the same menu from a ⋯ that appears on hover, because long-press on a mouse means "select text"
 * and taking that away would be a worse trade than an extra affordance. `useLongPress` ignores mouse input
 * entirely for the same reason.
 *
 * A reaction or an edit changes a message the OTHER person is already looking at, which the incremental poll
 * ("everything after id X") can never deliver. The conversation carries an `interactionAt` watermark instead: it
 * travels out with every poll and back on the next one, and only a watermark that has moved costs the server a
 * second query. `updates` is how those changed messages come back.
 */

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

type Pending = { clientId: string; body: string; at: string; state: "sending" | "failed"; error?: string; replyTo: MessageDto | null };

/** What the long-press sheet is currently open for, plus where the finger was (the picker is placed there). */
type BubbleTarget = { message: MessageDto; point: { x: number; y: number } };
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
  // When the other person last read this chat, or null when either of you has receipts off (docs/ARCHITECTURE.md §12.12).
  const [otherReadAt, setOtherReadAt] = useState<string | null>(initialPage.readState?.otherReadAt ?? null);
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
  // Long-press state. `bubble` drives the sheet, `picker` the floating emoji row, `replyTo` the composer preview,
  // and `editing` swaps the composer into edit mode without creating a second message.
  const [bubble, setBubble] = useState<BubbleTarget | null>(null);
  const [picker, setPicker] = useState<BubbleTarget | null>(null);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [editing, setEditing] = useState<MessageDto | null>(null);
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);
  const [reactors, setReactors] = useState<ReactorRow[]>([]);
  const [reactorsLoading, setReactorsLoading] = useState(false);
  // The watermark. A ref, not state: it is read inside the poll loop and must never restart it.
  const interactionAt = useRef<string | null>(initialPage.interactionAt ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());
  const [flash, setFlash] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const reportTitleId = useId();

  const closed = header.status !== "ACTIVE";

  /*
   * The last of my messages they have read. Receipts are per-conversation, not per-message: the server reports one
   * timestamp, so a message counts as read when it was sent before it. Labelling only the newest such message keeps
   * the column quiet — the ones above it are implied, exactly as they are in every chat app.
   */
  const lastSeenOutgoingId = (() => {
    if (!otherReadAt) return null;
    const readAt = Date.parse(otherReadAt);
    if (Number.isNaN(readAt)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.fromMe && m.kind !== "SYSTEM" && Date.parse(m.at) <= readAt) return m.id;
    }
    return null;
  })();
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
        const result = await pollChatMessages({ conversationId: header.id, afterId: latest, sinceInteractionAt: interactionAt.current }).catch(() => null);
        if (cancelled) return;
        if (result && result.ok) {
          sync(result.serverNow);
          setOtherReadAt(result.readState?.otherReadAt ?? null);
          interactionAt.current = result.interactionAt;
          // Reactions and edits on messages already on screen. Merged in place so nothing moves and the scroll
          // position is untouched — a reaction appearing must not jump the thread under the reader's thumb.
          if (result.updates.length) {
            const byId = new Map(result.updates.map((m) => [m.id, m]));
            setMessages((prev) => prev.map((m) => byId.get(m.id) ?? m));
          }
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

  const send = async (text: string, existingClientId?: string, replyOverride?: MessageDto | null) => {
    const body = text.trim();
    if (!body || sending || closed) return;
    const clientId = existingClientId ?? crypto.randomUUID();
    const quoted = replyOverride !== undefined ? replyOverride : replyTo;
    setSending(true);
    setDraft("");
    setReplyTo(null);
    stickToBottom.current = true;
    setPending((p) => [...p.filter((x) => x.clientId !== clientId), { clientId, body, at: new Date(serverTime()).toISOString(), state: "sending", replyTo: quoted }]);
    const result = await sendChatMessage({ conversationId: header.id, body, replyToMessageId: quoted?.id ?? null }).catch((): MessagingFailure => ({ ok: false, code: "ERROR", message: "Couldn't reach Mellocrush. Try again.", serverNow: new Date().toISOString() }));
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
    if (e.key === "Escape" && (replyTo || editing)) {
      e.preventDefault();
      cancelCompose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitComposer();
    }
  };

  /** Leaves edit or reply mode and puts the composer back the way it was. */
  const cancelCompose = () => {
    setEditing(null);
    setReplyTo(null);
    setDraft("");
  };

  /** One entry point for the send button and the Enter key, because the composer now has two jobs. */
  const submitComposer = async () => {
    if (editing) return saveEdit();
    return send(draft);
  };

  /**
   * Saves an edit. One row is rewritten, so nothing is appended to the thread: the bubble already on screen is
   * replaced by the server's version of itself, which is also what carries the "Edited" marker.
   */
  const saveEdit = async () => {
    const target = editing;
    const body = draft.trim();
    if (!target || !body || sending) return;
    setSending(true);
    const result = await editChatMessage({ messageId: target.id, body }).catch((): MessagingFailure => ({ ok: false, code: "ERROR", message: "Couldn't reach Mellocrush. Try again.", serverNow: new Date().toISOString() }));
    setSending(false);
    if (!result.ok) {
      toast.show(result.message);
      return;
    }
    const saved = result.message;
    setMessages((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
    cancelCompose();
  };

  /**
   * Sets or clears my reaction. Optimistic, then reconciled with the server's own count — the server is the only
   * thing that knows what the other person has done in the meantime.
   */
  const react = async (message: MessageDto, emoji: ReactionKey | null) => {
    setPicker(null);
    setBubble(null);
    const result = await reactToChatMessage({ messageId: message.id, emoji }).catch(() => null);
    if (!result || !result.ok) {
      toast.show(result?.message ?? "Couldn't reach Mellocrush. Try again.");
      return;
    }
    // Our own change is already accounted for, so the watermark advances here too: without this the very next
    // poll would see a moved watermark and re-send the window for a change we made ourselves.
    interactionAt.current = result.interactionAt;
    setMessages((prev) => prev.map((m) => (m.id === result.messageId ? { ...m, reactions: result.reactions } : m)));
  };

  /** Scrolls to a quoted message and flashes it, or says so when it is no longer there. */
  const jumpToQuoted = (id: string) => {
    const el = bubbleRefs.current.get(id);
    if (!el) {
      // It exists, but this client has not paged back far enough to be holding it.
      toast.show("That message is further up. Load earlier messages to see it.");
      return;
    }
    stickToBottom.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200);
  };

  const openReactors = async (message: MessageDto) => {
    setBubble(null);
    setReactorsFor(message.id);
    setReactors([]);
    setReactorsLoading(true);
    const result = await loadMessageReactors({ messageId: message.id }).catch(() => null);
    setReactorsLoading(false);
    if (result && result.ok) setReactors(result.reactors.map((r) => ({ emoji: r.emoji, name: r.name, isMe: r.isMe })));
  };

  const beginEdit = (message: MessageDto) => {
    setBubble(null);
    setReplyTo(null);
    setEditing(message);
    setDraft(message.body);
    // After the value lands, so the caret goes to the end rather than the start.
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const beginReply = (message: MessageDto) => {
    setBubble(null);
    setEditing(null);
    setDraft("");
    setReplyTo(message);
    requestAnimationFrame(() => textarea.current?.focus());
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
        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            now={serverTime}
            seen={m.id === lastSeenOutgoingId}
            otherName={header.other.name}
            flash={flash === m.id}
            editingNow={editing?.id === m.id}
            registerRef={(el) => { if (el) bubbleRefs.current.set(m.id, el); else bubbleRefs.current.delete(m.id); }}
            onOpenMenu={(point) => { if (!closed) setBubble({ message: m, point }); }}
            onQuickReact={(emoji) => void react(m, emoji)}
            onInspectReactions={() => void openReactors(m)}
            onJumpToQuoted={jumpToQuoted}
            onReply={() => beginReply(m)}
            interactive={!closed}
          />
        ))}
        {pending.map((p) => (
          <div key={p.clientId} className="flex max-w-[78%] flex-col items-end self-end">
            <div className={cn("flex flex-col items-end rounded-[20px] rounded-br-[6px] bg-primary px-3.75 py-2.75", p.state === "sending" && "opacity-60")}>
              {p.replyTo ? <Quote quote={{ id: p.replyTo.id, fromMe: p.replyTo.fromMe, body: p.replyTo.body, available: true }} mine otherName={header.other.name} /> : null}
              <span className="self-stretch whitespace-pre-wrap break-words text-body leading-[1.45] text-on-primary">{p.body}</span>
            </div>
            {p.state === "failed" ? (
              // Retried with the quote it was sent with, not with whatever is in the composer now.
              <button type="button" onClick={() => void send(p.body, p.clientId, p.replyTo)} className="mx-1.5 mt-1 mb-1.5 border-0 bg-transparent text-tiny font-medium text-danger">
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
          {/*
            * One strip above the composer for both jobs. Compact on purpose: it says what will happen and how to
            * stop it, and nothing else. Cancellable before sending, which is the whole requirement — the ✕ is a
            * 44px target and Escape does the same thing from the keyboard.
            */}
          {editing || replyTo ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span aria-hidden="true" className={cn("h-8 w-0.75 shrink-0 rounded-full", editing ? "bg-ocean" : "bg-primary")} />
              <div className="min-w-0 flex-1">
                <div className={cn("text-micro font-medium", editing ? "text-ocean" : "text-primary-ink")}>
                  {editing ? "Editing message" : `Replying to ${replyTo!.fromMe ? "yourself" : header.other.name}`}
                </div>
                <div className="truncate text-caption text-text-secondary">{(editing ?? replyTo)!.body}</div>
              </div>
              <button
                type="button"
                onClick={cancelCompose}
                aria-label={editing ? "Stop editing" : "Cancel reply"}
                className="grid size-11 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text-secondary hover:bg-surface-muted"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => { e.preventDefault(); void submitComposer(); }}
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
              placeholder={editing ? "Edit message" : "Message"}
              rows={1}
              maxLength={MESSAGE_LIMITS.maxLength}
              enterKeyHint="send"
              className="max-h-30 min-h-11 flex-1 resize-none rounded-[22px] bg-surface-muted px-4 py-2.75 text-field leading-[1.4] text-text outline-none placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary field-sizing-content"
            />
            <button type="submit" aria-label={editing ? "Save edit" : "Send"} disabled={!canSend} className="grid size-11 shrink-0 place-items-center rounded-full border-0 bg-primary text-on-primary pressable-round disabled:opacity-45">
              {editing ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              )}
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

      {/*
        * The long-press menu. Edit is offered on your own messages only — a convenience, not the security
        * boundary: the server matches the message id and the sender id together, so the option's absence here and
        * its refusal there are two independent statements of the same rule.
        */}
      <ActionSheet
        open={bubble !== null}
        onClose={() => setBubble(null)}
        label="Message options"
        items={
          bubble
            ? [
                { label: "Reply", onSelect: () => beginReply(bubble.message) },
                { label: "React", onSelect: () => setPicker({ ...bubble, point: bubble.point }) },
                ...(bubble.message.fromMe ? [{ label: "Edit", onSelect: () => beginEdit(bubble.message) }] : []),
                ...(bubble.message.reactions.total > 0 ? [{ label: "See who reacted", onSelect: () => void openReactors(bubble.message) }] : []),
              ]
            : []
        }
      />

      <ReactionPicker
        at={picker?.point ?? null}
        current={picker?.message.reactions.mine ?? null}
        onPick={(emoji) => { if (picker) void react(picker.message, emoji); }}
        onClose={() => setPicker(null)}
        label={picker?.message.fromMe ? "React to your message" : `React to ${header.other.name}'s message`}
      />

      <ReactorSheet open={reactorsFor !== null} onClose={() => setReactorsFor(null)} rows={reactors} loading={reactorsLoading} />

      {profile ? <FullProfile profile={profile} onClose={() => setProfile(null)} /> : null}
    </div>
  );
}

/**
 * The compact quote above a reply's own text.
 *
 * Deliberately one line. A quote is a pointer to something the reader can reach, and a tall excerpt of a long
 * message would make the reply harder to read than the thing it is replying to. Tapping it scrolls to the
 * original; when the original is gone it says so and stops being a button, because there is nowhere to go.
 */
function Quote({ quote, mine, otherName, onJump }: { quote: NonNullable<MessageDto["replyTo"]>; mine: boolean; otherName: string; onJump?: (id: string) => void }) {
  const who = quote.available ? (quote.fromMe ? "You" : otherName) : null;
  const body = (
    <>
      {who ? <span className={cn("block text-micro font-medium", mine ? "text-on-primary/85" : "text-primary-ink")}>{who}</span> : null}
      <span className={cn("block truncate text-caption", mine ? "text-on-primary/75" : "text-text-secondary")}>
        {quote.available ? quote.body : "Message unavailable"}
      </span>
    </>
  );
  const frame = cn(
    "mb-1.5 flex w-full items-stretch gap-1.5 self-stretch rounded-md border-l-2 px-1.5 py-1 text-left",
    mine ? "border-on-primary/45 bg-on-primary/12" : "border-primary/55 bg-surface/55",
  );
  if (!quote.available || !onJump) {
    return <span className={frame}><span className="min-w-0 flex-1">{body}</span></span>;
  }
  return (
    <button type="button" onClick={() => onJump(quote.id)} className={cn(frame, "border-0 border-l-2 bg-transparent", mine ? "bg-on-primary/12" : "bg-surface/55")} aria-label={`Go to the message from ${who}`}>
      <span className="min-w-0 flex-1">{body}</span>
    </button>
  );
}

interface BubbleProps {
  message: MessageDto;
  now: () => number;
  seen?: boolean;
  otherName: string;
  /** Briefly highlighted after somebody tapped a quote pointing at it. */
  flash: boolean;
  /** This bubble's body is currently loaded into the composer. */
  editingNow: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  onOpenMenu: (point: { x: number; y: number }) => void;
  onQuickReact: (emoji: ReactionKey | null) => void;
  onInspectReactions: () => void;
  onJumpToQuoted: (id: string) => void;
  onReply: () => void;
  /** False in a closed conversation: history stays readable and nothing in it can be changed. */
  interactive: boolean;
}

function Bubble({ message, now, seen = false, otherName, flash, editingNow, registerRef, onOpenMenu, onQuickReact, onInspectReactions, onJumpToQuoted, onReply, interactive }: BubbleProps) {
  const longPress = useLongPress((point) => onOpenMenu(point));
  const swipe = useSwipeToReply(onReply, interactive);

  if (message.kind === "SYSTEM") {
    return <div className="my-1 self-center rounded-full bg-surface-muted px-3.5 py-1.5 text-center text-micro text-text-secondary">{message.body}</div>;
  }
  const me = message.fromMe;
  return (
    <div ref={registerRef} className={cn("group flex max-w-[78%] flex-col", me ? "items-end self-end" : "items-start self-start")}>
      <div className={cn("relative flex items-center gap-1", me ? "flex-row" : "flex-row-reverse")}>
        {/* Only drawn mid-swipe, so it costs a quiet thread nothing. */}
        {swipe.swiping ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-primary" style={{ opacity: Math.min(1, swipe.offset / 44) }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>
          </span>
        ) : null}
        {/*
          * Desktop's way in. Hidden until the row is hovered or this button itself is focused, so it is there for
          * a mouse and for the keyboard (Tab reaches it) without putting a permanent control beside every message.
          * Long-press ignores mouse input, which is why this exists at all.
          */}
        {interactive ? (
          <button
            type="button"
            onClick={(e) => onOpenMenu({ x: e.clientX, y: e.clientY })}
            aria-label="Message options"
            className="hidden size-8 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text-muted opacity-0 hover:bg-surface-muted focus-visible:opacity-100 group-hover:opacity-100 desktop:grid"
          >
            <MoreIcon size={15} />
          </button>
        ) : null}
        <div
          {...(interactive ? longPress : {})}
          {...(interactive ? swipe.handlers : {})}
          // Follows the finger only while a horizontal swipe is actually in progress; released without committing,
          // the transition below carries it back. No transition DURING the drag, or it would lag behind the finger.
          style={swipe.offset > 0 ? { transform: `translateX(${swipe.offset}px)` } : undefined}
          className={cn(
            // User text is rendered as text: React escapes it and white-space keeps the author's line breaks.
            // `select-none` only below the desktop breakpoint: a long-press on a phone is the menu gesture, while
            // a mouse keeps full selection and drag-select exactly as before.
            "flex min-w-0 flex-col whitespace-pre-wrap break-words rounded-[20px] px-3.75 py-2.75 text-body leading-[1.45] select-none desktop:select-text",
            me ? "items-end rounded-br-[6px] bg-primary text-on-primary" : "items-start rounded-bl-[6px] bg-aqua-soft text-text",
            flash && "ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow",
            editingNow && "opacity-60",
            swipe.offset === 0 && "transition-transform duration-150",
          )}
        >
          {message.replyTo ? <Quote quote={message.replyTo} mine={me} otherName={otherName} onJump={onJumpToQuoted} /> : null}
          <span className="self-stretch">{message.body}</span>
        </div>
      </div>

      <ReactionSummary
        reactions={message.reactions}
        onToggle={interactive ? onQuickReact : undefined}
        onInspect={message.reactions.total > 0 ? onInspectReactions : undefined}
        label={me ? "Reactions on your message" : `Reactions on ${otherName}'s message`}
        className={cn("-mt-1 mb-0.5", me ? "mr-1.5 justify-end" : "ml-1.5")}
      />

      <div className={cn("mx-1.5 mt-0.5 mb-1.5 text-tiny text-text-secondary", me ? "text-right" : "text-left")}>
        {bubbleTime(message.at, new Date(now()))}
        {/* Subtle and beside the metadata, as asked: the time already sits here, so "Edited" reads as part of it. */}
        {message.editedAt ? <span className="ml-1.5">Edited</span> : null}
        {seen ? <span className="ml-1.5 font-medium text-primary-ink">Seen</span> : null}
      </div>
    </div>
  );
}
