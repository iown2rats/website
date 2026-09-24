"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cancelPlusOrder, submitPlusOrder } from "@/actions/billing";
import { formatDate, formatDateTime } from "@/lib/format";
import type { OrderDto } from "@/server/billing/orders";
import type { ReceiptCheckDto } from "@/server/billing/receipt-dto";
import { Callout } from "@/components/ui/alert";
import { Button, Spinner } from "@/components/ui/button";
import { ConfirmationDialog, DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { ListGroup } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { ReceiptCheckCard } from "./receipt-check-card";

/*
 * Order screen (docs/ARCHITECTURE.md §12.11, §12.14): bank instructions with copy controls; "I've made the transfer"
 * → receipt upload → "Checking transfer details…" → the check result with Replace slip / Submit for review; then the
 * review / approved / rejected states. The customer never sets a status or a check result; every state shown here is
 * read back from the server after each action. OCR failure never blocks submitting.
 */
function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(`${label} copied`);
    } catch {
      toast.show("Couldn't copy. Long-press the value to select it.");
    }
  };
  return (
    <div className="flex items-center gap-3 px-3.5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-caption-sm text-text-secondary">{label}</div>
        <div className={mono ? "select-all break-all font-mono text-body font-medium tracking-[.02em] text-text" : "select-all text-body font-medium text-text"}>{value}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
        Copy
      </Button>
    </div>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp";

type UploadPhase = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "checking" };

