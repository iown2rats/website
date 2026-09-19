"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminSavePlan } from "@/actions/admin";
import type { PlanAdminDto } from "@/server/billing/plans";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Draft = { code: string; name: string; description: string; intervalDays: number; price: string; badge: string; sortOrder: number; active: boolean; priceFinal: boolean };

const empty: Draft = { code: "", name: "", description: "", intervalDays: 30, price: "", badge: "", sortOrder: 0, active: false, priceFinal: false };

function fromDto(p: PlanAdminDto): Draft {
  return { code: p.code, name: p.name, description: p.description ?? "", intervalDays: p.intervalDays, price: p.priceMinor ? (p.priceMinor / 100).toString() : "", badge: p.badge ?? "", sortOrder: p.sortOrder, active: p.active, priceFinal: !p.isPlaceholderPrice };
}

export function PlanForm({ plan, onDone }: { plan?: PlanAdminDto; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(plan ? fromDto(plan) : empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const priceMinor = Math.round(Number(d.price || 0) * 100);
  const forSale = d.active && d.priceFinal && priceMinor > 0;
  return (
    <form
      className="grid grid-cols-1 gap-3 desktop:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await adminSavePlan(plan?.id ?? null, { code: d.code, name: d.name, description: d.description, intervalDays: d.intervalDays, priceMinor, currency: "MVR", badge: d.badge, sortOrder: d.sortOrder, active: d.active, isPlaceholderPrice: !d.priceFinal }).catch(() => null);
        setBusy(false);
        if (!r || !r.ok) return setError(r && !r.ok ? r.message : "That didn't save.");
        toast.show(plan ? "Plan updated" : "Plan created");
        if (!plan) setD(empty);
        onDone?.();
        router.refresh();
      }}
    >
      <Field label="Code" hint="Stable identifier, e.g. MONTHLY">{(p) => <Input {...p} value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} maxLength={32} required className="h-11 font-mono text-body-sm" />}</Field>
      <Field label="Display name" hint="e.g. 1 month">{(p) => <Input {...p} value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={40} required className="h-11 text-body-sm" />}</Field>
      <Field label="Duration (days)">{(p) => <Input {...p} type="number" min={1} max={730} value={d.intervalDays} onChange={(e) => set("intervalDays", Number(e.target.value))} required className="h-11 text-body-sm" />}</Field>
      <Field label="Price (MVR)" hint="Whole rufiyaa or with laari, e.g. 149 or 149.50">{(p) => <Input {...p} inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))} className="h-11 text-body-sm" />}</Field>
      <Field label="Badge (optional)" hint="e.g. Most popular">{(p) => <Input {...p} value={d.badge} onChange={(e) => set("badge", e.target.value)} maxLength={24} className="h-11 text-body-sm" />}</Field>
      <Field label="Sort order">{(p) => <Input {...p} type="number" min={0} max={1000} value={d.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} className="h-11 text-body-sm" />}</Field>
      <Field label="Description (optional)" className="desktop:col-span-2">{(p) => <Textarea {...p} value={d.description} onChange={(e) => set("description", e.target.value)} maxLength={200} rows={2} />}</Field>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
        <div>
          <div className="text-body-sm font-medium text-text" id={`active-${plan?.id ?? "new"}`}>Enabled</div>
          <div className="text-caption text-text-secondary">Shown on the Membership screen.</div>
        </div>
        <Switch compact checked={d.active} onCheckedChange={(v) => set("active", v)} aria-labelledby={`active-${plan?.id ?? "new"}`} />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
        <div>
          <div className="text-body-sm font-medium text-text" id={`final-${plan?.id ?? "new"}`}>Price approved</div>
          <div className="text-caption text-text-secondary">Off = placeholder price, shown as &ldquo;Price TBA&rdquo;, cannot be bought.</div>
        </div>
        <Switch compact checked={d.priceFinal} onCheckedChange={(v) => set("priceFinal", v)} aria-labelledby={`final-${plan?.id ?? "new"}`} />
      </div>
      <p className="text-caption text-text-secondary desktop:col-span-2">{forSale ? "This plan will be for sale." : "This plan will not be for sale (needs enabled + approved price above zero)."} Existing orders keep the price they were created with.</p>
      {error ? <p role="alert" className="text-caption font-medium text-danger desktop:col-span-2">{error}</p> : null}
      <div className="flex gap-2 desktop:col-span-2">
        <Button type="submit" variant="ocean" size="sm" loading={busy}>{plan ? "Save changes" : "Create plan"}</Button>
        {onDone ? <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={busy}>Cancel</Button> : null}
      </div>
    </form>
  );
}

export function PlanCard({ plan }: { plan: PlanAdminDto }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <PlanForm plan={plan} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm desktop:grid-cols-4">
        <div><dt className="text-label uppercase text-text-secondary">Price</dt><dd className="text-text">{plan.isPlaceholderPrice ? `${plan.priceLabel} (placeholder)` : plan.priceLabel}</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Duration</dt><dd className="text-text">{plan.intervalDays} days</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Badge</dt><dd className="text-text">{plan.badge ?? "—"}</dd></div>
        <div><dt className="text-label uppercase text-text-secondary">Orders</dt><dd className="text-text">{plan.orders}</dd></div>
        {plan.description ? <div className="col-span-2 desktop:col-span-4"><dt className="text-label uppercase text-text-secondary">Description</dt><dd className="text-text">{plan.description}</dd></div> : null}
      </dl>
      <div>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
      </div>
    </div>
  );
}
