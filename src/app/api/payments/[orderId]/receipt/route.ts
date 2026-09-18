import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { getAuthState } from "@/server/auth/current-user";
import { ORDER_RULES, submitReceipt } from "@/server/billing/orders";

/**
 * POST /api/payments/<orderId>/receipt — "I've made the transfer": one multipart image, stored privately, and the
 * order moves to SUBMITTED in the same step (docs/ARCHITECTURE.md §12.11). Ownership comes from the session; the
 * order id in the URL is only looked up together with the signed-in user. Same-origin only.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getAuthState();
  if (state.kind === "anonymous") return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > ORDER_RULES.receiptMaxBytes + 64 * 1024) return NextResponse.json({ error: "That receipt is too large. Choose an image under 8 MB." }, { status: 413 });

  const { orderId } = await context.params;
  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "Upload didn't complete. Try again." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a screenshot or photo of the receipt." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const order = await submitReceipt({ userId: state.user.id }, orderId, { bytes, size: file.size }, { storage: getStorageProvider() });
    return NextResponse.json({ order }, { status: 200 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_FOUND" ? 404 : e.code === "VALIDATION" ? 422 : 409 });
    console.error("[payments] receipt upload failed", e);
    return NextResponse.json({ error: "We couldn't save that receipt. Try again." }, { status: 500 });
  }
}
