import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import type { AdminReceiptVerificationDto } from "@/server/billing/receipt-dto";
import type { CheckKey, ReceiptCheck } from "@/server/ocr/types";
import { Callout } from "@/components/ui/alert";
import { CheckStateIcon } from "@/components/features/settings/receipt-check-card";
import { KeyValueList, Mono, StatusPill } from "./admin-ui";
import { RerunOcrButton } from "./rerun-ocr-button";

/*
 * The admin's view of the OCR check (docs/ARCHITECTURE.md §12.14): every field the parser recovered, every check with
 * its state and note, the duplicate warning with a link to the other order, the attempt history and "Re-run OCR". It
 * sits beside the receipt image, never instead of it, and it decides nothing: Approve and Reject stay human.
 */
const CHECK_LABELS: Record<CheckKey, string> = {
  bank: "Bank",
  status: "Transfer status",
  amount: "Amount",
  currency: "Currency",
  recipient: "Recipient account",
  reference: "Mellocrush reference in remark",
  transactionId: "Bank transaction number",
  duplicate: "Duplicate transaction",
  date: "Transfer date",
};

const STATE_LABELS: Record<ReceiptCheck["state"], string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  UNCERTAIN: "Review",
  NOT_FOUND: "Not detected",
  NOT_APPLICABLE: "n/a",
};

const ORDER: CheckKey[] = ["status", "amount", "currency", "recipient", "reference", "transactionId", "duplicate", "date", "bank"];

function CheckRow({ label, check }: { label: string; check: ReceiptCheck }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-border py-2.5 last:border-0">
      <CheckStateIcon state={check.state} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body-sm font-medium text-text">{label}</span>
          <span className="text-caption text-text-secondary">{STATE_LABELS[check.state]}</span>
        </div>
        {check.detected !== undefined || check.expected ? (
          <div className="text-caption text-text">
            {check.detected !== undefined ? <>Detected: <Mono>{check.detected ?? "—"}</Mono></> : null}
            {check.expected ? <> · Expected: <Mono>{check.expected}</Mono></> : null}
          </div>
        ) : null}
        {check.note ? <div className="text-caption text-text-secondary">{check.note}</div> : null}
      </div>
    </li>
  );
}

export function ReceiptCheckPanel({ orderId, verification, history, canRerun, children }: { orderId: string; verification: AdminReceiptVerificationDto | null; history: AdminReceiptVerificationDto[]; canRerun: boolean; children?: ReactNode }) {
  if (!verification) return <p className="text-body-sm text-text-secondary">No receipt has been read for this order yet.</p>;
  const v = verification;
  const duplicate = v.checks.duplicate;
  const dupMeta = duplicate?.meta ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={v.outcome} />
          <span className="text-caption text-text-secondary">
            Attempt {v.attempt} · {v.parserVersion} · {formatDateTime(v.createdAt)}
            {v.triggeredById ? " · re-run by admin" : ""}
          </span>
        </div>
        {canRerun ? <RerunOcrButton orderId={orderId} /> : null}
      </div>
      {duplicate?.state === "MISMATCH" ? (
        <Callout tone="warning" title="Possible duplicate transfer">
          {duplicate.note}
          {dupMeta && typeof dupMeta.orderId === "string" ? (
            <>
              {" "}
              <Link href={`/admin/payments/${dupMeta.orderId}`} className="font-medium underline">
                Open order {String(dupMeta.reference ?? "")}
              </Link>
              . This is a review signal, not a verdict: the customer may have uploaded the same slip twice.
            </>
          ) : null}
        </Callout>
      ) : null}
      {v.outcome === "OCR_FAILED" ? <Callout tone="info" title="The receipt could not be read">The OCR engine did not return text for this image. That says nothing about the payment; compare the image with the order by hand.</Callout> : null}
      {v.outcome === "UNSUPPORTED_RECEIPT" ? <Callout tone="info" title="Not a receipt we recognise">No supported bank, amount, account or transaction number was found. Check the image by hand.</Callout> : null}
      {children}
      <ul className="flex flex-col" aria-label="Receipt checks">
        {ORDER.map((key) => (v.checks[key] ? <CheckRow key={key} label={CHECK_LABELS[key]} check={v.checks[key]} /> : null))}
      </ul>
      <KeyValueList
        items={[
          { label: "Detected bank", value: v.detectedBank ?? "—" },
          { label: "Transaction status", value: v.transactionStatus },
          { label: "Detected amount", value: v.amountLabel ?? "—" },
          { label: "Detected currency", value: v.currency ?? "—" },
          { label: "Transaction number", value: v.transactionId ?? "—", mono: true },
          { label: "Transfer date", value: v.transactionAt ? `${formatDateTime(v.transactionAt)}${v.transactionDateRaw ? ` (read as “${v.transactionDateRaw}”)` : ""}` : v.transactionDateRaw ?? "—" },
          { label: "Recipient (read)", value: [v.recipientName, v.recipientAccount].filter(Boolean).join(" · ") || "—" },
          { label: "Sender (read)", value: v.senderName ?? "—" },
          { label: "Remark (read)", value: v.remarks ?? "—" },
          { label: "Engine", value: `${v.engine}${v.ocrConfidence !== null ? ` · confidence ${v.ocrConfidence}` : ""}${v.durationMs !== null ? ` · ${v.durationMs} ms` : ""}` },
        ]}
      />
      {history.length > 1 ? (
        <details className="text-caption text-text-secondary">
          <summary className="cursor-pointer font-medium text-text">Earlier readings ({history.length - 1})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {history.slice(1).map((h) => (
              <li key={h.id}>
                Attempt {h.attempt} · {h.parserVersion} · {h.outcome.replace(/_/g, " ").toLowerCase()} · {formatDateTime(h.createdAt)}{h.triggeredById ? " · re-run" : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
