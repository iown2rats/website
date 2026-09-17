import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isProduction } from "@/lib/runtime";

/** Everything under /dev is development-only. In production builds these routes 404. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (isProduction) notFound();
  return <>{children}</>;
}
