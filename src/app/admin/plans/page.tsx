import { AdminPage, Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { PlanCard, PlanForm } from "@/components/features/admin/plan-form";
import { Callout } from "@/components/ui/alert";
import { requireAdminPage } from "@/server/admin/authz";
import { listPlansForAdmin } from "@/server/billing/plans";

export const metadata = { title: "Plans · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  await requireAdminPage("plans.manage");
  const plans = await listPlansForAdmin();
  const forSale = plans.filter((p) => p.forSale).length;
  return (
    <AdminPage title="Plus plans" description="Prices are set here, never in code. A plan is for sale only when it is enabled and its price is approved.">
      {forSale === 0 ? <Callout tone="info" title="Nothing is for sale yet">Every plan still carries a placeholder price. Set the real MVR price, switch on &ldquo;Price approved&rdquo; and enable the plan to start selling.</Callout> : null}
      {plans.map((p) => (
        <Panel key={p.id} title={`${p.name} · ${p.code}`} actions={<><StatusPill status={p.active ? "ACTIVE" : "CANCELLED"} label={p.active ? "enabled" : "disabled"} /><StatusPill status={p.forSale ? "APPROVED" : "AWAITING_PAYMENT"} label={p.forSale ? "for sale" : "not for sale"} /></>}>
          <PlanCard plan={p} />
        </Panel>
      ))}
      <Panel title="Create a plan">
        <PlanForm />
      </Panel>
    </AdminPage>
  );
}
