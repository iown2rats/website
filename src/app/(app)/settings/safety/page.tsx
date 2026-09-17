import { SafetyClient } from "@/components/features/settings/safety-client";
import { requireActiveUser } from "@/server/auth/current-user";

export const metadata = { title: "Safety Center" };

export default async function SafetyPage() {
  await requireActiveUser();
  return <SafetyClient />;
}
