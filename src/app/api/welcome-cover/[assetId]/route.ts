import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";

/**
 * GET /api/welcome-cover/<assetId> — the published Welcome Screen artwork, served to anyone (docs/ARCHITECTURE.md
 * §26). Public on purpose: this is the background of the sign-in page, so there is nobody to authorise.
 *
 * It exists because the storage bucket is private and hands out short-lived signed URLs, which are the wrong shape
 * for the largest image on the first page a stranger sees: they expire, they cannot be cached for long, and putting
 * one in the HTML hands out a credentialled URL. Reading the bytes here instead keeps the bucket private and lets
 * the response be cached forever — safe because an asset id is minted per upload and its bytes never change, so new
 * artwork is always a new URL rather than the same URL with different contents.
 *
 * TWO independent checks keep it from becoming a way to read the private bucket, because one was not enough:
 *   1. the id must resolve to a WelcomeCoverAsset row — the storage key comes from the row, never the request; and
 *   2. that key must sit under `welcome-covers/`, verified HERE rather than trusted from the database.
 *
 * The second check exists because the first one is only as good as who can write that table. Cover artwork is the
 * one thing this route may ever serve, so it says so itself: a row naming `profile-photos/...` gets a 404 like any
 * other miss. Anything that ever gets a row into that table — a bad migration, a console edit, a misconfigured
 * grant — still cannot turn a public endpoint into a reader for photos, receipts or verification selfies.
 */

/** Cover artwork lives here and nowhere else. A key outside this prefix is not a cover, whatever the row claims. */
const COVER_KEY_PREFIX = "welcome-covers/";
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  if (!/^[a-z0-9]{1,64}$/i.test(assetId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const asset = await getDb().welcomeCoverAsset.findUnique({ where: { id: assetId }, select: { storageKey: true } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!asset.storageKey.startsWith(COVER_KEY_PREFIX)) {
    console.error("[welcome-cover] refused a row pointing outside the cover prefix", { assetId });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = await getStorageProvider().read(asset.storageKey);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // Immutable: the id changes whenever the artwork does, so nothing here ever needs revalidating. This is also
      // what keeps the origin out of the path — the CDN answers every request after the first.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
