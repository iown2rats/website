import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getAuthState } from "@/server/auth/current-user";
import { createPost, postKindSchema } from "@/server/community/posts";
import { IMAGE_RULES } from "@/server/media/process-image";

/**
 * POST /api/community/posts — creates a Community post (text, question, photo, poll or confession) for the
 * signed-in user. Multipart so the browser can report upload progress for photo posts. Same-origin only
 * (Sec-Fetch-Site) in addition to the SameSite cookie; the author is always the session user.
 *
 * Note what this route does NOT accept: there is no "anonymous" field. A confession is anonymous because of its
 * kind, decided in createPost, so a crafted request cannot post anonymously as anything else — and cannot strip
 * the anonymity off a confession either.
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
  const topic = form.get("topic") == null ? null : String(form.get("topic"));
  // Repeated fields rather than an embedded JSON blob: one less parser between the browser and validation.
  const options = form.getAll("option").map((v) => String(v));
  const entry = form.get("photo");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  try {
    const photo = file ? { bytes: new Uint8Array(await file.arrayBuffer()), size: file.size } : null;
    const post = await createPost({ userId: state.user.id }, { kind: kind.data, body, topic, photo, pollOptions: options.length > 0 ? options : undefined });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 422 : 409 });
    console.error("[community] post failed", e);
    return NextResponse.json({ error: "We couldn't publish that right now. Try again." }, { status: 500 });
  }
}
