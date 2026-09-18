import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { getAuthState } from "@/server/auth/current-user";
import { submitSelfie, VERIFICATION_RULES } from "@/server/verification";

/**
 * POST /api/verification/selfie — one multipart image from the signed-in member (docs/ARCHITECTURE.md §11). The
 * server decides eligibility, the retry window, the rate limit and the status; the browser sends a file and nothing
 * else. Same-origin only. A route handler rather than a server action so the phone can show upload progress.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getAuthState();
  if (state.kind !== "active") return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > VERIFICATION_RULES.maxBytes + 64 * 1024) return NextResponse.json({ error: "That photo is too large. Choose one under 8 MB." }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "Upload didn't complete. Try again." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Take or choose a selfie first." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verification = await submitSelfie({ userId: state.user.id }, { bytes, size: file.size }, { storage: getStorageProvider() });
    return NextResponse.json({ verification }, { status: 200 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 422 : 409 });
    console.error("[verification] selfie upload failed", e);
    return NextResponse.json({ error: "We couldn't save that selfie. Try again." }, { status: 500 });
  }
}
