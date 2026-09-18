"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cancelPlusOrder } from "@/actions/billing";
import { formatDate, formatDateTime } from "@/lib/format";
import type { OrderDto } from "@/server/billing/orders";
import { Callout } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog, DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { ListGroup } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";

/*
 * Order screen (docs/ARCHITECTURE.md §12.11): bank instructions with copy controls, "I've made the transfer" →
 * receipt upload (which submits the order), then the review / approved / rejected states. The customer never
 * sets a status; every state shown here is read back from the server after each action.
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
    <div className="flex items-center gap-3 px-4.5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-caption-sm text-text-secondary">{label}</div>
        <div className={mono ? "select-all break-all font-mono text-body font-bold tracking-[.02em] text-text" : "select-all text-body font-bold text-text"}>{value}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
        Copy
      </Button>
    </div>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp";

function upload(orderId: string, file: File, onProgress: (pct: number) => void): Promise<OrderDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/payments/${encodeURIComponent(orderId)}/receipt`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { order?: OrderDto; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.order) resolve(body.order);
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
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const next = await upload(order.id, file, setProgress);
      setOrder(next);
      setUploadOpen(false);
      toast.show("Receipt sent · payment under review");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save that receipt. Try again.");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
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
  return (
    <>
      {order.status === "AWAITING_PAYMENT" ? (
        <>
          <Callout tone="ocean" title={`Transfer ${order.amountLabel} for ${order.planName}`}>
            Send the exact amount from your bank app and put the payment reference in the remark. Plus activates after we confirm the transfer, usually within a day. This order is valid until {formatDate(order.expiresAt)}.
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

      {order.status === "SUBMITTED" ? (
        <Callout tone="info" title="Payment under review">
          Receipt submitted {formatDateTime(order.submittedAt)} for <span className="font-mono font-bold">{order.reference}</span> ({order.amountLabel}, {order.planName}). We check transfers within a day. Plus starts the moment it is confirmed, and you will see it here and in Settings.
        </Callout>
      ) : null}

      {order.status === "APPROVED" ? (
        <Callout tone="success" title="Payment confirmed">
          Thank you. {order.planName} was confirmed {formatDateTime(order.decidedAt)}.{order.periodEnd ? ` Plus runs until ${formatDate(order.periodEnd)}.` : ""}
        </Callout>
      ) : null}

      {order.status === "REJECTED" ? (
        <Callout tone="danger" title="Payment not accepted">
          {order.rejectionReason ? `Reason: ${order.rejectionReason}. ` : ""}Plus was not activated. If you did transfer the money, check that the reference <span className="font-mono font-bold">{order.reference}</span> and amount {order.amountLabel} match, then start a new order from Membership; a new reference will be issued.
        </Callout>
      ) : null}

      {order.status === "CANCELLED" || expired ? <Callout tone="warning" title={expired ? "This order expired" : "This order was cancelled"}>Nothing was charged. Start a new order from Membership when you are ready.</Callout> : null}

      <dl className="grid grid-cols-2 gap-3 px-1 text-caption text-text-secondary">
        <div><dt>Reference</dt><dd className="font-mono font-bold text-text">{order.reference}</dd></div>
        <div><dt>Created</dt><dd className="text-text">{formatDateTime(order.createdAt)}</dd></div>
        <div><dt>Plan</dt><dd className="text-text">{order.planName} · {order.durationDays} days</dd></div>
        <div><dt>Amount</dt><dd className="text-text">{order.amountLabel}</dd></div>
      </dl>

      <ResponsiveDialog open={uploadOpen} onClose={() => (progress === null ? setUploadOpen(false) : undefined)} label="Upload your receipt" dismissible={progress === null}>
        <DialogTitle>Upload your receipt</DialogTitle>
        <DialogDescription>A screenshot or photo of the transfer confirmation showing the amount and reference. JPG, PNG or WebP, up to 8 MB. Sending it submits your payment for review.</DialogDescription>
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
        <div className="flex flex-col gap-2.5 pt-1">
          <Button variant="ocean" fullWidth onClick={() => inputRef.current?.click()} loading={progress !== null}>
            {progress !== null ? `Uploading ${progress}%` : "Choose screenshot or photo"}
          </Button>
          <Button variant="muted" fullWidth onClick={() => setUploadOpen(false)} disabled={progress !== null}>
            Not yet
          </Button>
        </div>
      </ResponsiveDialog>
      <ConfirmationDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancel} loading={busy} title="Cancel this order?" description="Only do this if you have not transferred any money. If you already paid, upload the receipt instead." confirmLabel="Cancel order" confirmVariant="destructive" />
    </>
  );
}
