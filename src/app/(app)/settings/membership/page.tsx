import type { ReactNode } from "react";
import { MembershipPlans } from "@/components/features/settings/membership-client";
import { cn } from "@/lib/cn";
import { PlusLockup, PlusMark } from "@/components/brand/logo";
import { PlusHeroTag } from "@/components/ui/badge";
import { BoltIcon, EyeIcon, FilterIcon, HeartIcon, PeopleIcon, SendIcon, ShieldIcon, UndoIcon } from "@/components/ui/icons";
import { OceanCard } from "@/components/ui/surface";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { getMembership } from "@/server/entitlements/presentation";
import type { ComparisonCell, ComparisonRow } from "@/server/entitlements/presentation";

export const metadata = { title: "Membership" };
export const dynamic = "force-dynamic";

/*
 * "Membership": the hero with the Plus lockup, the Free/Plus table, what everyone gets, plans and the CTA. Perks are
 * the approved entitlements (docs/ARCHITECTURE.md §12.1). Plans, prices and whether anything is for sale come from
 * the admin-managed rows (§12.10); buying is a bank transfer confirmed by an admin (§12.11), so the CTA creates an
 * order and nothing on this screen can grant Plus.
 *
 * The table carries only what DIFFERS between the tiers. Rows reading "Included / Included" made it a third longer
 * while answering nothing, so what both tiers get is said once underneath instead.
 */

/** One icon per row, keyed on the row's identity rather than its label, so rewording copy cannot silently drop it. */
const ROW_ICONS: Record<ComparisonRow["key"], ReactNode> = {
  likes: <HeartIcon size={18} />,
  "incoming-likes": <PeopleIcon size={18} />,
  invisible: <EyeIcon size={18} />,
  boosts: <BoltIcon size={18} />,
  filters: <FilterIcon size={18} />,
  undo: <UndoIcon size={18} />,
  intro: <SendIcon size={18} />,
};

/**
 * A cell. "Included" is drawn as the Plus mark rather than the word, which is what makes the Plus column read as a
 * single gold run down the table; the accessible name still says "Included", because a mark is not a word.
 */
function Cell({ cell, emphasis }: { cell: ComparisonCell; emphasis: boolean }) {
  if (cell.kind === "excluded") return <span className="text-text-muted" aria-label="Not included">—</span>;
  if (cell.kind === "included") return <PlusMark size={22} title="Included" />;
  return <span className={cn("text-balance", emphasis ? "font-semibold text-sand" : "text-text-secondary")}>{cell.text}</span>;
}

export default async function MembershipPage() {
  const actor = await requireActiveUser();
  const m = await getMembership(actor);
  const periodEnd = m.periodEnd ? new Date(m.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const isPlus = m.tier === "PLUS";

  return (
    <PageOverlay title="Membership" backHref="/profile">
      <OceanCard premium>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pb-1">
            <div><PlusHeroTag /></div>
            {isPlus ? (
              <h2 className="text-h2 text-text">You&apos;re on Mellocrush Plus.</h2>
            ) : (
              <h2 className="text-h2 text-text">
                More of what matters.
                <br />
                <span className="text-sand">Nothing you don&apos;t need.</span>
              </h2>
            )}
            <p className="text-body-sm leading-normal text-text-secondary">
              {isPlus
                ? periodEnd
                  ? // Never "Renews": Plus is bought by bank transfer and never renews automatically (see the footer).
                    `Plus active until ${periodEnd}${m.planName ? ` · ${m.planName}` : ""}.`
                  : "Plus is active on your account."
                : "Dating on Mellocrush stays free. Plus adds a few quiet advantages."}
            </p>
          </div>
          {/* Hidden on the narrowest phones, where the headline needs the whole width more than the lockup does. */}
          <PlusLockup className="mt-0.5 hidden shrink-0 min-[360px]:block" />
        </div>
      </OceanCard>

      <section aria-labelledby="compare-heading" className="relative">
        <h2 id="compare-heading" className="sr-only">Mellocrush Free compared with Mellocrush Plus</h2>
        <div className="overflow-hidden rounded-3xl glass-card">
          <table className="w-full table-fixed border-collapse text-caption">
            <thead>
              <tr className="text-left">
                <th scope="col" className="w-[52%] px-3.5 pb-2.5 pt-3.5 text-label uppercase text-text-secondary">Feature</th>
                <th scope="col" className="w-[22%] px-1 pb-2.5 pt-3.5 text-center text-label uppercase text-text-secondary">
                  Free{!isPlus ? <span className="sr-only"> (your plan)</span> : null}
                </th>
                {/* The Plus column is one tinted panel from header to last row: a rounded, gold-edged block that the
                    rows sit inside, rather than a tint repeated per cell where the seams would show. */}
                <th scope="col" className="relative w-[26%] px-1 pb-2.5 pt-3.5 text-center text-label uppercase text-text">
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -bottom-px rounded-t-2xl border border-b-0 border-sand/35 bg-sand/8" />
                  <span className="relative inline-flex items-center gap-1.5">
                    Plus{isPlus ? <span className="sr-only"> (your plan)</span> : null}
                    <PlusMark size={14} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {m.comparison.map((row, i) => {
                const last = i === m.comparison.length - 1;
                return (
                  <tr key={row.key} className="align-middle">
                    <th scope="row" className={cn("px-3.5 py-3 text-left font-medium text-text", !last && "border-b border-border")}>
                      <span className="flex items-center gap-2.5">
                        <span aria-hidden="true" className="shrink-0 text-primary">{ROW_ICONS[row.key]}</span>
                        <span className="min-w-0 text-caption">{row.capability}</span>
                      </span>
                    </th>
                    <td className={cn("px-1 py-3 text-center", !last && "border-b border-border")}>
                      <Cell cell={row.free} emphasis={false} />
                    </td>
                    <td className="relative px-1 py-3 text-center">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "pointer-events-none absolute inset-x-0 -top-px border-x border-sand/35 bg-sand/8",
                          last ? "bottom-0 rounded-b-2xl border-b" : "bottom-0",
                        )}
                      />
                      <span className="relative inline-flex items-center justify-center">
                        <Cell cell={row.plus} emphasis />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center gap-3.5 rounded-3xl glass-card px-4 py-3.5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <ShieldIcon size={21} />
        </span>
        <div className="min-w-0">
          <div className="text-body font-medium text-text">Always included for everyone</div>
          <p className="text-caption leading-relaxed text-text-secondary">{m.alwaysIncluded}</p>
        </div>
      </div>

      <MembershipPlans membership={m} />
      <p className="text-center text-micro leading-relaxed text-text-secondary">Billed in MVR by bank transfer. Plus never renews automatically.</p>
    </PageOverlay>
  );
}
