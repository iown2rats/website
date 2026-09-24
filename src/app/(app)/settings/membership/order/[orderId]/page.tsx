import { notFound } from "next/navigation";
import { OrderClient } from "@/components/features/settings/order-client";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { parsePlusSurface } from "@/lib/plus-surfaces";
import { recordPlusEvent } from "@/server/analytics/plus-funnel";
import { getOrderForActor } from "@/server/billing/orders";

export const metadata = { title: "Plus order" };
export const dynamic = "force-dynamic";

/** One order, owned by the signed-in user (anyone else's id is a 404). */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ from?: string }> }) {
  const actor = await requireActiveUser();
  const { orderId } = await params;
  const order = await getOrderForActor(actor, orderId).catch(() => null);
  if (!order) notFound();
  // Funnel steps (§12.19), after the order is loaded and authorised; both are no-ops unless the switch is on and
  // neither can fail the page. Instructions are counted once per order; a tap on the checkout reminder each time.
  if (order.status === "AWAITING_PAYMENT") {
    await recordPlusEvent({ event: "plus_payment_instructions_viewed", userId: actor.userId, orderId: order.id, eventKey: `instructions:${order.id}` });
  }
  if (parsePlusSurface((await searchParams).from) === "checkout_recovery") {
    await recordPlusEvent({ event: "plus_prompt_clicked", userId: actor.userId, surface: "checkout_recovery", orderId: order.id });
  }
  return (
    <PageOverlay title="MelloCrush Plus" backHref="/settings/membership">
      <OrderClient initialOrder={order} />
    </PageOverlay>
  );
}
