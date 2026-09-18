import { MembershipPlans } from "@/components/features/settings/membership-client";
import { cn } from "@/lib/cn";
import { PlusHeroTag, PlusTag } from "@/components/ui/badge";
import { CheckIcon } from "@/components/ui/icons";
import { ListGroup, OceanCard, SectionLabel } from "@/components/ui/surface";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { getMembership } from "@/server/entitlements/presentation";

export const metadata = { title: "Membership" };
export const dynamic = "force-dynamic";

/*
 * Prototype "Membership": ocean hero with the MELLOCRUSH PLUS tag, a perks list, plan cards and a CTA. Perks are the
 * approved entitlements (docs/ARCHITECTURE.md §12.1). Plans, prices and whether anything is for sale come from the
 * admin-managed rows (§12.10); buying is a bank transfer confirmed by an admin (§12.11), so the CTA creates an order
 * and nothing on this screen can grant Plus.
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
        <h2 className="text-[24px] font-extrabold leading-[1.15] tracking-[-.025em] text-text">{m.tier === "PLUS" ? "You're on Mellocrush Plus." : "More of what matters. Nothing you don't need."}</h2>
        <p className="text-body-sm leading-normal text-text-secondary">
          {m.tier === "PLUS"
            ? periodEnd
              ? `${m.cancelAtPeriodEnd ? "Plus ends" : "Renews"} on ${periodEnd}${m.planName ? ` · ${m.planName}` : ""}.`
              : "Plus is active on your account."
            : "Dating on Mellocrush stays free. Plus adds a few quiet advantages."}
        </p>
      </OceanCard>

      <section aria-labelledby="compare-heading" className="flex flex-col gap-2">
        <SectionLabel id="compare-heading">Mellocrush Free and Mellocrush Plus</SectionLabel>
        <div className="overflow-hidden rounded-3xl glass-card">
          <table className="w-full table-fixed border-collapse text-caption">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="w-[46%] px-4 py-3 text-label uppercase text-text-secondary">Feature</th>
                <th scope="col" className={cn("px-3 py-3 text-label uppercase", m.tier === "FREE" ? "text-text" : "text-text-secondary")}>Free{m.tier === "FREE" ? <span className="sr-only"> (your plan)</span> : null}</th>
                <th scope="col" className="px-3 py-3 text-label uppercase text-text"><span className="inline-flex items-center gap-1.5">Plus{m.tier === "PLUS" ? <span className="sr-only"> (your plan)</span> : null}<PlusTag size="xs" /></span></th>
              </tr>
            </thead>
            <tbody>
              {m.comparison.map((row) => (
                <tr key={row.capability} className="border-b border-border last:border-0 align-top">
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold text-text">{row.capability}</th>
                  <td className="px-3 py-2.5 text-text-secondary">{row.free}</td>
                  <td className="px-3 py-2.5 font-semibold text-text">{row.plus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-caption-sm leading-relaxed text-text-secondary">Everything that keeps you safe is the same on both: blocking, reporting, contact blocking and the anti-spam limits never depend on your plan.</p>
      </section>

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

      <MembershipPlans membership={m} />
      <p className="text-center text-micro leading-relaxed text-text-secondary">Billed in MVR by bank transfer. Plus never renews automatically.</p>
    </PageOverlay>
  );
}
