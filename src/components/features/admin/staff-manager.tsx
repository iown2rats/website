"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/alert";
import { DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/features/admin/admin-ui";
import { ReasonDialog } from "@/components/features/admin/reason-dialog";
import { useToast } from "@/components/ui/toast";
import { staffAddAction, staffCancelInviteAction, staffChangeRoleAction, staffResendInviteAction, staffRevokeAction } from "@/actions/staff";
import type { StaffRole } from "@/server/staff/rules";

/*
 * Staff management (docs/ARCHITECTURE.md §22.2). Two tables — live accounts and outstanding invitations — and the
 * four actions that move a grant through its lifecycle.
 *
 * Nothing here has ever seen a password, a hash, an invitation token or a reset token: the rows come from
 * `listStaffGrants`, which does not select them. "Resend invite" issues a fresh link server-side and invalidates
 * the previous one; it cannot show the visitor either.
 */

export interface StaffRow {
  id: string;
  email: string;
  role: StaffRole;
  reason: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  createdAt: string;
  createdByEmail: string | null;
  claimedAt: string | null;
  revokedAt: string | null;
  inviteExpiresAt: string | null;
  /** True for the signed-in admin's own row, which they may not change. */
  isSelf: boolean;
}

const ROLE_LABEL: Record<StaffRole, string> = { ADMIN: "Administrator", MODERATOR: "Moderator" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function StaffManager({ rows, canManage }: { rows: StaffRow[]; canManage: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<StaffRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<StaffRow | null>(null);
  const [nextRole, setNextRole] = useState<StaffRole>("MODERATOR");

  const active = rows.filter((r) => r.status === "ACTIVE");
  const invited = rows.filter((r) => r.status === "PENDING");
  const revoked = rows.filter((r) => r.status === "REVOKED").slice(0, 10);

  function run(work: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    startTransition(async () => {
      const result = await work().catch(() => ({ ok: false as const, message: "That didn't go through. Try again." }));
      if (result.ok) {
        toast.show(success);
        setAddOpen(false);
        setRoleTarget(null);
        setRevokeTarget(null);
      } else {
        toast.show(result.message ?? "That didn't go through. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add staff
          </Button>
        </div>
      ) : (
        <Callout tone="info">Only administrators can add or change staff access.</Callout>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-label uppercase text-text-secondary px-1">Active</h2>
        <StaffTable
          rows={active}
          empty="No active staff accounts."
          columns={["Email", "Role", "Added by", "Activated"]}
          cells={(r) => [r.email, ROLE_LABEL[r.role], r.createdByEmail ?? "—", formatDate(r.claimedAt)]}
          actions={
            canManage
              ? (r) =>
                  r.isSelf ? (
                    <span className="text-caption text-text-secondary">You</span>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setNextRole(r.role); setRoleTarget(r); }}>
                        Change role
                      </Button>
                      <Button size="sm" variant="destructive" disabled={pending} onClick={() => setRevokeTarget(r)}>
                        Revoke
                      </Button>
                    </div>
                  )
              : undefined
          }
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-label uppercase text-text-secondary px-1">Pending</h2>
        <StaffTable
          rows={invited}
          empty="No outstanding invitations."
          columns={["Email", "Role", "Added by", "Invited"]}
          cells={(r) => [r.email, ROLE_LABEL[r.role], r.createdByEmail ?? "—", formatDate(r.createdAt)]}
          actions={
            canManage
              ? (r) => (
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => staffResendInviteAction(r.id), `Invitation re-sent to ${r.email}.`)}>
                      Resend invite
                    </Button>
                    <Button size="sm" variant="muted" disabled={pending} onClick={() => run(() => staffCancelInviteAction(r.id), "Invitation cancelled.")}>
                      Cancel
                    </Button>
                  </div>
                )
              : undefined
          }
        />
      </section>

      {revoked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-label uppercase text-text-secondary px-1">Recently revoked</h2>
          <StaffTable
            rows={revoked}
            empty=""
            columns={["Email", "Role", "Added by", "Revoked"]}
            cells={(r) => [r.email, ROLE_LABEL[r.role], r.createdByEmail ?? "—", formatDate(r.revokedAt)]}
          />
        </section>
      ) : null}

      <AddStaffDialog open={addOpen} onClose={() => setAddOpen(false)} loading={pending} onSubmit={(input) => run(() => staffAddAction(input), `Invitation sent to ${input.email}.`)} />

      <ReasonDialog
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        loading={pending}
        title="Change role"
        description="Administrators can do everything here, including payments, plans and staff. Moderators see users, reports, verifications and photos only."
        confirmLabel="Save role"
        onConfirm={(reason) => roleTarget && run(() => staffChangeRoleAction(roleTarget.id, { role: nextRole, reason }), `Role is now ${ROLE_LABEL[nextRole]}.`)}
      >
        <Field label="New role">
          {(p) => (
            <Select {...p} value={nextRole} onChange={(e) => setNextRole(e.target.value as StaffRole)}>
              <option value="ADMIN">Administrator</option>
              <option value="MODERATOR">Moderator</option>
            </Select>
          )}
        </Field>
      </ReasonDialog>

      <ReasonDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        loading={pending}
        title="Revoke staff access"
        description="Their sessions end immediately and the portal closes to them. The account and its history stay; it does not become a dating account."
        confirmLabel="Revoke access"
        confirmVariant="destructive"
        onConfirm={(reason) => revokeTarget && run(() => staffRevokeAction(revokeTarget.id, { reason }), "Staff access revoked.")}
      />
    </div>
  );
}

function StaffTable({ rows, columns, cells, actions, empty }: { rows: StaffRow[]; columns: string[]; cells: (r: StaffRow) => string[]; actions?: (r: StaffRow) => React.ReactNode; empty: string }) {
  if (rows.length === 0) {
    return empty ? <p className="rounded-lg bg-surface px-4 py-6 text-center text-body-sm text-text-secondary">{empty}</p> : null;
  }
  return (
    <div className="overflow-x-auto rounded-lg bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-body-sm">
        <thead>
          <tr className="text-left text-caption uppercase text-text-secondary">
            {columns.map((c) => (
              <th key={c} className="px-4 py-2.5 font-medium">
                {c}
              </th>
            ))}
            {actions ? <th className="px-4 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60 align-middle">
              {cells(r).map((value, i) => (
                <td key={i} className="px-4 py-3">
                  {i === 1 ? <StatusPill status={r.role} label={value} /> : value}
                </td>
              ))}
              {actions ? <td className="px-4 py-3 text-right">{actions(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddStaffDialog({ open, onClose, onSubmit, loading }: { open: boolean; onClose: () => void; onSubmit: (input: { email: string; role: StaffRole; reason: string }) => void; loading: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("MODERATOR");
  const [reason, setReason] = useState("");
  const valid = email.trim().length > 5 && email.includes("@") && reason.trim().length >= 3;
  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy="add-staff-title" dismissible={!loading}>
      <DialogTitle id="add-staff-title">Add staff</DialogTitle>
      <p className="text-body-sm text-text-secondary">
        They receive a link to choose their own password. No dating profile is created, and nobody gets access until they use the link.
      </p>
      <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="person@example.com" />}</Field>
      <Field label="Role">
        {(p) => (
          <Select {...p} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="MODERATOR">Moderator</option>
            <option value="ADMIN">Administrator</option>
          </Select>
        )}
      </Field>
      <Field label="Reason (recorded in the audit log)" hint="At least 3 characters.">
        {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} placeholder="Community moderation" />}
      </Field>
      <div className="flex flex-col gap-2.5 pt-1">
        <Button onClick={() => onSubmit({ email: email.trim(), role, reason: reason.trim() })} loading={loading} disabled={!valid} fullWidth>
          Add staff
        </Button>
        <Button variant="muted" size="md" onClick={onClose} disabled={loading} fullWidth>
          Cancel
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
