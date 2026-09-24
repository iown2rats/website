import { NextResponse, type NextRequest } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { getAuthState } from "@/server/auth/current-user";
import { recordPlusEvent } from "@/server/analytics/plus-funnel";
import { attachReceiptToOrder } from "@/server/billing/orders";
import { RECEIPT_RULES } from "@/server/billing/receipts";

/**
 * POST /api/payments/<orderId>/receipt — attaches the transfer receipt: one multipart image, stored privately, then
 * read by OCR and compared with the order (docs/ARCHITECTURE.md §12.14). The response carries the fresh order and the
 * customer-safe check summary; the order stays AWAITING_PAYMENT until the customer submits it. Ownership comes from
 * the session; the order id in the URL is only looked up together with the signed-in user. Same-origin only. The
 * browser sends a file and nothing else: no detected values, no outcome, no status can arrive from the client.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Plus is a member entitlement: only a fully active member may submit a receipt, never an operational
  // account and never an unconfirmed one (§16).
  const state = await getAuthState();
  if (state.kind !== "active") {
    return NextResponse.json({ error: state.kind === "staff" ? "Staff accounts don't buy Plus." : "Not signed in" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > RECEIPT_RULES.maxBytes + 64 * 1024) return NextResponse.json({ error: "That receipt is too large. Choose an image under 8 MB." }, { status: 413 });

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
    const result = await attachReceiptToOrder({ userId: state.user.id }, orderId, { bytes, size: file.size }, { storage: getStorageProvider() });
    // After the receipt is safely stored, and once per order however many times it is replaced. Never throws.
    await recordPlusEvent({ event: "plus_receipt_uploaded", userId: state.user.id, orderId: result.order.id, eventKey: `receipt:${result.order.id}` });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_FOUND" ? 404 : e.code === "VALIDATION" ? 422 : 409 });
    console.error("[payments] receipt upload failed", e);
    return NextResponse.json({ error: "We couldn't save that receipt. Try again." }, { status: 500 });
  }
}
