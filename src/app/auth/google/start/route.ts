import type { NextRequest } from "next/server";
import { startSignIn } from "@/server/auth/flow";

/** GET /auth/google/start — begins "Continue with Google" (docs/ARCHITECTURE.md §4.1; shared flow in server/auth/flow.ts). */
export async function GET(request: NextRequest) {
  return startSignIn(request, "google");
}
