import { NextResponse, type NextRequest } from "next/server";
import { getLocalStorageProvider } from "@/lib/storage";

/**
 * GET /api/media/<key>?exp=&sig= — serves local-disk storage objects behind an HMAC-signed, expiring URL.
 * Only active with STORAGE_PROVIDER=local (development/test); the hosted provider signs its own URLs.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const local = getLocalStorageProvider();
  if (!local) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { key: parts } = await context.params;
  const key = parts.map(decodeURIComponent).join("/");
  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig") ?? "";
  if (!local.verify(key, exp, sig)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await local.read(key);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": key.endsWith(".webp") ? "image/webp" : "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
