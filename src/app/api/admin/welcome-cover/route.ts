import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { AdminAccessError, requireAdmin } from "@/server/admin/authz";
import { COVER_RULES, uploadCoverAsset } from "@/server/welcome/admin-covers";

/**
 * POST /api/admin/welcome-cover — multipart upload of one Welcome Screen cover variant.
 *
 * A route handler rather than a server action because a server action's request body is capped well below the 8 MB
 * an admin may legitimately send. Authorization is the same either way: `requireAdmin("welcome-cover.manage")` reads
 * the session and the live StaffGrant from the database, so a hand-made request from a signed-in member — or from a
 * moderator, who does not hold this permission — gets the same refusal as a stranger.
 *
 * Uploading NEVER changes what visitors see. The asset is attached to a cover; the cover has to be published.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > COVER_RULES.maxBytes + 64 * 1024) return NextResponse.json({ error: "That image is too large. Choose one under 8 MB." }, { status: 413 });

  try {
    const admin = await requireAdmin("welcome-cover.manage");
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Upload didn't complete. Try again." }, { status: 400 });
    const entry = form.get("file");
    const file = entry instanceof File ? entry : null;
    const coverId = String(form.get("coverId") ?? "");
    const variant = String(form.get("variant") ?? "");
    if (!file) return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const cover = await uploadCoverAsset(admin, { coverId, variant, bytes, size: file.size }, { storage: getStorageProvider() });
    revalidatePath("/admin/settings/welcome");
    return NextResponse.json({ cover }, { status: 201 });
  } catch (e) {
    // A non-admin gets 404, matching the rest of the portal: it never confirms that this endpoint is there.
    if (e instanceof AdminAccessError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 422 : 409 });
    console.error("[welcome-cover] upload failed", e);
    return NextResponse.json({ error: "We couldn't save that image. Try again." }, { status: 500 });
  }
}
