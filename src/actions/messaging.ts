"use server";

import { z } from "zod";
import { MESSAGE_LIMITS } from "@/config/product";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { listConversations, type ChatsListDto } from "@/server/conversations/list";
import { editMessage, getConversationForActor, getMessageDto, listMessages, markConversationRead, pollConversation, sendMessage, type MessageDto, type MessagePageDto, type PollDto } from "@/server/conversations/messages";
import { listMessageReactors, setMessageReaction, type MessageReactionResult, type ReactorDto } from "@/server/conversations/reactions";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";
import { getMatchProfile } from "@/server/conversations/profile";
import { unmatchConversation } from "@/server/conversations/unmatch";
import { kickAwayRecipientEmail } from "@/server/notifications/message-email";
import { touchPresence } from "@/server/presence";
import type { DiscoveryCardDto } from "@/server/discovery/dto";
import { blockUser } from "@/server/safety/block";
import { reportConversationPartner } from "@/server/safety/report";

/*
 * Messaging server actions (Phase 7). The sender is always the session user; payloads carry a conversation id
 * (authorised as a participant on every call), never a userId. Domain errors become typed results so the client
 * can reconcile optimistic messages precisely. Server actions are cookie-scoped POSTs and are never cached.
 */

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const sendSchema = z.object({
  conversationId: idSchema,
  body: z.string().min(1).max(MESSAGE_LIMITS.maxLength * 2),
  /** Optional. The server decides whether this id may actually be replied to; this only shapes the request. */
  replyToMessageId: idSchema.optional().nullable(),
});
const pageSchema = z.object({ conversationId: idSchema, cursor: idSchema.optional().nullable() });
const pollSchema = z.object({
  conversationId: idSchema,
  afterId: idSchema.optional().nullable(),
  /** The watermark the client last saw. An ISO string it was handed by a previous poll, never interpreted here. */
  sinceInteractionAt: z.string().max(40).optional().nullable(),
});
const convSchema = z.object({ conversationId: idSchema });
const editSchema = z.object({ messageId: idSchema, body: z.string().min(1).max(MESSAGE_LIMITS.maxLength * 2) });
/*
 * The reaction set is validated HERE as well as in the domain and again by the database's own enum. The parse is
 * not the security boundary — it is the first of three, and the cheapest place to turn a malformed request into a
 * typed failure rather than an exception.
 */
const reactionKeys = REACTIONS.map((r) => r.key) as [ReactionKey, ...ReactionKey[]];
const reactSchema = z.object({ messageId: idSchema, emoji: z.enum(reactionKeys).nullable() });
const messageSchema = z.object({ messageId: idSchema });

export type MessagingFailure = {
  ok: false;
  code: "NOT_FOUND" | "RATE_LIMIT" | "CLOSED" | "VALIDATION" | "ERROR";
  message: string;
  serverNow: string;
};

function failure(e: unknown): MessagingFailure {
  const serverNow = new Date().toISOString();
  if (isDomainError(e)) {
    switch (e.code) {
      case "NOT_FOUND":
        return { ok: false, code: "NOT_FOUND", message: "This conversation isn't available.", serverNow };
      case "MESSAGE_RATE_LIMIT":
        return { ok: false, code: "RATE_LIMIT", message: "You're sending messages too quickly. Take a breath and try again.", serverNow };
      case "INVALID_STATE":
        return { ok: false, code: "CLOSED", message: "This conversation has ended.", serverNow };
      case "VALIDATION":
        return { ok: false, code: "VALIDATION", message: e.message, serverNow };
      default:
        break;
    }
  }
  console.error("[messaging] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't send that right now. Try again.", serverNow };
}

