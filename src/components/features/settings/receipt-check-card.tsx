import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ReceiptCheckDto, CustomerCheckDto } from "@/server/billing/receipt-dto";
import type { CalloutTone } from "@/components/ui/alert";
import { Callout } from "@/components/ui/alert";
import { CheckIcon, CloseIcon, InfoIcon } from "@/components/ui/icons";

/*
 * The customer's view of the OCR check (docs/ARCHITECTURE.md §12.14). Fixed wording per outcome and per check; the
 * only values shown are the detected amount/currency/status and this order's expected values. Never raw OCR text,
 * never anything about another order. An unreadable receipt is worded as OUR limitation, not a failed payment.
 */
const TONES: Record<ReceiptCheckDto["outcome"], CalloutTone> = {
  MATCH: "success",
  PARTIAL_MATCH: "info",
  REVIEW_REQUIRED: "warning",
  MISMATCH: "danger",
  OCR_FAILED: "info",
  UNSUPPORTED_RECEIPT: "info",
};

export function CheckStateIcon({ state, className }: { state: CustomerCheckDto["state"]; className?: string }) {
  const base = "inline-grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold";
  if (state === "MATCH") return <span className={cn(base, "bg-success/15 text-success", className)} aria-label="Match"><CheckIcon size={12} /></span>;
  if (state === "MISMATCH") return <span className={cn(base, "bg-danger/10 text-danger", className)} aria-label="Mismatch"><CloseIcon size={12} /></span>;
  if (state === "UNCERTAIN") return <span className={cn(base, "bg-warning/15 text-warning", className)} aria-label="Needs review"><InfoIcon size={12} /></span>;
  return <span className={cn(base, "bg-surface-muted text-text-secondary", className)} aria-label="Not detected">—</span>;
}

export function ReceiptCheckCard({ check, actions }: { check: ReceiptCheckDto; actions?: ReactNode }) {
  return (
    <Callout tone={TONES[check.outcome]} title={check.title} role="status" data-outcome={check.outcome}>
      <div className="flex flex-col gap-2.5">
        <p>{check.summary}</p>
        {check.checks.length > 0 ? (
          <ul className="flex flex-col gap-1.5" aria-label="Receipt checks">
            {check.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <CheckStateIcon state={c.state} className="mt-px" />
                <div className="min-w-0 flex-1 text-caption leading-snug">
                  <span className="font-bold text-text">{c.label}</span>
                  {c.detected || c.expected ? (
                    <span className="text-text"> · {c.detected ? `Detected ${c.detected}` : "Not detected"}{c.expected && c.state !== "MATCH" ? ` · Expected ${c.expected}` : ""}</span>
                  ) : null}
                  {c.message ? <div className="text-text-secondary">{c.message}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {actions ? <div className="flex flex-col gap-2 pt-1">{actions}</div> : null}
      </div>
    </Callout>
  );
}
