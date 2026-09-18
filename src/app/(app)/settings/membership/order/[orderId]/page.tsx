import { notFound } from "next/navigation";
import { OrderClient } from "@/components/features/settings/order-client";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { getOrderForActor } from "@/server/billing/orders";

export const metadata = { title: "Plus order" };
export const dynamic = "force-dynamic";

/** One order, owned by the signed-in user (anyone else's id is a 404). */
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const actor = await requireActiveUser();
  const { orderId } = await params;
  const order = await getOrderForActor(actor, orderId).catch(() => null);
  if (!order) notFound();
  return (
    <PageOverlay title="Thundi Plus" backHref="/settings/membership">
      <OrderClient initialOrder={order} />
    </PageOverlay>
  );
}
