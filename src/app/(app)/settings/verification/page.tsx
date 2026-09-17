import { cn } from "@/lib/cn";
import { Callout } from "@/components/ui/alert";
import { ListGroup } from "@/components/ui/surface";
import { PageOverlay } from "@/components/layout/page-overlay";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";

export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

/*
 * Prototype "Verification": badge disc, title/subtitle by state, three steps (phone, selfie, review) and a CTA.
 * Driven by the real Verification status. Phone is done for every account (OTP sign-in). The selfie and review
 * steps arrive with the Phase 10 verification workflow, so the CTA says that instead of advancing anything —
 * nobody is marked verified here.
 */
export default async function VerificationPage() {
  const actor = await requireActiveUser();
  const v = await getDb().verification.findUnique({ where: { userId: actor.userId }, select: { status: true, rejectionReason: true } });
  const status = v?.status ?? "NONE";
  // Steps completed: phone (every signed-in account), selfie (submitted / under review), review (verified).
  const doneCount = status === "VERIFIED" ? 3 : status === "UNDER_REVIEW" || status === "SELFIE_SUBMITTED" ? 2 : status === "NONE" ? 0 : 1;
  const title = status === "VERIFIED" ? "You're verified" : doneCount === 2 ? "Under review" : "Get verified";
  const subtitle =
    status === "VERIFIED"
      ? "Your badge is live. Thank you for keeping Thundi trustworthy."
      : doneCount === 2
        ? "Our team checks your selfie against your photos within 24 hours."
        : status === "REJECTED"
          ? `Your last attempt wasn't approved${v?.rejectionReason ? `: ${v.rejectionReason}` : ""}. You can try again.`
          : "A verified badge shows people you are who you say you are. Takes about a minute.";
  const steps: [string, string][] = [
    ["Verify phone number", "Confirms your +960 number"],
    ["Verify selfie", "A quick pose check, never shown publicly"],
    ["Profile review", "Our team checks your photos within 24 h"],
  ];
  return (
    <PageOverlay title="Verification" backHref="/profile">
      <div className="flex flex-col items-center gap-3 py-2.5 text-center">
        <span className={cn("grid size-21 place-items-center rounded-full", status === "VERIFIED" ? "bg-aqua-soft" : "bg-surface-muted")} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill={status === "VERIFIED" ? "#18C7C8" : "var(--border)"}><path d="M12 2l2.4 2.1 3.1-.4 1 3 2.9 1.3-.6 3.1 1.9 2.5-1.9 2.5.6 3.1-2.9 1.3-1 3-3.1-.4L12 22l-2.4-2.1-3.1.4-1-3-2.9-1.3.6-3.1L1.3 12l1.9-2.5-.6-3.1 2.9-1.3 1-3 3.1.4z" /><path d="M8.5 12l2.3 2.3 4.7-4.8" stroke="#063B4C" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h2 className="text-[22px] font-extrabold tracking-[-.02em] text-text">{title}</h2>
        <p className="max-w-80 text-body-sm leading-normal text-text-secondary">{subtitle}</p>
      </div>
      <ListGroup>
        {steps.map(([label, sub], i) => {
          const done = i < doneCount;
          const active = i === doneCount;
          return (
            <div key={label} className="flex items-center gap-3.5 px-4.5 py-4">
              <span className={cn("grid size-8.5 shrink-0 place-items-center rounded-full text-caption font-extrabold", done ? "bg-primary text-ocean" : active ? "bg-aqua-soft text-ocean" : "bg-surface-muted text-text-secondary")}>{done ? "✓" : i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-body font-bold text-text">{label}</div>
                <div className="text-caption-sm text-text-secondary">{sub}</div>
              </div>
              <span className="text-micro font-bold text-primary-pressed">{done ? "Done" : active ? "Next" : ""}</span>
            </div>
          );
        })}
      </ListGroup>
      {status !== "VERIFIED" ? (
        <Callout tone="info" title="Selfie verification is coming">Your phone is verified. Selfie verification and profile review open in an upcoming update; nothing else is needed from you right now.</Callout>
      ) : null}
    </PageOverlay>
  );
}
