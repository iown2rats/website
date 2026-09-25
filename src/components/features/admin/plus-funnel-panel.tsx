import type { FunnelRow, PlusFunnelReport } from "@/server/analytics/plus-funnel";
import { Panel } from "./admin-ui";

/*
 * Plus conversion (docs/ARCHITECTURE.md §12.19). Raw numbers first, always: the member base is small, so a rate is
 * never shown without the two counts it came from ("3 / 10 (30%)"), and nothing here pretends to be significant.
 */
const SURFACE_LABELS: Record<FunnelRow["surface"], string> = {
  all: "All promotions",
  likes_you: "Likes You",
  discover_likes: "Discover (likes)",
  daily_limit: "Daily like limit",
  photo_lock: "Locked photos",
  undo: "Undo",
  membership: "Membership page",
  checkout_recovery: "Checkout reminder",
  super_like: "Super Like",
  unattributed: "Unattributed",
};

/** "3 / 10 (30%)", or just the count when there is nothing to divide by. */
export function ratio(part: number, whole: number): string {
  if (whole <= 0) return String(part);
  return `${part} / ${whole} (${Math.round((part / whole) * 100)}%)`;
}

function Row({ row, strong = false }: { row: FunnelRow; strong?: boolean }) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className={strong ? "px-1 py-2 text-left font-medium text-text" : "px-1 py-2 text-left font-normal text-text-secondary"}>{SURFACE_LABELS[row.surface]}</th>
      <td className="px-1 py-2 text-right tabular-nums">{row.viewed}</td>
      <td className="px-1 py-2 text-right tabular-nums">{ratio(row.clicked, row.viewed)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{row.checkouts}</td>
      <td className="px-1 py-2 text-right tabular-nums">{ratio(row.receipts, row.checkouts)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{ratio(row.approved, row.checkouts)}</td>
    </tr>
  );
}

export function PlusFunnelPanel({ report, rangeLabel }: { report: PlusFunnelReport; rangeLabel: string }) {
  if (!report.enabled) {
    return (
      <Panel title="Plus conversion" description="Promotion → checkout → approved purchase.">
        <p className="text-body-sm text-text-secondary">Plus funnel analytics is switched off (PLUS_FUNNEL_ANALYTICS). Nothing is being recorded.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Plus conversion"
      description={`Last ${rangeLabel}. Views and taps count distinct members; checkouts, receipts and approvals count orders, credited to the promotion the checkout started from. Small numbers — read them as counts, not as rates.`}
    >
      {report.total.viewed + report.total.checkouts === 0 ? (
        <p className="text-body-sm text-text-secondary">Nothing recorded in this period yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-body-sm">
            <thead>
              <tr className="text-left text-caption text-text-secondary">
                <th scope="col" className="px-1 pb-2 font-normal">Promotion</th>
                <th scope="col" className="px-1 pb-2 text-right font-normal">Seen</th>
                <th scope="col" className="px-1 pb-2 text-right font-normal">Tapped / seen</th>
                <th scope="col" className="px-1 pb-2 text-right font-normal">Checkouts</th>
                <th scope="col" className="px-1 pb-2 text-right font-normal">Receipts / checkouts</th>
                <th scope="col" className="px-1 pb-2 text-right font-normal">Approved / checkouts</th>
              </tr>
            </thead>
            <tbody>
              <Row row={report.total} strong />
              {report.rows.map((row) => <Row key={row.surface} row={row} />)}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
