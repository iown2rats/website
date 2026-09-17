import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getAuthState } from "@/server/auth/current-user";
import { createPost, postKindSchema } from "@/server/community/posts";
import { IMAGE_RULES } from "@/server/media/process-image";

/**
 * POST /api/community/posts — creates a Community post (text, question or photo) for the signed-in user.
 * Multipart so the browser can report upload progress for photo posts. Same-origin only (Sec-Fetch-Site) in
 * addition to the SameSite cookie; the author is always the session user.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const state = await getAuthState();
  if (state.kind !== "active") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > IMAGE_RULES.maxBytes + 64 * 1024) return NextResponse.json({ error: "That photo is too large. Choose one under 8 MB." }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload didn't complete. Try again." }, { status: 400 });
  }
  const kind = postKindSchema.safeParse(form.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Choose a post type." }, { status: 422 });
  const body = String(form.get("body") ?? "");
  const entry = form.get("photo");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  try {
    const photo = file ? { bytes: new Uint8Array(await file.arrayBuffer()), size: file.size } : null;
    const post = await createPost({ userId: state.user.id }, { kind: kind.data, body, photo });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 422 : 409 });
    console.error("[community] post failed", e);
    return NextResponse.json({ error: "We couldn't publish that right now. Try again." }, { status: 500 });
  }
}
