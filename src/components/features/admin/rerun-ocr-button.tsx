"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminReprocessReceipt } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Re-reads the stored receipt with the current parsers. Appends a reading; changes no decision. Audited server-side. */
export function RerunOcrButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await adminReprocessReceipt(orderId).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(`OCR re-run · ${r.data.verification.outcome.replace(/_/g, " ").toLowerCase()}`);
    router.refresh();
  };
  return (
    <Button variant="secondary" size="sm" onClick={run} loading={busy}>
      Re-run OCR
    </Button>
  );
}
