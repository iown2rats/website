"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminSavePaymentMethod } from "@/actions/admin";
import type { PaymentMethodAdminDto } from "@/server/billing/payment-methods";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Draft = { label: string; bankName: string; accountHolder: string; accountNumber: string; instructions: string; enabled: boolean; sortOrder: number };

const empty: Draft = { label: "", bankName: "", accountHolder: "", accountNumber: "", instructions: "", enabled: false, sortOrder: 0 };

export function PaymentMethodForm({ method, onDone }: { method?: PaymentMethodAdminDto; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(method ? { label: method.label, bankName: method.bankName, accountHolder: method.accountHolder, accountNumber: method.accountNumber, instructions: method.instructions ?? "", enabled: method.enabled, sortOrder: method.sortOrder } : empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  return (
    <form
      className="grid grid-cols-1 gap-3 desktop:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await adminSavePaymentMethod(method?.id ?? null, { ...d, type: "BANK_TRANSFER", currency: "MVR" }).catch(() => null);
        setBusy(false);
        if (!r || !r.ok) return setError(r && !r.ok ? r.message : "That didn't save.");
        toast.show(method ? "Payment method updated" : "Payment method added");
        if (!method) setD(empty);
        onDone?.();
        router.refresh();
      }}
    >
      <Field label="Label (internal)" hint="e.g. Main MVR account">{(p) => <Input {...p} value={d.label} onChange={(e) => set("label", e.target.value)} maxLength={60} required className="h-11 text-body-sm" />}</Field>
      <Field label="Bank">{(p) => <Input {...p} value={d.bankName} onChange={(e) => set("bankName", e.target.value)} maxLength={60} required className="h-11 text-body-sm" />}</Field>
      <Field label="Account holder name">{(p) => <Input {...p} value={d.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} maxLength={80} required className="h-11 text-body-sm" />}</Field>
      <Field label="Account number">{(p) => <Input {...p} value={d.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} inputMode="numeric" maxLength={40} required className="h-11 font-mono text-body-sm" />}</Field>
      <Field label="Instructions shown to customers (optional)" className="desktop:col-span-2">{(p) => <Textarea {...p} value={d.instructions} onChange={(e) => set("instructions", e.target.value)} maxLength={500} rows={3} placeholder="e.g. Use the payment reference as the transfer remark." />}</Field>
      <Field label="Sort order" hint="Lower shows first. The lowest enabled method is used at checkout.">{(p) => <Input {...p} type="number" min={0} max={1000} value={d.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} className="h-11 text-body-sm" />}</Field>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
        <div>
          <div className="text-body-sm font-semibold text-text" id={`enabled-${method?.id ?? "new"}`}>Enabled</div>
          <div className="text-caption text-text-secondary">Customers can pay to this account.</div>
        </div>
        <Switch compact checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} aria-labelledby={`enabled-${method?.id ?? "new"}`} />
      </div>
      {error ? <p role="alert" className="text-caption font-semibold text-danger desktop:col-span-2">{error}</p> : null}
      <div className="flex gap-2 desktop:col-span-2">
        <Button type="submit" variant="ocean" size="sm" loading={busy}>{method ? "Save changes" : "Add payment method"}</Button>
        {onDone ? <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={busy}>Cancel</Button> : null}
      </div>
    </form>
  );
}

export function PaymentMethodCard({ method }: { method: PaymentMethodAdminDto }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <PaymentMethodForm method={method} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body-sm desktop:grid-cols-2">
        <div><dt className="text-label uppercase text-text-secondary">Bank</dt><dd className="text-text">{method.bankName}</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Account holder</dt><dd className="text-text">{method.accountHolder}</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Account number</dt><dd className="font-mono text-text">{method.accountNumber}</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Currency · sort</dt><dd className="text-text">{method.currency} · {method.sortOrder}</dd></div>
        {method.instructions ? <div className="desktop:col-span-2"><dt className="text-label uppercase text-text-secondary">Instructions</dt><dd className="text-text">{method.instructions}</dd></div> : null}
      </dl>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        <span className="text-caption text-text-secondary">{method.orders} order{method.orders === 1 ? "" : "s"} reference this method.</span>
      </div>
    </div>
  );
}
