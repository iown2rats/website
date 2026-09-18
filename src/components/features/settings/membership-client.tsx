"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { startPlusOrder } from "@/actions/billing";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import type { MembershipDto } from "@/server/entitlements/presentation";
import { Callout } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/*
 * Plan choice and current-order card on the Membership screen (docs/ARCHITECTURE.md §12.11). Tapping a plan creates
 * (or resumes) an order on the server and moves to the order screen with the bank instructions. Nothing here shows a
 * Plus badge until the entitlement is really active; a pending or rejected order is stated as exactly that.
 */
export function MembershipPlans({ membership }: { membership: MembershipDto }) {
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(membership.plans.find((p) => p.forSale)?.id ?? null);
  const [pending, start] = useTransition();
  const m = membership;
  const order = m.currentOrder;
  const sellable = m.plans.filter((p) => p.forSale);
  const open = order && (order.status === "AWAITING_PAYMENT" || order.status === "SUBMITTED");

  const buy = () => {
    if (!chosen) return;
    start(async () => {
      const r = await startPlusOrder({ planId: chosen }).catch(() => null);
      if (r && !r.ok) toast.show(r.message);
    });
  };

  return (
    <>
      {order ? <CurrentOrderCard order={order} /> : null}

      {m.tier === "FREE" && !open ? (
        <>
          <div className={cn("grid gap-2.5", m.plans.length >= 3 ? "grid-cols-3" : "grid-cols-2")} role="radiogroup" aria-label="Plus plans">
            {m.plans.map((p) => {
              const selected = chosen === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!p.forSale || !m.paymentsAvailable}
                  onClick={() => setChosen(p.id)}
                  className={cn("relative flex flex-col items-center gap-1 rounded-2xl border-[1.5px] px-3 py-4 text-center transition-colors disabled:opacity-60", selected ? "border-primary bg-aqua-soft" : "border-border bg-surface")}
                >
                  {p.badge ? <span className="absolute -top-2.5 rounded-full bg-ocean px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[.05em] text-sand">{p.badge}</span> : null}
                  <span className="text-micro font-bold text-text-secondary">{p.name}</span>
                  <span className="text-body font-extrabold tracking-[-.02em] text-text">{p.price ?? "Price TBA"}</span>
                  <span className="text-[11px] text-text-secondary">{p.intervalDays} days</span>
                </button>
              );
            })}
          </div>
          {m.paymentsAvailable && sellable.length > 0 ? (
            <>
              <Button variant="plus" size="lg" fullWidth onClick={buy} loading={pending} disabled={!chosen}>
                Get Thundi Plus
              </Button>
              <p className="text-center text-caption leading-relaxed text-text-secondary">You pay by bank transfer. Plus starts after we confirm your payment, usually within a day.</p>
            </>
          ) : (
            <Callout tone="info" title="Plus isn't on sale yet">Pricing in MVR and payment details are being finalised. Nothing is charged today, and there are no upgrade prompts elsewhere in the app.</Callout>
          )}
        </>
      ) : null}

      {m.tier === "PLUS" && !open ? (
        <div className="flex flex-col gap-3">
          <Callout tone="ocean" title={m.periodEnd ? `Plus until ${formatDate(m.periodEnd)}` : "Plus is active"}>
            {m.planName ? `Current plan: ${m.planName}. ` : ""}Renew any time: a new period starts when the current one ends, so you never lose paid days.
          </Callout>
          {m.paymentsAvailable && sellable.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <div className={cn("grid gap-2.5", m.plans.length >= 3 ? "grid-cols-3" : "grid-cols-2")} role="radiogroup" aria-label="Renewal plans">
                {sellable.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id} onClick={() => setChosen(p.id)} className={cn("flex flex-col items-center gap-1 rounded-2xl border-[1.5px] px-3 py-3.5 text-center", chosen === p.id ? "border-primary bg-aqua-soft" : "border-border bg-surface")}>
                    <span className="text-micro font-bold text-text-secondary">{p.name}</span>
                    <span className="text-body font-extrabold text-text">{p.price}</span>
                  </button>
                ))}
              </div>
              <Button variant="secondary" size="md" fullWidth onClick={buy} loading={pending} disabled={!chosen}>
                Renew Plus
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function CurrentOrderCard({ order }: { order: MembershipDto["currentOrder"] & object }) {
  const o = order!;
  const attached = o.status === "AWAITING_PAYMENT" && o.hasReceipt;
  const tone = o.status === "SUBMITTED" ? "info" : o.status === "APPROVED" ? "success" : o.status === "REJECTED" ? "danger" : "warning";
  const title = o.status === "SUBMITTED" ? "Payment under review" : o.status === "APPROVED" ? "Payment confirmed" : o.status === "REJECTED" ? "Payment not accepted" : attached ? "Receipt attached, not yet submitted" : o.status === "AWAITING_PAYMENT" ? "Waiting for your transfer" : `Order ${o.status.toLowerCase()}`;
  return (
    <Callout tone={tone} title={title}>
      <div className="flex flex-col gap-1.5">
        <div>
          {o.planName} · {o.amountLabel} · reference <span className="font-mono font-bold">{o.reference}</span>
        </div>
        {o.status === "SUBMITTED" ? <div>Receipt submitted {formatDateTime(o.submittedAt)}. We check transfers within a day; Plus starts the moment it is confirmed.</div> : null}
        {o.status === "APPROVED" ? <div>Confirmed {formatDateTime(o.decidedAt)}.{o.periodEnd ? ` Plus runs until ${formatDate(o.periodEnd)}.` : ""}</div> : null}
        {o.status === "REJECTED" ? <div>{o.rejectionReason ? `Reason: ${o.rejectionReason}. ` : ""}If you did transfer, check the reference and amount, then start a new order below. Nothing was charged by Thundi.</div> : null}
        {attached ? <div>Open the order to see what we read from your receipt and submit it for review. Nothing has been sent yet.</div> : null}
        {o.status === "AWAITING_PAYMENT" && !attached ? <div>Transfer {o.amountLabel} using the reference above, then upload your receipt.</div> : null}
        {o.status === "AWAITING_PAYMENT" || o.status === "SUBMITTED" ? (
          <Link href={`/settings/membership/order/${o.id}`} className="mt-1 inline-flex h-10 items-center justify-center rounded-lg bg-ocean px-4 text-body-sm font-bold text-on-ocean">
            {attached ? "Submit receipt" : o.status === "AWAITING_PAYMENT" ? "Payment instructions" : "View order"}
          </Link>
        ) : null}
      </div>
    </Callout>
  );
}
