/**
 * Managing Welcome Screen covers (docs/ARCHITECTURE.md §26). Every function here is an ADMIN action and takes an
 * `AdminActor` that the caller obtained from `requireAdmin("welcome-cover.manage")`; nothing in this module trusts
 * a client payload for anything but content.
 *
 * The workflow is upload → preview → publish, and the middle step is the point: uploading changes NOTHING that a
 * visitor sees. A cover is DRAFT until it is published, and `getActiveWelcomeCover` only ever looks at PUBLISHED
 * rows. There is deliberately no "upload and go live" shortcut.
 *
 * Storage keys are `welcome-covers/<assetId>.webp` and are never reused. Replacing an image writes a new object
 * under a new id, which is what lets the public route cache covers immutably: a URL that has ever been served
 * always means the same bytes, so publishing new artwork cannot leave a phone showing the old one.
 */
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { StorageProvider } from "@/lib/storage/provider";
import type { AdminActor } from "@/server/admin/authz";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { processImage } from "@/server/media/process-image";
import { sniffUnsupported, unsupportedMessage } from "@/server/media/sniff";
import { liveCoverId } from "./active-cover";
import { coverAssetUrl, coverView, type CoverRow } from "./cover";
import { describeUploadWarnings, isWelcomeCoverVariant, variantSpec, type UploadWarning, type WelcomeCoverVariantKey } from "./variants";

export const COVER_RULES = {
  maxBytes: 8 * 1024 * 1024,
  /** Quality is a touch above the profile-photo default: this is a full-bleed image nobody scrolls past. */
  quality: 84,
} as const;

/** DRAFT and ARCHIVED are columns; SCHEDULED, LIVE and EXPIRED are the clock's opinion of a PUBLISHED row. */
export type WelcomeCoverState = "DRAFT" | "SCHEDULED" | "LIVE" | "SUPERSEDED" | "EXPIRED" | "ARCHIVED";

export interface CoverAssetDto {
  id: string;
  variant: WelcomeCoverVariantKey;
  url: string;
  width: number;
  height: number;
  bytes: number;
  uploadedAt: string;
  warnings: UploadWarning[];
}

export interface WelcomeCoverDto {
  id: string;
  name: string;
  state: WelcomeCoverState;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  assets: Record<WelcomeCoverVariantKey, CoverAssetDto | null>;
  /** What this cover would actually paint, defaults filled in — the admin preview renders exactly this. */
  preview: ReturnType<typeof coverView>;
}

const COVER_SELECT = {
  id: true,
  name: true,
  status: true,
  startsAt: true,
  endsAt: true,
  publishedAt: true,
  createdAt: true,
  createdBy: { select: { identities: { where: { releasedAt: null }, select: { email: true }, take: 1 } } },
  mobileAsset: { select: { id: true, variant: true, width: true, height: true, bytes: true, createdAt: true, blurhash: true } },
  tabletAsset: { select: { id: true, variant: true, width: true, height: true, bytes: true, createdAt: true, blurhash: true } },
  desktopAsset: { select: { id: true, variant: true, width: true, height: true, bytes: true, createdAt: true, blurhash: true } },
} as const;

type CoverWithAssets = {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  startsAt: Date | null;
  endsAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  createdBy: { identities: { email: string | null }[] } | null;
  mobileAsset: AssetRow | null;
  tabletAsset: AssetRow | null;
  desktopAsset: AssetRow | null;
};

interface AssetRow {
  id: string;
  variant: WelcomeCoverVariantKey;
  width: number;
  height: number;
  bytes: number;
  createdAt: Date;
  blurhash: string;
}

/**
 * The state to show for one cover. `liveId` is the winner of the overlap rule, so exactly one row can ever read
 * LIVE: another published, in-window cover reads SUPERSEDED rather than claiming to be on air too.
 */
