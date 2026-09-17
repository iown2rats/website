/**
 * Reports (docs/ARCHITECTURE.md §10). Stores reporter, target, reason, optional note and a snapshot of the
 * conversation's recent messages as evidence, then blocks the reported user (the prototype's explicit
 * "They've been blocked" outcome, stated in the confirmation UX). Reports never delete anything and are
 * anonymous to the reported user.
 */
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getConversationForActor } from "@/server/conversations/messages";
import { blockUser } from "./block";

export const REPORT_REASONS = ["FAKE_PROFILE", "UNDERAGE_USER", "HARASSMENT", "INAPPROPRIATE_CONTENT", "SCAM_OR_FINANCIAL_REQUEST", "IMPERSONATION", "SPAM", "OTHER"] as const;

export const reportSchema = z.object({
  conversationId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).regex(/^[^<>]*$/, "Notes can't contain < or >").optional().or(z.literal("")),
});

export interface ReportResult {
  reportId: string;
}

/** Reports the other participant of a conversation and blocks them. Evidence: the latest 50 messages, snapshotted. */
export async function reportConversationPartner(actor: Actor, input: unknown, options: { now?: Date; db?: Db } = {}): Promise<ReportResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "That report isn't valid");
  const { conversationId, reason, note } = parsed.data;

  // Authorises the actor (participant, not blocked) and resolves the target from the conversation, never from the client.
  const conversation = await getConversationForActor(db, actor, conversationId).catch(() => null);
  if (!conversation) throw new NotFoundError("Conversation");
  const recent = await db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, senderId: true, kind: true, body: true, createdAt: true },
  });
  const report = await db.report.create({
    data: {
      reporterId: actor.userId,
      targetUserId: conversation.otherUserId,
      reason,
      note: note ? note : null,
      snapshot: { conversationId, messages: recent.map((m) => ({ id: m.id, from: m.senderId === actor.userId ? "reporter" : "target", kind: m.kind, body: m.body, at: m.createdAt.toISOString() })) },
      createdAt: now,
    },
    select: { id: true },
  });
  await blockUser(actor, conversation.otherUserId, { db, now, source: "REPORT" });
  return { reportId: report.id };
}