function upload(orderId: string, file: File, onPhase: (p: UploadPhase) => void): Promise<{ order: OrderDto; check: ReceiptCheckDto }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/payments/${encodeURIComponent(orderId)}/receipt`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPhase({ kind: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
    };
    // Bytes are in; the server is now re-encoding, storing and reading the receipt.
    xhr.upload.onload = () => onPhase({ kind: "checking" });
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { order?: OrderDto; check?: ReceiptCheckDto; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.order && body.check) resolve({ order: body.order, check: body.check });
        else reject(new Error(body.error ?? "We couldn't save that receipt. Try again."));
      } catch {
        reject(new Error("We couldn't save that receipt. Try again."));
      }
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export function OrderClient({ initialOrder }: { initialOrder: OrderDto }) {
  const router = useRouter();
  const toast = useToast();
  const [order, setOrder] = useState(initialOrder);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = phase.kind !== "idle";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPhase({ kind: "uploading", pct: 0 });
    try {
      const next = await upload(order.id, file, setPhase);
      setOrder(next.order);
      setUploadOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save that receipt. Try again.");
    } finally {
      setPhase({ kind: "idle" });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submit = async () => {
    setBusy(true);
    const r = await submitPlusOrder({ orderId: order.id }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "Couldn't submit that. Try again.");
    setOrder(r.order);
    toast.show("Receipt sent · payment under review");
    router.refresh();
  };

  const cancel = async () => {
    setBusy(true);
    const r = await cancelPlusOrder({ orderId: order.id }).catch(() => null);
    setBusy(false);
    setCancelOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "Couldn't cancel that.");
    setOrder(r.order);
    toast.show("Order cancelled");
    router.refresh();
  };

  const expired = order.status === "EXPIRED";
  const attached = order.status === "AWAITING_PAYMENT" && order.hasReceipt && order.check;
  return (
    <>
      {order.status === "AWAITING_PAYMENT" && !attached ? (
        <>
          <Callout tone="ocean" title={`Transfer ${order.amountLabel} for ${order.planName}`}>
            Send the exact amount from your bank app and put the payment reference in the remark. Plus activates after we confirm the transfer. This order is valid until {formatDate(order.expiresAt)}.
          </Callout>
          <ListGroup>
            <CopyRow label="Amount" value={order.amountLabel} mono={false} />
            <CopyRow label="Payment reference (put this in the transfer remark)" value={order.reference} />
            <CopyRow label="Account number" value={order.method.accountNumber} />
            <CopyRow label="Account holder" value={order.method.accountHolder} mono={false} />
            <CopyRow label="Bank" value={order.method.bankName} mono={false} />
          </ListGroup>
          {order.method.instructions ? <p className="px-1 text-caption leading-relaxed text-text-secondary">{order.method.instructions}</p> : null}
          <Button variant="plus" size="lg" fullWidth onClick={() => setUploadOpen(true)}>
            I&apos;ve made the transfer
          </Button>
          <Button variant="ghost" size="md" fullWidth onClick={() => setCancelOpen(true)}>
            Cancel this order
          </Button>
        </>
      ) : null}

      {attached && order.check ? (
        <>
          <ReceiptCheckCard
            check={order.check}
            actions={
              <>
                <Button variant="ocean" size="lg" fullWidth onClick={submit} loading={busy}>
                  Submit for review
                </Button>
                <Button variant="muted" size="md" fullWidth onClick={() => setUploadOpen(true)} disabled={busy}>
                  Replace slip
                </Button>
              </>
            }
          />
          <p className="px-1 text-caption leading-relaxed text-text-secondary">
            Every transfer is confirmed by our team before Plus starts, whatever the automatic check says. Receipt attached {formatDateTime(order.receiptAttachedAt)}; nothing has been sent for review yet.
          </p>
          <ListGroup>
            <CopyRow label="Payment reference" value={order.reference} />
            <CopyRow label="Account number" value={order.method.accountNumber} />
          </ListGroup>
          <Button variant="ghost" size="md" fullWidth onClick={() => setCancelOpen(true)} disabled={busy}>
            Cancel this order
          </Button>
        </>
      ) : null}

      {order.status === "SUBMITTED" ? (
        <Callout tone="info" title="Payment under review">
          Receipt submitted {formatDateTime(order.submittedAt)} for <span className="font-mono font-medium">{order.reference}</span> ({order.amountLabel}, {order.planName}). We check every transfer. Plus starts the moment it is confirmed, and you will see it here and in Settings.
        </Callout>
      ) : null}

      {order.status === "APPROVED" ? (
        <Callout tone="success" title="Payment confirmed">
          Thank you. {order.planName} was confirmed {formatDateTime(order.decidedAt)}.{order.periodEnd ? ` Plus runs until ${formatDate(order.periodEnd)}.` : ""}
        </Callout>
      ) : null}

      {order.status === "REJECTED" ? (
        <Callout tone="danger" title="Payment not accepted">
          {order.rejectionReason ? `Reason: ${order.rejectionReason}. ` : ""}Plus was not activated. If you did transfer the money, check that the reference <span className="font-mono font-medium">{order.reference}</span> and amount {order.amountLabel} match, then start a new order from Membership; a new reference will be issued.
        </Callout>
      ) : null}

      {order.status === "CANCELLED" || expired ? <Callout tone="warning" title={expired ? "This order expired" : "This order was cancelled"}>Nothing was charged. Start a new order from Membership when you are ready.</Callout> : null}

      <dl className="grid grid-cols-2 gap-3 px-1 text-caption text-text-secondary">
        <div><dt>Reference</dt><dd className="font-mono font-medium text-text">{order.reference}</dd></div>
        <div><dt>Created</dt><dd className="text-text">{formatDateTime(order.createdAt)}</dd></div>
        <div><dt>Plan</dt><dd className="text-text">{order.planName} · {order.durationDays} days</dd></div>
        <div><dt>Amount</dt><dd className="text-text">{order.amountLabel}</dd></div>
      </dl>

      <ResponsiveDialog open={uploadOpen} onClose={() => (uploading ? undefined : setUploadOpen(false))} label={attached ? "Replace your receipt" : "Upload your receipt"} dismissible={!uploading}>
        <DialogTitle>{attached ? "Replace your receipt" : "Upload your receipt"}</DialogTitle>
        <DialogDescription>A screenshot or photo of the transfer confirmation from your bank app, showing the amount and the reference. JPG, PNG or WebP, up to 8 MB. We read it automatically and show you what we found before you submit.</DialogDescription>
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        {error ? <p role="alert" className="text-caption font-medium text-danger">{error}</p> : null}
        {phase.kind === "checking" ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-aqua-soft px-4 py-3 text-caption font-medium text-on-aqua-soft" role="status" aria-live="polite">
            <Spinner size={16} /> Checking transfer details…
          </div>
        ) : null}
        <div className="flex flex-col gap-2.5 pt-1">
          <Button variant="ocean" fullWidth onClick={() => inputRef.current?.click()} loading={uploading}>
            {phase.kind === "uploading" ? `Uploading ${phase.pct}%` : phase.kind === "checking" ? "Checking…" : "Choose screenshot or photo"}
          </Button>
          <Button variant="muted" fullWidth onClick={() => setUploadOpen(false)} disabled={uploading}>
            Not yet
          </Button>
        </div>
      </ResponsiveDialog>
      <ConfirmationDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancel} loading={busy} title="Cancel this order?" description="Only do this if you have not transferred any money. If you already paid, upload the receipt instead." confirmLabel="Cancel order" confirmVariant="destructive" />
    </>
  );
}