export function describeCoverState(cover: { status: string; startsAt: Date | null; endsAt: Date | null; id: string }, liveId: string | null, now: Date): WelcomeCoverState {
  if (cover.status === "DRAFT") return "DRAFT";
  if (cover.status === "ARCHIVED") return "ARCHIVED";
  if (cover.endsAt && cover.endsAt <= now) return "EXPIRED";
  if (cover.startsAt && cover.startsAt > now) return "SCHEDULED";
  return cover.id === liveId ? "LIVE" : "SUPERSEDED";
}

function assetDto(asset: AssetRow | null): CoverAssetDto | null {
  if (!asset) return null;
  return {
    id: asset.id,
    variant: asset.variant,
    url: coverAssetUrl(asset.id),
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    uploadedAt: asset.createdAt.toISOString(),
    warnings: describeUploadWarnings(asset.variant, asset.width, asset.height),
  };
}

function coverDto(cover: CoverWithAssets, liveId: string | null, now: Date): WelcomeCoverDto {
  return {
    id: cover.id,
    name: cover.name,
    state: describeCoverState(cover, liveId, now),
    status: cover.status,
    startsAt: cover.startsAt?.toISOString() ?? null,
    endsAt: cover.endsAt?.toISOString() ?? null,
    publishedAt: cover.publishedAt?.toISOString() ?? null,
    createdAt: cover.createdAt.toISOString(),
    createdBy: cover.createdBy?.identities[0]?.email ?? null,
    assets: { MOBILE: assetDto(cover.mobileAsset), TABLET: assetDto(cover.tabletAsset), DESKTOP: assetDto(cover.desktopAsset) },
    preview: coverView(cover as unknown as CoverRow),
  };
}

export interface WelcomeCoverListDto {
  covers: WelcomeCoverDto[];
  /** True when nothing is published, i.e. the built-in defaults are what visitors see. */
  showingDefaults: boolean;
}

/** Everything the admin screen needs, newest first: drafts, what is on air, and the history behind it. */
export async function listWelcomeCovers(deps: { db?: DbLike; now?: Date } = {}): Promise<WelcomeCoverListDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [rows, liveId] = await Promise.all([
    db.welcomeCover.findMany({ orderBy: [{ createdAt: "desc" }], select: COVER_SELECT, take: 50 }),
    liveCoverId(db, now),
  ]);
  return { covers: (rows as unknown as CoverWithAssets[]).map((c) => coverDto(c, liveId, now)), showingDefaults: liveId == null };
}

export async function getWelcomeCover(coverId: string, deps: { db?: DbLike; now?: Date } = {}): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const row = await db.welcomeCover.findUnique({ where: { id: coverId }, select: COVER_SELECT });
  if (!row) throw new NotFoundError("That cover no longer exists.");
  return coverDto(row as unknown as CoverWithAssets, await liveCoverId(db, now), now);
}

function cleanName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new ValidationError("Give this cover a name.");
  if (trimmed.length > 80) throw new ValidationError("That name is too long.");
  return trimmed;
}

export async function createWelcomeCover(admin: AdminActor, input: { name: unknown }, deps: { db?: Db; now?: Date } = {}): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const name = cleanName(input.name);
  const cover = await db.welcomeCover.create({ data: { name, createdById: admin.userId }, select: { id: true } });
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverCreated, targetType: "WelcomeCover", targetId: cover.id, data: { name }, now });
  return getWelcomeCover(cover.id, { db, now });
}

export interface UploadCoverInput {
  coverId: string;
  variant: unknown;
  bytes: Uint8Array;
  size: number;
}

/**
 * Store one variant's artwork. The browser's declared type is never trusted: sharp sniffs the real format, the
 * allow-list is JPG/PNG/WebP, EXIF (including GPS) is dropped by the re-encode, and the result is capped at the
 * variant's recommended size so a 6000px upload cannot become a 6000px download.
 *
 * Replacing a variant leaves the previous asset row alone. It is still referenced by any published cover in the
 * history that used it, and `removeCoverAsset` is the only thing that ever deletes bytes.
 */
