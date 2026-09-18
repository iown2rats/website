import type { CommunityFailure } from "@/actions/community";

/** Runs a Community server action; a transport failure (offline, aborted) becomes an ordinary failure result. */
export async function call<T extends { ok: boolean }>(fn: () => Promise<T | CommunityFailure>): Promise<T | CommunityFailure> {
  try {
    return await fn();
  } catch {
    return { ok: false, code: "ERROR", message: "Mellocrush couldn't reach the server. Check your connection and try again." };
  }
}
