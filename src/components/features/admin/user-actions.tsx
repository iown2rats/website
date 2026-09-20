"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminConvertToStaff, adminSetAccountStatus } from "@/actions/admin";
import type { AdminRole } from "@/server/admin/authz";
import type { StaffRole } from "@/server/staff/rules";
import type { AccountAction, AccountStatus } from "@/server/admin/users";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "./reason-dialog";

/*
 * Account actions on a user detail screen. Each button opens a confirmation that requires a reason; the server
 * re-checks authorization and records before/after in the audit log. There is no "log in as user".
 */
export function UserActions({ userId, status, role, actorRole, isSelf }: { userId: string; status: AccountStatus; role: string; actorRole: AdminRole; isSelf: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<AccountAction | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [staffRole, setStaffRole] = useState<StaffRole>("MODERATOR");
  const [busy, setBusy] = useState(false);

  // A staff account never appears in this list, so `role` here is a member's column value.
  const protectedTarget = isSelf || role === "ADMIN" || (role === "MODERATOR" && actorRole !== "ADMIN");
  const canSuspend = !protectedTarget && (status === "ACTIVE" || status === "ONBOARDING");
  const canUnsuspend = !protectedTarget && status === "SUSPENDED";
  const canBan = !protectedTarget && status !== "BANNED" && status !== "DELETED";
  const canConvert = actorRole === "ADMIN" && !isSelf && status !== "DELETED";

  const run = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    const r = await adminSetAccountStatus(userId, { action, reason }).catch(() => null);
    setBusy(false);
    setAction(null);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(`Account is now ${r.data.status.toLowerCase()}`);
    router.refresh();
  };

  const convert = async (reason: string) => {
    setBusy(true);
    const r = await adminConvertToStaff(userId, { role: staffRole, reason }).catch(() => null);
    setBusy(false);
    setConvertOpen(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "That didn't go through.");
    toast.show(`Converted to staff. A set-password link was sent to ${r.data.email}.`);
    router.refresh();
  };

  const copy: Record<AccountAction, { title: string; description: string; label: string; variant: "ocean" | "destructive" }> = {
    SUSPEND: { title: "Suspend this account?", description: "They are signed out everywhere and cannot sign in until unsuspended. Their profile leaves Discover. Nothing is deleted.", label: "Suspend account", variant: "destructive" },
    UNSUSPEND: { title: "Lift the suspension?", description: "They can sign in again and continue where they left off.", label: "Unsuspend", variant: "ocean" },
    BAN: { title: "Ban this account?", description: "A ban is permanent in normal operation: they are signed out everywhere and cannot sign in. Reports, blocks and messages stay as evidence.", label: "Ban account", variant: "destructive" },
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canSuspend ? <Button size="sm" variant="destructive" onClick={() => setAction("SUSPEND")}>Suspend</Button> : null}
      {canUnsuspend ? <Button size="sm" variant="ocean" onClick={() => setAction("UNSUSPEND")}>Unsuspend</Button> : null}
      {canBan ? <Button size="sm" variant="destructive" onClick={() => setAction("BAN")}>Ban</Button> : null}
      {canConvert ? <Button size="sm" variant="secondary" onClick={() => setConvertOpen(true)}>Convert to staff</Button> : null}
      {protectedTarget && !isSelf ? <p className="self-center text-caption text-text-secondary">Admins and moderators are protected. Change the role first.</p> : null}
      {isSelf ? <p className="self-center text-caption text-text-secondary">This is your own account.</p> : null}
      {action ? <ReasonDialog open onClose={() => setAction(null)} onConfirm={run} title={copy[action].title} description={copy[action].description} confirmLabel={copy[action].label} confirmVariant={copy[action].variant} loading={busy} /> : null}
      <ReasonDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        onConfirm={convert}
        title="Convert to a staff account?"
        description="This removes their dating profile, photos and Community posts, and emails them a link to choose an admin password. It is refused if they have likes, matches, chats, reports or payments. It cannot be undone from here."
        confirmLabel="Convert to staff"
        confirmVariant="destructive"
        loading={busy}
      >
        <Field label="Staff role">
          {(p) => (
            <Select {...p} value={staffRole} onChange={(e) => setStaffRole(e.target.value as StaffRole)}>
              <option value="MODERATOR">Moderator</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          )}
        </Field>
      </ReasonDialog>
    </div>
  );
}
