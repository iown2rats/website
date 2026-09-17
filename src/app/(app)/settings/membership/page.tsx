import { PlusHeroTag } from "@/components/ui/badge";
import { Callout } from "@/components/ui/alert";
import { CheckIcon } from "@/components/ui/icons";
import { ListGroup, OceanCard } from "@/components/ui/surface";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { getMembership } from "@/server/entitlements/presentation";

export const metadata = { title: "Membership" };
export const dynamic = "force-dynamic";

/*
 * Prototype "Membership": ocean hero with the THUNDI PLUS tag, a perks list, three plan cards and a CTA. Perks are
 * the approved entitlements (docs/ARCHITECTURE.md §12.1), not the prototype's older list. Pricing is not approved
 * and no payment provider exists, so plan cards show names only and the CTA states that honestly; nothing here
 * can start or fake a purchase.
 */
export default async function MembershipPage() {
  const actor = await requireActiveUser();
  const m = await getMembership(actor);
  const perks: [string, string][] = [
    ["See who likes you", "Full profiles in Likes You instead of blurred placeholders"],
    ["90 likes a day", "Instead of 30, in every rolling 24 hours"],
    ["Message any time", "No 9-minute wait between messages to your matches"],
    ["Invisible Mode", "Only people you like can find you in Discover"],
    ["Advanced filters", "Height and education"],
    ["Undo your last Pass", "Bring back the person you just skipped"],
    ["2 Boosts a week", "Be seen sooner in Discover for 30 minutes"],
  ];
  const periodEnd = m.periodEnd ? new Date(m.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  return (
    <PageOverlay title="Membership" backHref="/profile">
      <OceanCard premium>
        <div><PlusHeroTag /></div>
        <h2 className="text-[24px] font-extrabold leading-[1.15] tracking-[-.025em] text-on-ocean">{m.tier === "PLUS" ? "You're on Thundi Plus." : "More of what matters. Nothing you don't need."}</h2>
        <p className="text-body-sm leading-normal text-on-ocean-muted">
          {m.tier === "PLUS"
            ? periodEnd
              ? `${m.cancelAtPeriodEnd ? "Plus ends" : "Renews"} on ${periodEnd}${m.planName ? ` · ${m.planName}` : ""}.`
              : "Plus is active on your account."
            : "Dating on Thundi stays free. Plus adds a few quiet advantages."}
        </p>
      </OceanCard>

      <ListGroup>
        {perks.map(([label, sub]) => (
          <div key={label} className="flex items-center gap-3.5 px-4.5 py-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-muted text-ocean"><CheckIcon size={18} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <div className="text-body font-bold text-text">{label}</div>
              <div className="text-caption-sm text-text-secondary">{sub}</div>
            </div>
          </div>
        ))}
      </ListGroup>

      {m.tier === "FREE" ? (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            {m.plans.map((p) => (
              <div key={p.code} className="flex flex-col items-center gap-1 rounded-2xl border-[1.5px] border-border bg-surface px-3 py-4 text-center">
                <span className="text-micro font-bold text-text-secondary">{p.name}</span>
                <span className="text-body font-extrabold tracking-[-.02em] text-text">{p.price ?? "Price TBA"}</span>
                <span className="text-[11px] text-text-secondary">{p.intervalDays} days</span>
              </div>
            ))}
          </div>
          <Callout tone="info" title="Plus isn't on sale yet">Pricing in MVR and payments are being finalised. Nothing is charged today, and there are no upgrade prompts elsewhere in the app.</Callout>
        </>
      ) : (
        <Callout tone="info" title="Managing your membership">Billing and cancellation will be handled here once payments launch. Until then nothing changes on your account.</Callout>
      )}
      <p className="text-center text-micro leading-relaxed text-text-secondary">Billed in MVR when available. Cancel any time.</p>
    </PageOverlay>
  );
}
