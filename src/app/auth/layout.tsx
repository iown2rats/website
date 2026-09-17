import type { ReactNode } from "react";
import { redirectIfAuthenticated } from "@/server/auth/current-user";

/** Signed-in users never see the login screens (Phase 5 §21). */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  await redirectIfAuthenticated();
  return <>{children}</>;
}
