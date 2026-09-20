import { AdminPage, Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { PaymentMethodCard, PaymentMethodForm } from "@/components/features/admin/payment-method-form";
import { Callout } from "@/components/ui/alert";
import { requireAdminPage } from "@/server/admin/authz";
import { listPaymentMethodsForAdmin } from "@/server/billing/payment-methods";

export const metadata = { title: "Payment methods · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentMethodsPage() {
  await requireAdminPage("payment-methods.manage");
  const methods = await listPaymentMethodsForAdmin();
  const enabled = methods.filter((m) => m.enabled).length;
  return (
    <AdminPage title="Payment methods" description="Bank accounts customers transfer to. Details are stored here only, shown to signed-in customers at checkout and snapshotted onto each order.">
      {enabled === 0 ? <Callout tone="warning" title="No enabled payment method">Plus cannot be bought until one method is enabled. Add your bank account below and switch it on.</Callout> : null}
      {methods.map((m) => (
        <Panel key={m.id} title={m.label} actions={<StatusPill status={m.enabled ? "ACTIVE" : "CANCELLED"} label={m.enabled ? "enabled" : "disabled"} />}>
          <PaymentMethodCard method={m} />
        </Panel>
      ))}
      <Panel title="Add a bank account">
        <PaymentMethodForm />
      </Panel>
    </AdminPage>
  );
}