export async function sendChatMessage(input: unknown): Promise<{ ok: true; message: MessageDto; serverNow: string } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = sendSchema.parse(input);
    const sent = await sendMessage(actor, parsed.conversationId, parsed.body, { replyToMessageId: parsed.replyToMessageId ?? null });
    /*
     * If the recipient is not in the app, mail them now. Waiting to find out what is already known — that nobody
     * is there — only delays it. Never awaited: the mailer must not be able to slow down or fail a send.
     */
    const conversation = await getConversationForActor(getDb(), actor, parsed.conversationId);
    kickAwayRecipientEmail({ recipientId: conversation.otherUserId, conversationId: parsed.conversationId });
    // Read back through the same hydration every other bubble uses, so a reply arrives with its quote already
    // resolved. The sender cannot build that locally: a quote comes from the database, not from the request.
    const message = await getMessageDto(getDb(), actor.userId, parsed.conversationId, sent.id);
    return {
      ok: true,
      message: message ?? { id: sent.id, fromMe: true, kind: "TEXT", body: sent.body, at: sent.createdAt.toISOString(), replyTo: null, editedAt: null, reactions: { groups: [], total: 0, mine: null } },
      serverNow: new Date().toISOString(),
    };
  } catch (e) {
    return failure(e);
  }
}

export async function loadOlderMessages(input: unknown): Promise<({ ok: true } & MessagePageDto) | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = pageSchema.parse(input);
    return { ok: true, ...(await listMessages(actor, parsed.conversationId, { cursor: parsed.cursor ?? undefined })) };
  } catch (e) {
    return failure(e);
  }
}

export async function pollChatMessages(input: unknown): Promise<({ ok: true } & PollDto) | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = pollSchema.parse(input);
    /*
     * Sitting in a conversation is the one way to use the app without rendering a page: the screen polls every few
     * seconds instead. Without this, somebody reading one chat would go "away" after five minutes and be emailed
     * about a message in another — exactly what presence exists to prevent.
     */
    await touchPresence(getDb(), actor.userId);
    return { ok: true, ...(await pollConversation(actor, parsed.conversationId, { afterId: parsed.afterId ?? null, sinceInteractionAt: parsed.sinceInteractionAt ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

/** Called when the conversation is actually on screen (never from the list). */
export async function markChatRead(input: unknown): Promise<{ ok: true; unreadCleared: boolean } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const { conversationId } = convSchema.parse(input);
    return { ok: true, ...(await markConversationRead(actor, conversationId)) };
  } catch (e) {
    return failure(e);
  }
}

/** Edits one of the actor's own messages. Ownership is decided by the server; this only carries the request. */
export async function editChatMessage(input: unknown): Promise<{ ok: true; message: MessageDto; serverNow: string } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = editSchema.parse(input);
    const message = await editMessage(actor, parsed.messageId, parsed.body);
    return { ok: true, message, serverNow: new Date().toISOString() };
  } catch (e) {
    return failure(e);
  }
}

/** Sets, replaces or clears the actor's reaction to a message. `emoji: null` removes it. */
export async function reactToChatMessage(input: unknown): Promise<({ ok: true } & MessageReactionResult) | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = reactSchema.parse(input);
    return { ok: true, ...(await setMessageReaction(actor, parsed.messageId, parsed.emoji)) };
  } catch (e) {
    return failure(e);
  }
}

/** Who reacted to a message and with what — the list behind tapping a reaction summary. */
export async function loadMessageReactors(input: unknown): Promise<{ ok: true; reactors: ReactorDto[] } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const parsed = messageSchema.parse(input);
    return { ok: true, reactors: await listMessageReactors(actor, parsed.messageId) };
  } catch (e) {
    return failure(e);
  }
}

export async function refreshChats(): Promise<({ ok: true } & ChatsListDto) | MessagingFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, ...(await listConversations(actor)) };
  } catch (e) {
    return failure(e);
  }
}

export async function loadMatchProfile(input: unknown): Promise<{ ok: true; profile: DiscoveryCardDto | null } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const { conversationId } = convSchema.parse(input);
    return { ok: true, profile: await getMatchProfile(actor, conversationId) };
  } catch (e) {
    return failure(e);
  }
}

export async function unmatchChat(input: unknown): Promise<{ ok: true } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const { conversationId } = convSchema.parse(input);
    await unmatchConversation(actor, conversationId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Blocks the other participant of a conversation; the target is resolved server-side from the conversation. */
export async function blockChatPartner(input: unknown): Promise<{ ok: true } | MessagingFailure> {
  try {
    const actor = await requireMember();
    const { conversationId } = convSchema.parse(input);
    const conversation = await getConversationForActor(getDb(), actor, conversationId);
    await blockUser(actor, conversation.otherUserId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function reportChatPartner(input: unknown): Promise<{ ok: true } | MessagingFailure> {
  try {
    const actor = await requireMember();
    await reportConversationPartner(actor, input);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
