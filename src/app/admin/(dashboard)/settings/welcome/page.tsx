import Link from "next/link";
import { AdminPage, Panel } from "@/components/features/admin/admin-ui";
import { WelcomeCoverManager } from "@/components/features/admin/welcome-covers";
import { cn } from "@/lib/cn";
import { requireAdminPage } from "@/server/admin/authz";
import { listWelcomeCovers } from "@/server/welcome/admin-covers";

export const metadata = { title: "Welcome Screen · Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin → App Settings → Welcome Screen (docs/ARCHITECTURE.md §26): the covers, their schedules and the preview.
 *
 * The preview frames are real iframes at real device dimensions, scaled down with a transform. An iframe has its
 * own viewport, so the breakpoints inside resolve for the device being previewed rather than for the laptop it is
 * being looked at on — the preview therefore proves the art direction instead of claiming it.
 */

/** The frames offered. Widths are CSS pixels, chosen to sit either side of the 768 and 1280 breakpoints. */
const FRAMES = [
  { key: "mobile", label: "Mobile", width: 390, height: 844, note: "iPhone-sized · under 768px, takes the Mobile image" },
  { key: "tablet", label: "Tablet", width: 834, height: 1112, note: "iPad portrait · 768–1279px, takes the Tablet image" },
  { key: "tablet-landscape", label: "Tablet landscape", width: 1180, height: 820, note: "iPad landscape · still under 1280px, takes the Tablet image" },
  { key: "desktop", label: "Desktop", width: 1440, height: 900, note: "Laptop · 1280px and wider, takes the Desktop image" },
] as const;

const FRAME_HEIGHT = 420;

export default async function AdminWelcomeCoverPage({ searchParams }: { searchParams: Promise<{ preview?: string; device?: string; guides?: string }> }) {
  await requireAdminPage("welcome-cover.manage");
  const { preview, device, guides } = await searchParams;
  const list = await listWelcomeCovers();
  const previewing = preview ? list.covers.find((c) => c.id === preview) : undefined;
  const frame = FRAMES.find((f) => f.key === device) ?? FRAMES[0];
  const showGuides = guides === "1";
  const hrefFor = (coverId: string, key: string, g: boolean) => `/admin/settings/welcome?preview=${coverId}&device=${key}${g ? "&guides=1" : ""}`;
  const scale = FRAME_HEIGHT / frame.height;

  return (
    <AdminPage
      title="Welcome Screen"
      description="The background of the sign-in screen. Upload, preview, then publish — nothing you upload here changes the live site until you publish it."
      backHref={{ href: "/admin/settings", label: "Settings" }}
    >
      <div className="flex flex-col gap-5">
        {previewing ? (
          <Panel
            title={`Preview — ${previewing.name}`}
            description="The real Welcome Screen and auth card, at real device sizes. Sign-in is live in this frame, so don't press anything you don't mean."
            actions={
              <Link href="/admin/settings/welcome" className="text-body-sm font-medium text-text-secondary underline underline-offset-2">
                Close
              </Link>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {FRAMES.map((f) => (
                  <Link
                    key={f.key}
                    href={hrefFor(previewing.id, f.key, showGuides)}
                    aria-current={f.key === frame.key ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9.5 items-center rounded-md px-3.5 text-body font-medium",
                      f.key === frame.key ? "bg-primary text-on-primary" : "bg-surface-muted text-text",
                    )}
                  >
                    {f.label}
                  </Link>
                ))}
                <Link
                  href={hrefFor(previewing.id, frame.key, !showGuides)}
                  className={cn("inline-flex h-9.5 items-center rounded-md px-3.5 text-body font-medium", showGuides ? "bg-surface-muted text-text" : "text-text-secondary")}
                >
                  {showGuides ? "Hide safe area" : "Show safe area"}
                </Link>
              </div>
              <p className="text-caption text-text-secondary">{frame.note}</p>

              {/* The frame scrolls inside this box rather than widening the page: a 1440px desktop frame at this
                  scale is still 672px across, which is wider than the admin column on a phone. */}
              <div className="overflow-x-auto">
                <div className="relative shrink-0 overflow-hidden rounded-xl border border-border bg-black" style={{ width: frame.width * scale, height: FRAME_HEIGHT }}>
                  <iframe
                    title={`${previewing.name} on ${frame.label}`}
                    src={`/admin/welcome-preview/${previewing.id}`}
                    width={frame.width}
                    height={frame.height}
                    className="origin-top-left border-0"
                    style={{ transform: `scale(${scale})` }}
                  />
                  {showGuides ? (
                    // Admin-only guide. Nothing draws this on the live screen; it is here to show where a phone's
                    // rounded corners and home indicator will sit over the artwork.
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                      <div className="absolute inset-x-[5%] inset-y-[4%] rounded-lg border border-dashed border-white/50" />
                      <div className="absolute inset-x-0 bottom-0 h-[4%] bg-white/10" />
                      <div className="absolute inset-x-0 top-0 h-[5%] bg-white/10" />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Panel>
        ) : null}

        <WelcomeCoverManager initial={list} previewDevice={frame.key} previewGuides={showGuides} />
      </div>
    </AdminPage>
  );
}
