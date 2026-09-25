"use server";

import { z } from "zod";
import { DISCOVERY } from "@/config/product";
import { isDomainError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { activateBoost } from "@/server/boosts/boost";
import { getAllowance, getDeck, likeByHandle, passByHandle, superLikeByHandle, undoAndRestore, type AllowanceDto, type DeckPage, type LikeOutcome, type SuperLikeAllowanceDto, type SuperLikeOutcome, type UndoOutcome } from "@/server/discovery/deck";
import { saveDiscoveryFilters, type DiscoveryFiltersDto } from "@/server/discovery/filters";

/*
 * Discovery server actions. The acting user is always the session user (requireMember); payloads carry public
 * handles only. Domain errors become typed results so the client never parses messages. Server actions are
 * POST requests scoped to the caller's cookie and are never cached (docs/ARCHITECTURE.md §7.5).
 */

const handleSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const deckInputSchema = z.object({ excludeHandles: z.array(handleSchema).max(DISCOVERY.maxExcludeHandles).default([]) });

export type ActionFailure = {
  ok: false;
  code: "NOT_FOUND" | "LIKE_LIMIT" | "ENTITLEMENT" | "UNDO_UNAVAILABLE" | "VALIDATION" | "BOOST_LIMIT" | "BOOST_ACTIVE" | "SUPER_LIKE_LIMIT" | "UNAVAILABLE" | "ERROR";
  message: string;
  allowance?: AllowanceDto;
  /** Super Like failures carry the authoritative allowance so the client can show "Resets in 2 days". */
  superLikes?: SuperLikeAllowanceDto;
  serverNow: string;
};

function failure(e: unknown, extra: Partial<ActionFailure> = {}): ActionFailure {
  const serverNow = new Date().toISOString();
  if (isDomainError(e)) {
    switch (e.code) {
      case "NOT_FOUND":
        return { ok: false, code: "NOT_FOUND", message: "That profile isn't available any more.", serverNow, ...extra };
      case "LIKE_LIMIT_REACHED":
        return { ok: false, code: "LIKE_LIMIT", message: e.message, serverNow, ...extra };
      case "ENTITLEMENT_REQUIRED":
        return { ok: false, code: "ENTITLEMENT", message: e.message, serverNow, ...extra };
      case "UNDO_UNAVAILABLE":
        return { ok: false, code: "UNDO_UNAVAILABLE", message: e.message, serverNow, ...extra };
      case "BOOST_LIMIT_REACHED":
        return { ok: false, code: "BOOST_LIMIT", message: e.message, serverNow, ...extra };
      case "BOOST_ALREADY_ACTIVE":
        return { ok: false, code: "BOOST_ACTIVE", message: e.message, serverNow, ...extra };
      case "VALIDATION":
        return { ok: false, code: "VALIDATION", message: e.message, serverNow, ...extra };
      case "SUPER_LIKE_LIMIT_REACHED":
        return { ok: false, code: "SUPER_LIKE_LIMIT", message: e.message, serverNow, ...extra };
      default:
        break;
    }
  }
  console.error("[discovery] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't do that right now. Try again.", serverNow, ...extra };
}

export async function loadDeck(input: unknown): Promise<({ ok: true } & DeckPage) | ActionFailure> {
  try {
    const actor = await requireMember();
    const parsed = deckInputSchema.parse(input ?? {});
    return { ok: true, ...(await getDeck(actor, { excludeHandles: parsed.excludeHandles })) };
  } catch (e) {
    return failure(e);
  }
}

export async function likeCard(input: { handle: string }): Promise<({ ok: true } & LikeOutcome) | ActionFailure> {
  let actor;
  try {
    actor = await requireMember();
    const handle = handleSchema.parse(input?.handle);
    return { ok: true, ...(await likeByHandle(actor, handle)) };
  } catch (e) {
    // On a limit failure the client needs the authoritative allowance to render the reset time.
    const allowance = actor ? await getAllowance(actor).then((a) => a.allowance).catch(() => undefined) : undefined;
    return failure(e, allowance ? { allowance } : {});
  }
}

/**
 * Super Like (Plus, §12.20). The message is optional and validated on the server (≤ 150 characters after trimming);
 * the input cap here only stops an absurd payload before it is parsed. Entitlement, allowance, visibility and pools are
 * all decided inside the transaction — nothing the client shows (a counter, an enabled button) is trusted.
 */
const superLikeInputSchema = z.object({ handle: handleSchema, message: z.string().max(2000).nullable().optional() });

export async function superLikeCard(input: { handle: string; message?: string | null }): Promise<({ ok: true } & SuperLikeOutcome) | ActionFailure> {
  let actor;
  try {
    actor = await requireMember();
    const parsed = superLikeInputSchema.parse(input ?? {});
    return { ok: true, ...(await superLikeByHandle(actor, parsed.handle, parsed.message ?? null)) };
  } catch (e) {
    const current = actor ? await getAllowance(actor).catch(() => undefined) : undefined;
    const extra = current ? { allowance: current.allowance, superLikes: current.superLikes } : {};
    // Refusals that are not faults (already liked, dating paused, a pool change) are said in the server's words.
    if (isDomainError(e) && e.code === "INVALID_STATE") return { ok: false, code: "UNAVAILABLE", message: e.message, serverNow: new Date().toISOString(), ...extra };
    if (e instanceof z.ZodError) return { ok: false, code: "VALIDATION", message: "That Super Like isn't valid.", serverNow: new Date().toISOString(), ...extra };
    return failure(e, extra);
  }
}

export async function passCard(input: { handle: string; source?: "likes_you" }): Promise<{ ok: true; created: boolean; serverNow: string } | ActionFailure> {
  try {
    const actor = await requireMember();
    const handle = handleSchema.parse(input?.handle);
    // A pass tapped on Likes You is a "no" to that person's like; one from Discover is not (§12.5).
    return { ok: true, ...(await passByHandle(actor, handle, { dismissIncomingLike: input?.source === "likes_you" })) };
  } catch (e) {
    return failure(e);
  }
}

export async function undoLastCard(): Promise<({ ok: true } & UndoOutcome) | ActionFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, ...(await undoAndRestore(actor)) };
  } catch (e) {
    return failure(e);
  }
}

export async function refreshAllowance(): Promise<{ ok: true; allowance: AllowanceDto; superLikes: SuperLikeAllowanceDto; serverNow: string } | ActionFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, ...(await getAllowance(actor)) };
  } catch (e) {
    return failure(e);
  }
}

export async function saveFilters(input: unknown): Promise<{ ok: true; filters: DiscoveryFiltersDto } | ActionFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, filters: await saveDiscoveryFilters(actor, input) };
  } catch (e) {
    return failure(e);
  }
}

/** Server-enforced: Free users are refused by activateBoost regardless of what the client shows. */
export async function boostMe(): Promise<{ ok: true; endsAt: string; boostsRemaining: number } | ActionFailure> {
  try {
    const actor = await requireMember();
    const boost = await activateBoost(actor);
    return { ok: true, endsAt: boost.endsAt.toISOString(), boostsRemaining: boost.boostsRemaining };
  } catch (e) {
    return failure(e);
  }
}
