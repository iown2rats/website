"use server";

import { z } from "zod";
import { MESSAGE_LIMITS } from "@/config/product";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { listConversations, type ChatsListDto } from "@/server/conversations/list";
import { getConversationForActor, listMessages, markConversationRead, pollConversation, sendMessage, type MessageDto, type MessagePageDto, type PollDto } from "@/server/conversations/messages";
import { getMatchProfile } from "@/server/conversations/profile";
import { unmatchConversation } from "@/server/conversations/unmatch";
import { kickMessageEmailSweep } from "@/server/notifications/message-email";
import type { DiscoveryCardDto } from "@/server/discovery/dto";
import { blockUser } from "@/server/safety/block";
import { reportConversationPartner } from "@/server/safety/report";

/*
 * Messaging server actions (Phase 7). The sender is always the session user; payloads carry a conversation id
 * (authorised as a participant on every call), never a userId. Domain errors become typed results so the client
 * can reconcile optimistic messages precisely. Server actions are cookie-scoped POSTs and are never cached.
 */

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const sendSchema = z.object({ conversationId: idSchema, body: z.string().min(1).max(MESSAGE_LIMITS.maxLength * 2) });
const pageSchema = z.object({ conversationId: idSchema, cursor: idSchema.optional().nullable() });
const pollSchema = z.object({ conversationId: idSchema, afterId: idSchema.optional().nullable() });
const convSchema = z.object({ conversationId: idSchema });

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
    const sent = await sendMessage(actor, parsed.conversationId, parsed.body);
    /*
     * Ordinary traffic is the scheduler. Messaging is the busiest authenticated path in the app, so hanging the
     * sweep off it keeps unread-message mail moving without a cron — and its own global one-per-minute gate means
     * a busy hour costs one sweep per minute, not one per message. It is never awaited: the mailer must not be
     * able to slow down or fail a send. /api/cron/message-emails exists for when a real scheduler is attached.
     */
    kickMessageEmailSweep();
    return { ok: true, message: { id: sent.id, fromMe: true, kind: "TEXT", body: sent.body, at: sent.createdAt.toISOString() }, serverNow: new Date().toISOString() };
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
    return { ok: true, ...(await pollConversation(actor, parsed.conversationId, { afterId: parsed.afterId ?? null })) };
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
