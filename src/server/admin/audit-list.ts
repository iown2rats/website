/** Read-only audit log listing for /admin/audit. Rows are never editable through any admin surface. */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { assertPermission, type AdminActor } from "./authz";

export interface AuditRowDto {
  id: string;
  action: string;
  actor: { userId: string; displayName: string | null } | null;
  targetType: string | null;
  targetId: string | null;
  data: unknown;
  createdAt: string;
}

export async function listAuditLog(admin: AdminActor, input: { action?: string; targetId?: string; actorId?: string; page?: number; pageSize?: number }, deps: { db?: Db } = {}): Promise<{ items: AuditRowDto[]; total: number; page: number; pageSize: number; actions: string[] }> {
  assertPermission(admin, "audit.view");
  const db = deps.db ?? getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const where: Prisma.AuditLogWhereInput = {
    ...(input.action ? { action: input.action } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
  };
  const [rows, total, actions] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { actor: { select: { id: true, profile: { select: { displayName: true } } } } } }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor ? { userId: r.actor.id, displayName: r.actor.profile?.displayName ?? null } : null, targetType: r.targetType, targetId: r.targetId, data: r.data ?? null, createdAt: r.createdAt.toISOString() })),
    total,
    page,
    pageSize,
    actions: actions.map((a) => a.action),
  };
}
