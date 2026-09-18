"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logout } from "@/actions/auth";
import { saveNotificationSettings, savePausedDating } from "@/actions/settings";
import { VERIFICATION_LABELS } from "@/constants/labels";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/ui/choice";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { LinkRow, ListGroup, ListRow, SectionLabel } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { useIsDesktop } from "@/components/ui/dialog";
import { PageOverlay } from "@/components/layout/page-overlay";
import { useTheme } from "@/components/layout/theme-toggle";
import type { NotificationSettingsDto } from "@/server/notifications/settings";
import type { PrivacySettingsDto } from "@/server/privacy/settings";
import { DeleteAccountSheet, type RecentAuthDto } from "./delete-account-sheet";

/*
 * Prototype "Settings": groups of 54 px rows (label, 13 px meta, chevron or 44×26 toggle) with uppercase group
 * labels and the footer "Thundi 1.0 · Made in the Maldives". On desktop (≥ 900) the page widens to 900 with a
 * 220 px section nav on the left and shows one group at a time. Rows without a real destination (Email, Terms,
 * Privacy Policy, Report a Problem) are shown as "Not yet available" rather than dead links.
 */
export interface SettingsClientProps {
  /** Masked (+960 •••• 123) when the user has added a phone; null otherwise — phones are optional profile data. */
  maskedPhone: string | null;
  /** The Google account the user signs in with (owner-facing only). */
  googleEmail: string | null;
  verificationStatus: keyof typeof VERIFICATION_LABELS;
  notifications: NotificationSettingsDto;
  privacy: PrivacySettingsDto;
  recentAuth: RecentAuthDto;
  /** Open the deletion sheet immediately (returning from the Google confirmation). */
  openDelete?: boolean;
  /** Shows the Admin dashboard row. Display only: /admin re-checks the role on the server. */
  isAdmin?: boolean;
}

const GROUPS = ["Account", "Notifications", "Privacy", "App", "Support", "Account management"] as const;
type Group = (typeof GROUPS)[number];

const NOTIFICATION_ROWS: { key: keyof NotificationSettingsDto; label: string; description: string }[] = [
  { key: "matches", label: "Matches", description: "When you match with someone" },
  { key: "likes", label: "Likes", description: "When someone likes you" },
  { key: "messages", label: "Messages", description: "New messages in your chats" },
  { key: "community", label: "Community", description: "Reactions and comments on your posts" },
  { key: "marketing", label: "Marketing", description: "News and offers from Thundi" },
];