export async function uploadCoverAsset(admin: AdminActor, input: UploadCoverInput, deps: { db?: Db; storage: StorageProvider; now?: Date }): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!isWelcomeCoverVariant(input.variant)) throw new ValidationError("Choose Mobile, Tablet or Desktop.");
  const spec = variantSpec(input.variant);
  const cover = await db.welcomeCover.findUnique({ where: { id: input.coverId }, select: { id: true, status: true } });
  if (!cover) throw new NotFoundError("That cover no longer exists.");
  if (cover.status === "ARCHIVED") throw new ValidationError("This cover is archived. Republish it before changing its artwork.");
  if (input.size > COVER_RULES.maxBytes || input.bytes.byteLength > COVER_RULES.maxBytes) throw new ValidationError("That image is too large. Choose one under 8 MB.");
  if (input.bytes.byteLength === 0) throw new ValidationError("That file is empty.");
  const unsupported = sniffUnsupported(input.bytes);
  if (unsupported) throw new ValidationError(unsupportedMessage(unsupported, "cover"));

  const processed = await processImage(input.bytes, { maxWidth: spec.recommended.width, maxHeight: spec.recommended.height, quality: COVER_RULES.quality });

  const asset = await db.welcomeCoverAsset.create({
    data: { variant: input.variant, storageKey: "pending", width: processed.width, height: processed.height, bytes: processed.full.byteLength, blurhash: processed.blurhash, createdById: admin.userId },
    select: { id: true },
  });
  const storageKey = `welcome-covers/${asset.id}.webp`;
  try {
    await deps.storage.put(storageKey, processed.full, "image/webp");
  } catch (e) {
    await db.welcomeCoverAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    throw e;
  }
  const column = `${input.variant.toLowerCase()}AssetId` as "mobileAssetId" | "tabletAssetId" | "desktopAssetId";
  await db.$transaction(async (tx) => {
    await tx.welcomeCoverAsset.update({ where: { id: asset.id }, data: { storageKey } });
    await tx.welcomeCover.update({ where: { id: input.coverId }, data: { [column]: asset.id } });
  });
  await writeAudit(db, {
    actorId: admin.userId,
    action: AUDIT_ACTIONS.welcomeCoverAssetUploaded,
    targetType: "WelcomeCover",
    targetId: input.coverId,
    data: { variant: input.variant, assetId: asset.id, width: processed.width, height: processed.height },
    now,
  });
  return getWelcomeCover(input.coverId, { db, now });
}

/**
 * Unlink a variant, and delete the object only when nothing else points at it — "remove where safe". An asset a
 * published or archived cover still references stays put, because history has to keep rendering.
 */
export async function removeCoverAsset(admin: AdminActor, input: { coverId: string; variant: unknown }, deps: { db?: Db; storage: StorageProvider; now?: Date }): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!isWelcomeCoverVariant(input.variant)) throw new ValidationError("Choose Mobile, Tablet or Desktop.");
  const column = `${input.variant.toLowerCase()}AssetId` as "mobileAssetId" | "tabletAssetId" | "desktopAssetId";
  const cover = await db.welcomeCover.findUnique({ where: { id: input.coverId }, select: { id: true, [column]: true } as never });
  if (!cover) throw new NotFoundError("That cover no longer exists.");
  const assetId = (cover as Record<string, unknown>)[column] as string | null;
  if (!assetId) return getWelcomeCover(input.coverId, { db, now });

  await db.welcomeCover.update({ where: { id: input.coverId }, data: { [column]: null } });
  const stillUsed = await db.welcomeCover.count({ where: { OR: [{ mobileAssetId: assetId }, { tabletAssetId: assetId }, { desktopAssetId: assetId }] } });
  if (stillUsed === 0) {
    const asset = await db.welcomeCoverAsset.findUnique({ where: { id: assetId }, select: { storageKey: true } });
    await db.welcomeCoverAsset.delete({ where: { id: assetId } }).catch(() => undefined);
    if (asset) await deps.storage.delete([asset.storageKey]).catch(() => undefined);
  }
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverAssetRemoved, targetType: "WelcomeCover", targetId: input.coverId, data: { variant: input.variant, assetId, deletedBytes: stillUsed === 0 }, now });
  return getWelcomeCover(input.coverId, { db, now });
}

