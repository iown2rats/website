/**
 * Removes the stored objects a conversion orphaned: profile photos and any verification selfie
 * (docs/ARCHITECTURE.md §22.3).
 *
 * Always called *after* the conversion transaction has committed, never inside it. Object storage has no part in
 * a database transaction, so deleting first would risk destroying files for a conversion that then rolled back,
 * and a delete that fails afterwards leaves unreferenced bytes rather than a broken account. Failures are logged
 * and swallowed for exactly that reason: the account really has been converted, and reporting a failure here
 * would say otherwise.
 */
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";

export async function deleteOrphanedStorage(keys: string[], provider?: StorageProvider): Promise<void> {
  const unique = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0))];
  if (unique.length === 0) return;
  try {
    await (provider ?? getStorageProvider()).delete(unique);
  } catch (e) {
    // Unreferenced objects, not a failed conversion. Keys are logged so an operator can sweep them by hand.
    console.warn(`[staff] ${unique.length} orphaned object(s) could not be deleted:`, e instanceof Error ? e.message : e);
  }
}
