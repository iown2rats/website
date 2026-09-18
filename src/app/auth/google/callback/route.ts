import type { NextRequest } from "next/server";
import { completeSignIn } from "@/server/auth/flow";

/** GET /auth/google/callback — completes the Google flow (docs/ARCHITECTURE.md §4.1; shared flow in server/auth/flow.ts). */
export async function GET(request: NextRequest) {
  return completeSignIn(request, "google");
}
