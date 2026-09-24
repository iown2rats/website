import { ANALYTICS } from "@/config/product";
import { AdminPage, DefinitionList, FilterLinks, Panel, StatCard, StatGrid } from "@/components/features/admin/admin-ui";
import { BreakdownBars, TimeSeries } from "@/components/features/admin/analytics-charts";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/server/admin/authz";
import { maybePurgeExpiredAnalytics } from "@/server/analytics/ingest";
import { getAnalyticsReport, parseRange, RANGES, type AnalyticsRange } from "@/server/analytics/report";
import { PlusFunnelPanel } from "@/components/features/admin/plus-funnel-panel";
import { getPlusFunnelReport } from "@/server/analytics/plus-funnel";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const MALDIVES_TZ = "Indian/Maldives";

/** Bucket labels in Maldives time, because that is the day the operator's other numbers are counted in. */
function labelFor(range: AnalyticsRange): (iso: string) => string {
  const options: Intl.DateTimeFormatOptions =
    range === "24h" ? { hour: "2-digit", minute: "2-digit", timeZone: MALDIVES_TZ } : { day: "numeric", month: "short", timeZone: MALDIVES_TZ };
  return (iso) => new Intl.DateTimeFormat("en-GB", options).format(new Date(iso));
}

const SOURCE_LABELS: Record<string, string> = {
  DIRECT: "Direct or unknown",
  GOOGLE: "Google",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  TWITTER: "X / Twitter",
  SNAPCHAT: "Snapchat",
  YOUTUBE: "YouTube",
  WHATSAPP: "WhatsApp",
  TELEGRAM: "Telegram",
  LINKEDIN: "LinkedIn",
  REDDIT: "Reddit",
  BING: "Bing",
  EMAIL: "Email",
  OTHER: "Other site",
};

const DEVICE_LABELS: Record<string, string> = { MOBILE: "Mobile", TABLET: "Tablet", DESKTOP: "Desktop", UNKNOWN: "Unknown" };