function parseWhen(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label} isn't a date we can read.`);
  return d;
}

export interface CoverScheduleInput {
  coverId: string;
  name?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
}

export async function updateWelcomeCover(admin: AdminActor, input: CoverScheduleInput, deps: { db?: Db; now?: Date } = {}): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const cover = await db.welcomeCover.findUnique({ where: { id: input.coverId }, select: { id: true } });
  if (!cover) throw new NotFoundError("That cover no longer exists.");
  const startsAt = parseWhen(input.startsAt, "The start date");
  const endsAt = parseWhen(input.endsAt, "The end date");
  if (startsAt && endsAt && endsAt <= startsAt) throw new ValidationError("The end date has to be after the start date.");
  const data: Record<string, unknown> = { startsAt, endsAt };
  if (input.name !== undefined) data.name = cleanName(input.name);
  await db.welcomeCover.update({ where: { id: input.coverId }, data });
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverUpdated, targetType: "WelcomeCover", targetId: input.coverId, data: { startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null }, now });
  return getWelcomeCover(input.coverId, { db, now });
}

/**
 * Put a cover on air (or back on air). A cover with no artwork at all is refused: publishing it would be
 * indistinguishable from restoring the defaults, while looking like a promotion in the list.
 *
 * Republishing something that has expired clears the stale end date — otherwise the row would go live and expire in
 * the same instant, which reads as "publish did nothing".
 */
export async function publishWelcomeCover(admin: AdminActor, coverId: string, deps: { db?: Db; now?: Date } = {}): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const cover = await db.welcomeCover.findUnique({ where: { id: coverId }, select: { id: true, mobileAssetId: true, tabletAssetId: true, desktopAssetId: true, endsAt: true } });
  if (!cover) throw new NotFoundError("That cover no longer exists.");
  if (!cover.mobileAssetId && !cover.tabletAssetId && !cover.desktopAssetId) {
    throw new ValidationError("Add at least one image before publishing.");
  }
  const expired = cover.endsAt != null && cover.endsAt <= now;
  await db.welcomeCover.update({ where: { id: coverId }, data: { status: "PUBLISHED", publishedAt: now, ...(expired ? { endsAt: null } : {}) } });
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverPublished, targetType: "WelcomeCover", targetId: coverId, data: { clearedEndDate: expired }, now });
  return getWelcomeCover(coverId, { db, now });
}

/** Take one cover off air. It keeps its artwork and can be republished from the history list. */
export async function archiveWelcomeCover(admin: AdminActor, coverId: string, deps: { db?: Db; now?: Date } = {}): Promise<WelcomeCoverDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const cover = await db.welcomeCover.findUnique({ where: { id: coverId }, select: { id: true } });
  if (!cover) throw new NotFoundError("That cover no longer exists.");
  await db.welcomeCover.update({ where: { id: coverId }, data: { status: "ARCHIVED" } });
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverArchived, targetType: "WelcomeCover", targetId: coverId, data: {}, now });
  return getWelcomeCover(coverId, { db, now });
}

/**
 * "Restore default": archive every published cover, so selection finds nothing and the built-ins take over. One
 * action, no artwork deleted, and every archived cover can still be republished.
 */
export async function restoreDefaultWelcomeCover(admin: AdminActor, deps: { db?: Db; now?: Date } = {}): Promise<WelcomeCoverListDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const { count } = await db.welcomeCover.updateMany({ where: { status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
  await writeAudit(db, { actorId: admin.userId, action: AUDIT_ACTIONS.welcomeCoverDefaultsRestored, targetType: "WelcomeCover", data: { archived: count }, now });
  return listWelcomeCovers({ db, now });
}
