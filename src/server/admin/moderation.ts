/**
 * Moderation queue over the existing Report rows (docs/ARCHITECTURE.md §10, §21.5). Evidence is exactly what the
 * safety architecture already stores (reason, note, snapshot); nothing else about either person is pulled in.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { noMarkup } from "@/lib/validation/onboarding";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAudit } from "./audit";
import { assertPermission, type AdminActor } from "./authz";

export type ReportQueueFilter = "open" | "resolved" | "all";
export type ReportDecision = "UNDER_REVIEW" | "RESOLVED" | "DISMISSED";

const include = {
  reporter: { select: { id: true, profile: { select: { handle: true, displayName: true } } } },
  targetUser: { select: { id: true, status: true, profile: { select: { handle: true, displayName: true } } } },
  targetPost: { select: { id: true, body: true, deletedAt: true, author: { select: { id: true, profile: { select: { handle: true, displayName: true } } } } } },
  targetComment: { select: { id: true, body: true, deletedAt: true, author: { select: { id: true, profile: { select: { handle: true, displayName: true } } } } } },
  targetMessage: { select: { id: true, body: true, sender: { select: { id: true, profile: { select: { handle: true, displayName: true } } } } } },
  resolvedBy: { select: { profile: { select: { displayName: true } } } },
} as const;
type Row = Prisma.ReportGetPayload<{ include: typeof include }>;

export interface ReportRowDto {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter: { userId: string; handle: string | null; displayName: string | null };
  target: { kind: "user" | "post" | "comment" | "message"; userId: string | null; handle: string | null; displayName: string | null; accountStatus: string | null };
}

export interface ReportDetailDto extends ReportRowDto {
  note: string | null;
  snapshot: unknown;
  content: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  targetOpenReports: number;
}

function target(r: Row): ReportRowDto["target"] {
  if (r.targetUser) return { kind: "user", userId: r.targetUser.id, handle: r.targetUser.profile?.handle ?? null, displayName: r.targetUser.profile?.displayName ?? null, accountStatus: r.targetUser.status };
  if (r.targetPost) return { kind: "post", userId: r.targetPost.author.id, handle: r.targetPost.author.profile?.handle ?? null, displayName: r.targetPost.author.profile?.displayName ?? null, accountStatus: null };
  if (r.targetComment) return { kind: "comment", userId: r.targetComment.author.id, handle: r.targetComment.author.profile?.handle ?? null, displayName: r.targetComment.author.profile?.displayName ?? null, accountStatus: null };
  if (r.targetMessage) return { kind: "message", userId: r.targetMessage.sender.id, handle: r.targetMessage.sender.profile?.handle ?? null, displayName: r.targetMessage.sender.profile?.displayName ?? null, accountStatus: null };
  return { kind: "user", userId: null, handle: null, displayName: null, accountStatus: null };
}

function toRow(r: Row): ReportRowDto {
  return { id: r.id, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), reporter: { userId: r.reporter.id, handle: r.reporter.profile?.handle ?? null, displayName: r.reporter.profile?.displayName ?? null }, target: target(r) };
}

export async function listReports(admin: AdminActor, input: { filter: ReportQueueFilter; page?: number; pageSize?: number }, deps: { db?: Db } = {}): Promise<{ items: ReportRowDto[]; total: number; page: number; pageSize: number }> {
  assertPermission(admin, "reports.act");
  const db = deps.db ?? getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const where: Prisma.ReportWhereInput = input.filter === "open" ? { status: { in: ["OPEN", "UNDER_REVIEW"] } } : input.filter === "resolved" ? { status: { in: ["RESOLVED", "DISMISSED"] } } : {};
  const [rows, total] = await Promise.all([
    db.report.findMany({ where, include, orderBy: { createdAt: input.filter === "open" ? "asc" : "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.report.count({ where }),
  ]);
  return { items: rows.map(toRow), total, page, pageSize };
}

export async function getReportDetail(admin: AdminActor, reportId: string, deps: { db?: Db } = {}): Promise<ReportDetailDto> {
  assertPermission(admin, "reports.act");
  const db = deps.db ?? getDb();
  const r = await db.report.findUnique({ where: { id: reportId }, include });
  if (!r) throw new NotFoundError("Report");
  const t = target(r);
  const targetOpenReports = t.userId ? await db.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] }, OR: [{ targetUserId: t.userId }, { targetPost: { authorId: t.userId } }, { targetComment: { authorId: t.userId } }, { targetMessage: { senderId: t.userId } }] } }) : 0;
  const content = r.targetPost ? (r.targetPost.deletedAt ? "(post deleted by author)" : r.targetPost.body) : r.targetComment ? (r.targetComment.deletedAt ? "(comment deleted by author)" : r.targetComment.body) : r.targetMessage ? r.targetMessage.body : null;
  return { ...toRow(r), note: r.note, snapshot: r.snapshot ?? null, content, resolution: r.resolution, resolvedAt: r.resolvedAt?.toISOString() ?? null, resolvedBy: r.resolvedBy?.profile?.displayName ?? null, targetOpenReports };
}

const decisionSchema = z.object({ status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]), resolution: noMarkup(500, "Resolution").optional().default("") });
const REPORT_TRANSITIONS: Record<string, readonly ReportDecision[]> = { OPEN: ["UNDER_REVIEW", "RESOLVED", "DISMISSED"], UNDER_REVIEW: ["RESOLVED", "DISMISSED"], RESOLVED: [], DISMISSED: [] };

export async function decideReport(admin: AdminActor, reportId: string, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<ReportDetailDto> {
  assertPermission(admin, "reports.act");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the decision");
  const { status, resolution } = parsed.data;
  if (status === "RESOLVED" && resolution.length < 3) throw new ValidationError("Say how this was resolved");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Report" WHERE id = ${reportId} FOR UPDATE`;
    const r = await tx.report.findUnique({ where: { id: reportId }, select: { id: true, status: true, targetUserId: true } });
    if (!r) throw new NotFoundError("Report");
    if (!REPORT_TRANSITIONS[r.status]?.includes(status)) throw new InvalidStateError(`A report that is ${r.status.toLowerCase().replace("_", " ")} can't become ${status.toLowerCase().replace("_", " ")}`);
    const terminal = status !== "UNDER_REVIEW";
    await tx.report.update({ where: { id: r.id }, data: { status, resolution: resolution || null, resolvedById: terminal ? admin.userId : null, resolvedAt: terminal ? now : null } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.reportDecided, targetType: "Report", targetId: r.id, data: { targetUserId: r.targetUserId, resolution: resolution || null, before: { status: r.status }, after: { status } }, now });
  });
  return getReportDetail(admin, reportId, { db });
}