export function SettingsClient({ maskedPhone, googleEmail, verificationStatus, notifications: initialNotifications, privacy: initialPrivacy, recentAuth, openDelete = false, isAdmin = false }: SettingsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const desktop = useIsDesktop();
  const [theme, toggleTheme] = useTheme();
  const [group, setGroup] = useState<Group>("Account");
  const [notifications, setNotifications] = useState(initialNotifications);
  const [privacy, setPrivacy] = useState(initialPrivacy);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(openDelete);
  const [busy, setBusy] = useState(false);
  const [loggingOut, startLogout] = useTransition();

  const setNotification = async (key: keyof NotificationSettingsDto, value: boolean) => {
    const before = notifications;
    setNotifications({ ...notifications, [key]: value });
    const r = await saveNotificationSettings({ [key]: value }).catch(() => null);
    if (!r || !r.ok) { setNotifications(before); toast.show(r && !r.ok ? r.message : "Couldn't save that. Try again."); return; }
    setNotifications(r.settings);
  };

  const setPaused = async (paused: boolean) => {
    setBusy(true);
    const r = await savePausedDating({ paused }).catch(() => null);
    setBusy(false);
    setPauseOpen(false);
    if (!r || !r.ok) { toast.show(r && !r.ok ? r.message : "Couldn't save that. Try again."); return; }
    setPrivacy(r.privacy);
    toast.show(paused ? "Dating paused — you're hidden from Discover" : "Dating resumed");
    router.refresh();
  };

  const visibilityLabel = privacy.paused ? "Hidden" : privacy.invisibleMode.enabled ? "Only people I like" : "Everyone";
  const show = (g: Group) => !desktop || group === g;

  return (
    <PageOverlay
      title="Settings"
      backHref="/profile"
      sideNav={GROUPS.map((g) => (
        <button key={g} type="button" onClick={() => setGroup(g)} aria-current={group === g ? "page" : undefined} className={cn("h-11 rounded-md border-0 px-3.5 text-left text-body-sm font-semibold", group === g ? "bg-aqua-soft text-text" : "bg-transparent text-text-secondary hover:bg-surface-muted")}>
          {g}
        </button>
      ))}
    >
      {show("Account") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-account">
          <SectionLabel id="settings-account">Account</SectionLabel>
          <ListGroup>
            <LinkRow href="/profile/edit?section=info" height={54} label="Personal information" />
            <ListRow asDiv height={54} label="Google account" meta={googleEmail ?? "—"} />
            <ListRow asDiv height={54} label="Phone number" meta={maskedPhone ?? "Not added"} />
            <LinkRow href="/settings/verification" height={54} label="Verification" meta={VERIFICATION_LABELS[verificationStatus]} />
            <LinkRow href="/settings/discovery" height={54} label="Discovery preferences" />
            <LinkRow href="/settings/membership" height={54} label="Membership" />
            {isAdmin ? <LinkRow href="/admin" height={54} label="Admin dashboard" meta="Staff" /> : null}
          </ListGroup>
        </section>
      ) : null}

      {show("Notifications") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-notifications">
          <SectionLabel id="settings-notifications">Notifications</SectionLabel>
          <ListGroup>
            {NOTIFICATION_ROWS.map((row) => (
              <ListRow
                key={row.key}
                asDiv
                height={54}
                label={<span id={`notif-${row.key}`}>{row.label}</span>}
                meta={<span className="sr-only">{notifications[row.key] ? "On" : "Off"}</span>}
                trailing={<Switch compact checked={notifications[row.key]} onCheckedChange={(v) => void setNotification(row.key, v)} aria-labelledby={`notif-${row.key}`} aria-describedby={`notif-${row.key}-d`} />}
                className="py-2"
              />
            ))}
          </ListGroup>
          <p className="px-4.5 text-caption text-text-secondary">
            {NOTIFICATION_ROWS.map((r) => <span key={r.key} id={`notif-${r.key}-d`} className="sr-only">{r.description}</span>)}
            Notifications appear inside Thundi. Turning a category off stops new notifications of that kind; earlier ones stay.
          </p>
        </section>
      ) : null}

      {show("Privacy") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-privacy">
          <SectionLabel id="settings-privacy">Privacy</SectionLabel>
          <ListGroup>
            <LinkRow href="/settings/privacy" height={54} label="Profile visibility" meta={visibilityLabel} />
            <LinkRow href="/settings/privacy" height={54} label="Location visibility" meta={privacy.hideLocation ? "Hidden" : "Island only"} />
            <LinkRow href="/settings/blocked" height={54} label="Blocked users" meta={String(privacy.blockedCount)} />
            <LinkRow href="/settings/privacy" height={54} label="Blocked contacts" meta={privacy.blockContacts ? "On" : "Off"} />
            <LinkRow href="/settings/privacy" height={54} label="Active status" meta={privacy.hideActiveStatus ? "Hidden" : "Shown"} />
          </ListGroup>
        </section>
      ) : null}

      {show("App") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-app">
          <SectionLabel id="settings-app">App</SectionLabel>
          <ListGroup>
            <ListRow asDiv height={54} label="Language" meta="English" />
            <ListRow height={54} label="Appearance" meta={theme === "dark" ? "Dark" : "Light"} onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={`Appearance: ${theme === "dark" ? "Dark" : "Light"}. Switch to ${theme === "dark" ? "light" : "dark"}`} />
          </ListGroup>
        </section>
      ) : null}

      {show("Support") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-support">
          <SectionLabel id="settings-support">Support</SectionLabel>
          <ListGroup>
            <LinkRow href="/settings/safety" height={54} label="Help Center" />
            <LinkRow href="/settings/safety" height={54} label="Contact Support" />
            <ListRow asDiv height={54} label={<span className="text-text-secondary">Report a Problem</span>} meta="Not yet available" />
            <ListRow asDiv height={54} label={<span className="text-text-secondary">Terms</span>} meta="Not yet available" />
            <ListRow asDiv height={54} label={<span className="text-text-secondary">Privacy Policy</span>} meta="Not yet available" />
          </ListGroup>
        </section>
      ) : null}

      {show("Account management") ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="settings-management">
          <SectionLabel id="settings-management">Account management</SectionLabel>
          <ListGroup>
            <ListRow height={54} label={privacy.paused ? "Resume dating" : "Pause dating"} meta={privacy.paused ? "Paused" : undefined} onClick={() => (privacy.paused ? void setPaused(false) : setPauseOpen(true))} disabled={busy} />
            <ListRow height={54} label="Log out" chevron={false} onClick={() => startLogout(async () => { await logout(); })} disabled={loggingOut} />
            <ListRow height={54} label="Delete account" tone="danger" chevron={false} onClick={() => setDeleteOpen(true)} />
          </ListGroup>
        </section>
      ) : null}

      {!desktop || group === "Account management" ? <p className="text-center text-micro text-text-secondary">Thundi 1.0 · Made in the Maldives</p> : null}

      <ConfirmationDialog
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        onConfirm={() => void setPaused(true)}
        title="Pause dating?"
        description="You'll be hidden from Discover and won't see new people or send likes until you resume. Your matches, chats and Community stay exactly as they are."
        confirmLabel="Pause dating"
        loading={busy}
      />
      <DeleteAccountSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} email={googleEmail} recentAuth={recentAuth} />
    </PageOverlay>
  );
}
