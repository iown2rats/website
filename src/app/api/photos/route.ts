import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { getAuthState } from "@/server/auth/current-user";
import { PHOTO_RULES, processAndStorePhoto } from "@/server/photos/photos";

/**
 * POST /api/photos — multipart upload of one profile photo for the signed-in user.
 * Uses a route handler (not a server action) so the browser can report upload progress via XHR.
 * CSRF: same-origin only (Sec-Fetch-Site) in addition to the SameSite cookie.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getAuthState();
  if (state.kind === "anonymous") return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > PHOTO_RULES.maxBytes + 64 * 1024) return NextResponse.json({ error: "That photo is too large. Choose one under 8 MB." }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "Upload didn't complete. Try again." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const photo = await processAndStorePhoto({ userId: state.user.id }, { bytes, declaredType: file.type, size: file.size }, { storage: getStorageProvider() });
    return NextResponse.json({ photo }, { status: 201 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 422 : 409 });
    console.error("[photos] upload failed", e);
    return NextResponse.json({ error: "We couldn't save that photo. Try again." }, { status: 500 });
  }
}
