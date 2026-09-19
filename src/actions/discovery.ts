"use server";

import { z } from "zod";
import { DISCOVERY } from "@/config/product";
import { isDomainError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { activateBoost } from "@/server/boosts/boost";
import { getAllowance, getDeck, likeByHandle, passByHandle, undoAndRestore, type AllowanceDto, type DeckPage, type LikeOutcome, type UndoOutcome } from "@/server/discovery/deck";
import { saveDiscoveryFilters, type DiscoveryFiltersDto } from "@/server/discovery/filters";

/*
 * Discovery server actions. The acting user is always the session user (requireMember); payloads carry public
 * handles only. Domain errors become typed results so the client never parses messages. Server actions are
 * POST requests scoped to the caller's cookie and are never cached (docs/ARCHITECTURE.md §7.5).
 */

const handleSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const deckInputSchema = z.object({ excludeHandles: z.array(handleSchema).max(DISCOVERY.maxExcludeHandles).default([]) });

export type ActionFailure = { ok: false; code: "NOT_FOUND" | "LIKE_LIMIT" | "ENTITLEMENT" | "UNDO_UNAVAILABLE" | "VALIDATION" | "BOOST_LIMIT" | "BOOST_ACTIVE" | "ERROR"; message: string; allowance?: AllowanceDto; serverNow: string };

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

export async function passCard(input: { handle: string }): Promise<{ ok: true; created: boolean; serverNow: string } | ActionFailure> {
  try {
    const actor = await requireMember();
    const handle = handleSchema.parse(input?.handle);
    return { ok: true, ...(await passByHandle(actor, handle)) };
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

export async function refreshAllowance(): Promise<{ ok: true; allowance: AllowanceDto; serverNow: string } | ActionFailure> {
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