const DEFINITIONS: Record<string, string> = {
  "Live now": `Distinct visitors whose last recorded activity is within ${Math.round(ANALYTICS.liveWithinMs / 60_000)} minutes.`,
  "Visitors today": "Distinct browsers that started a visit since 00:00 Maldives time. One person on a phone and a laptop counts twice; one person in five tabs counts once.",
  Sessions: `One visit. A visit ends after ${Math.round(ANALYTICS.sessionIdleMs / 60_000)} minutes of inactivity, so returning later the same day starts a new one. Tabs open at the same time share a visit.`,
  "Page views": "Pages actually seen. A refresh and a move to a new page each count; a re-render does not.",
  "Sign-ups": "Member accounts created in the period, counted from the accounts themselves rather than from analytics.",
  Conversion: "Sign-ups divided by visitors. Approximate: a person who visits on one device and signs up on another is two visitors and one sign-up.",
  "New vs returning": "New means this browser had no visitor record when the visit began. Clearing cookies or a private window makes a returning visitor look new.",
  "Signed in vs anonymous": "Whether a visit had a valid session cookie. Identity is only ever read from that cookie and never guessed at.",
  "Direct or unknown": "No referrer was offered. That covers a typed address, a bookmark, and every case where the browser, an in-app webview or a privacy setting suppressed it — so this figure is a floor for other sources, not a measure of intent.",
  Country: "Two-letter country from the hosting edge, where it offers one. No city, no region, no coordinates, and the address it was derived from is never stored.",
  Pages: "Identifiers in a path are collapsed (a chat shows as /chats/:id), so this never becomes a record of who opened what.",
  Retention: `Raw events are deleted after ${ANALYTICS.retentionDays} days.`,
};

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdminPage("analytics.view");
  const range = parseRange((await searchParams).range);
  const report = await getAnalyticsReport(range);
  // Its own switch and its own table: if either is missing the panel says so and the rest of the page is untouched.
  const plusFunnel = await getPlusFunnelReport(RANGES[range].ms).catch(() => ({ enabled: false }) as const);
  // Retention is enforced by the cron; this is the safety net for a deployment where no scheduler was configured.
  // Gated to once a day, never awaited into the render path's critical work beyond its own bounded batches.
  void maybePurgeExpiredAnalytics().catch(() => {});

  const label = labelFor(range);
  const spec = RANGES[range];
  const w = report.window;

  return (
    <AdminPage
      title="Analytics"
      description={`Visits to the website, counted from live records at ${formatDateTime(report.generatedAt)} (Maldives time). Staff traffic is excluded.`}
      actions={
        <FilterLinks
          label="Range"
          current={range}
          items={(Object.keys(RANGES) as AnalyticsRange[]).map((key) => ({ value: key, label: RANGES[key].label, href: `/admin/analytics?range=${key}` }))}
        />
      }
    >
      <section className="flex flex-col gap-3" aria-labelledby="analytics-now">
        <h2 id="analytics-now" className="text-label uppercase text-text-secondary">
          Right now and today
        </h2>
        <StatGrid className="desktop:grid-cols-5">
          <StatCard label="Live now" value={report.live.visitors} hint={DEFINITIONS["Live now"]} tone={report.live.visitors > 0 ? "attention" : "default"} />
          <StatCard label="Visitors today" value={report.today.visitors} hint={DEFINITIONS["Visitors today"]} />
          <StatCard label="Page views today" value={report.today.pageViews} hint={DEFINITIONS["Page views"]} />
          <StatCard label="Sign-ups today" value={report.today.signups} hint={DEFINITIONS["Sign-ups"]} />
          <StatCard label="Conversion today" value={`${report.today.conversionPct}%`} hint={DEFINITIONS.Conversion} />
        </StatGrid>
        <p className="px-1 text-caption text-text-secondary">
          {report.live.members} of the {report.live.visitors} live {report.live.visitors === 1 ? "visitor is" : "visitors are"} signed in.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="analytics-window">
        <h2 id="analytics-window" className="text-label uppercase text-text-secondary">
          Last {spec.label}
        </h2>
        <StatGrid>
          <StatCard label="Visitors" value={w.visitors} hint={DEFINITIONS["Visitors today"]} />
          <StatCard label="Visits" value={w.sessions} hint={DEFINITIONS.Sessions} />
          <StatCard label="Page views" value={w.pageViews} hint={DEFINITIONS["Page views"]} />
          <StatCard label="Sign-ups" value={w.signups} hint={DEFINITIONS["Sign-ups"]} />
        </StatGrid>
        <Panel title={`Traffic over the last ${spec.label}`} description="Two measures, two charts — never one chart with two scales.">
          <div className="grid grid-cols-1 gap-6 desktop:grid-cols-2">
            <TimeSeries title="Visitors" points={report.series.map((b) => ({ startsAt: b.startsAt, value: b.visitors }))} formatLabel={label} />
            <TimeSeries title="Page views" points={report.series.map((b) => ({ startsAt: b.startsAt, value: b.pageViews }))} formatLabel={label} />
          </div>
        </Panel>
        <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
          <Panel title="New vs returning" description={DEFINITIONS["New vs returning"]}>
            <BreakdownBars
              rows={[
                { key: "New", count: w.newVisitors },
                { key: "Returning", count: w.returningVisitors },
              ]}
              empty="No visits yet in this period."
            />
          </Panel>
          <Panel title="Signed in vs anonymous" description={DEFINITIONS["Signed in vs anonymous"]}>
            <BreakdownBars
              rows={[
                { key: "Signed in", count: w.signedInSessions },
                { key: "Anonymous", count: w.anonymousSessions },
              ]}
              empty="No visits yet in this period."
            />
          </Panel>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="analytics-breakdowns">
        <h2 id="analytics-breakdowns" className="text-label uppercase text-text-secondary">
          Where visits come from
        </h2>
        <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
          <Panel title="Traffic sources" description={DEFINITIONS["Direct or unknown"]}>
            <BreakdownBars rows={report.sources} empty="No visits yet in this period." formatKey={(k) => SOURCE_LABELS[k] ?? k} />
          </Panel>
          <Panel title="Most visited pages" description={DEFINITIONS.Pages}>
            <BreakdownBars rows={report.pages} empty="No page views yet in this period." />
          </Panel>
          <Panel title="Devices">
            <BreakdownBars rows={report.devices} empty="No visits yet in this period." formatKey={(k) => DEVICE_LABELS[k] ?? k} />
          </Panel>
          <Panel title="Country" description={DEFINITIONS.Country}>
            <BreakdownBars rows={report.countries} empty="No visits yet in this period." />
          </Panel>
          <Panel title="Browsers">
            <BreakdownBars rows={report.browsers} empty="No visits yet in this period." />
          </Panel>
          <Panel title="Operating systems">
            <BreakdownBars rows={report.operatingSystems} empty="No visits yet in this period." />
          </Panel>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="analytics-recent">
        <h2 id="analytics-recent" className="text-label uppercase text-text-secondary">
          Recent visits
        </h2>
        <Panel description="A visit shows a member's name only when it carried a valid signed-in session. Everyone else stays an opaque visit reference, which is all that is stored.">
          {report.recent.length === 0 ? (
            <p className="text-caption text-text-secondary">No visits recorded yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-body-sm">
                <thead>
                  <tr className="text-left text-label uppercase text-text-secondary">
                    <th scope="col" className="px-1 py-2 font-medium">Who</th>
                    <th scope="col" className="px-1 py-2 font-medium">Landed on</th>
                    <th scope="col" className="px-1 py-2 font-medium">Source</th>
                    <th scope="col" className="px-1 py-2 font-medium">Device</th>
                    <th scope="col" className="px-1 py-2 text-right font-medium">Pages</th>
                    <th scope="col" className="px-1 py-2 text-right font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recent.map((visit) => (
                    <tr key={visit.sessionId} className="border-t border-border align-top">
                      <td className="px-1 py-2">
                        <span className="flex flex-col">
                          <span className="flex items-center gap-1.5 text-text">
                            {visit.live ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Live now" /> : null}
                            {visit.name ?? <span className="font-mono text-caption text-text-secondary">visit {visit.sessionId.slice(0, 8)}</span>}
                          </span>
                          <span className="text-caption text-text-secondary">
                            {visit.name ? "Signed in" : "Anonymous"} · {visit.isReturning ? "Returning" : "New"}
                            {visit.country ? ` · ${visit.country}` : ""}
                          </span>
                        </span>
                      </td>
                      <td className="px-1 py-2 font-mono text-caption text-text-secondary">{visit.landingPath ?? "—"}</td>
                      <td className="px-1 py-2 text-text-secondary">{SOURCE_LABELS[visit.source] ?? visit.source}</td>
                      <td className="px-1 py-2 text-text-secondary">
                        {DEVICE_LABELS[visit.device] ?? visit.device}
                        {visit.browser ? ` · ${visit.browser}` : ""}
                        {visit.os ? ` · ${visit.os}` : ""}
                      </td>
                      <td className="px-1 py-2 text-right tabular-nums">{visit.pageViews}</td>
                      <td className="px-1 py-2 text-right text-caption text-text-secondary">{formatDateTime(visit.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      <PlusFunnelPanel report={plusFunnel} rangeLabel={spec.label} />

      <Panel title="What is and is not measured">
        <div className="flex flex-col gap-2 text-body-sm text-text-secondary">
          <p>
            <strong className="text-text">Stored:</strong> an opaque visitor and visit reference this server generated, the page path with
            identifiers removed, a coarse device type, a browser and operating-system family, a two-letter country where the hosting edge
            offers one, and the referring site&apos;s host.
          </p>
          <p>
            <strong className="text-text">Never stored:</strong> IP addresses, full browser User-Agent strings, GPS or device location, query
            strings, or any browser fingerprint. Anonymous visitors are never matched to a person — a name appears here only when the visit
            carried a real signed-in session.
          </p>
          <p>Raw events are deleted after {report.retentionDays} days.</p>
        </div>
      </Panel>

      <DefinitionList definitions={DEFINITIONS} />
    </AdminPage>
  );
}
