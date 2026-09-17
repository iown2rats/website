"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { saveInvisibleMode, savePausedDating, savePrivacyToggles } from "@/actions/settings";
import { VERIFICATION_LABELS } from "@/constants/labels";
import { cn } from "@/lib/cn";
import { Callout } from "@/components/ui/alert";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { ShieldIcon } from "@/components/ui/icons";
import { LinkRow, ListGroup, OceanCard, SectionLabel } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { PageOverlay } from "@/components/layout/page-overlay";
import type { PrivacySettingsDto } from "@/server/privacy/settings";
import { ContactsSheet } from "./contacts-sheet";

/*
 * Prototype "Privacy & Safety": ocean notice, PROFILE VISIBILITY radios (Everyone / Only people I like / Hidden),
 * toggle card, "Block my contacts" card with ON/OFF badge, links (Blocked profiles, Verification, Safety Center) and
 * the screenshots note. "Only people I like" is the approved Plus-only Invisible Mode; "Hidden" is Pause Dating.
 * Read receipts and profile sharing exist in the prototype but have no behaviour in the product, so they are not
 * offered as toggles (docs/ARCHITECTURE.md §19).
 */
export const INVISIBLE_MODE_DISCLOSURE = "Invisible Mode hides you from Discover. Your Community posts and comments can still be visible to other Community members.";

type Visibility = "everyone" | "invisible" | "hidden";
const visibilityOf = (p: PrivacySettingsDto): Visibility => (p.paused ? "hidden" : p.invisibleMode.enabled ? "invisible" : "everyone");

export function PrivacyClient({ initial, verificationStatus }: { initial: PrivacySettingsDto; verificationStatus: keyof typeof VERIFICATION_LABELS }) {
  const router = useRouter();
  const toast = useToast();
  const plusTitleId = useId();
  const [privacy, setPrivacy] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const visibility = visibilityOf(privacy);

  const apply = async (key: string, run: () => Promise<{ ok: true; privacy: PrivacySettingsDto } | { ok: false; code: string; message: string }>, done?: string) => {
    setBusy(key);
    const r = await run().catch(() => null);
    setBusy(null);
    if (!r) { toast.show("Couldn't save that. Try again."); return false; }
    if (!r.ok) {
      if (r.code === "ENTITLEMENT") setPlusOpen(true);
      else toast.show(r.message);
      return false;
    }
    setPrivacy(r.privacy);
    if (done) toast.show(done);
    router.refresh();
    return true;
  };

  const chooseVisibility = async (next: Visibility) => {
    if (next === visibility) return;
    if (next === "invisible" && !privacy.invisibleMode.available) { setPlusOpen(true); return; }
    if (next === "hidden") { await apply("visibility", () => savePausedDating({ paused: true }), "Dating paused — you're hidden from Discover"); return; }
    if (visibility === "hidden") {
      const ok = await apply("visibility", () => savePausedDating({ paused: false }));
      if (!ok) return;
    }
    if (next === "invisible") await apply("visibility", () => saveInvisibleMode({ enabled: true }), "Invisible Mode on");
    else if (privacy.invisibleMode.enabled) await apply("visibility", () => saveInvisibleMode({ enabled: false }), "Invisible Mode off");
    else if (visibility === "hidden") toast.show("Dating resumed");
  };

  const toggle = (key: "hideLocation" | "hideAge" | "hideActiveStatus" | "blockContacts", value: boolean) => {
    const before = privacy;
    setPrivacy({ ...privacy, [key]: value });
    void apply(key, () => savePrivacyToggles({ [key]: value })).then((ok) => { if (!ok) setPrivacy(before); });
  };

  const options: { value: Visibility; label: string; sub: string; plus?: boolean }[] = [
    { value: "everyone", label: "Everyone", sub: "Standard — shown to people who match your preferences" },
    { value: "invisible", label: "Only people I like", sub: "Invisible Mode: you're hidden in Discover until you like someone first", plus: true },
    { value: "hidden", label: "Hidden", sub: "Paused from Discover, chats still work" },
  ];
  const toggles: { key: "hideLocation" | "hideAge" | "hideActiveStatus"; label: string; sub: string }[] = [
    { key: "hideLocation", label: "Hide my location", sub: "Show nothing instead of your island" },
    { key: "hideAge", label: "Hide age", sub: "Others see only your name" },
    { key: "hideActiveStatus", label: "Hide active status", sub: "No “active now” indicator" },
  ];

  return (
    <PageOverlay title="Privacy & Safety" backHref="/profile">
      <OceanCard className="flex-row items-start gap-3.5 p-5">
        <ShieldIcon size={26} className="shrink-0 text-aqua" />
        <p className="text-body-sm leading-relaxed text-on-ocean-muted">You control exactly who sees you. Your phone number and exact location are never shown to anyone.</p>
      </OceanCard>

      <section className="flex flex-col gap-2.5" aria-labelledby="privacy-visibility">
        <SectionLabel id="privacy-visibility">Profile visibility</SectionLabel>
        <div role="radiogroup" aria-labelledby="privacy-visibility" className="flex flex-col gap-2">
          {options.map((o) => {
            const on = visibility === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy === "visibility"}
                onClick={() => void chooseVisibility(o.value)}
                className={cn("flex min-h-14.5 items-center justify-between gap-3 rounded-lg border-[1.5px] px-4.5 py-2.5 text-left text-text", on ? "border-primary bg-aqua-soft" : "border-border bg-surface")}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-body font-semibold">{o.label}{o.plus ? <PlusTag size="xs" /> : null}</span>
                  <span className="block text-caption-sm text-text-secondary">{o.sub}</span>
                </span>
                <span aria-hidden="true" className={cn("size-5 shrink-0 rounded-full border-2", on ? "border-primary bg-primary" : "border-border")} />
              </button>
            );
          })}
        </div>
        {visibility === "invisible" || privacy.invisibleMode.enabled ? (
          <Callout tone={privacy.invisibleMode.suspended ? "warning" : "ocean"} title={privacy.invisibleMode.suspended ? "Your Invisible Mode is still on." : "Invisible Mode"} className="mt-0.5">
            {privacy.invisibleMode.suspended
              ? "Thundi Plus has ended, so you stay hidden from Discover until you renew Plus or turn Invisible Mode off. You are never shown to new people without your say. Your matches, chats and Community are unchanged."
              : "Only people you like can find you in Discover. It doesn't affect your existing matches or chats."}{" "}
            {INVISIBLE_MODE_DISCLOSURE}
            {privacy.invisibleMode.suspended ? (
              <span className="mt-2.5 flex gap-2">
                <Link href="/settings/membership" className="inline-flex h-9 items-center rounded-md bg-ocean px-3.5 text-caption font-bold text-on-ocean">Renew Thundi Plus</Link>
                <Button size="sm" variant="secondary" className="h-9 rounded-md px-3.5 text-caption" onClick={() => void chooseVisibility("everyone")} loading={busy === "visibility"}>Turn Invisible Mode off</Button>
              </span>
            ) : null}
          </Callout>
        ) : null}
      </section>

      <ListGroup>
        {toggles.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3.5 px-4.5 py-3.5">
            <div className="min-w-0">
              <div id={`priv-${t.key}`} className="text-body font-semibold text-text">{t.label}</div>
              <div id={`priv-${t.key}-d`} className="mt-0.5 text-caption-sm text-text-secondary">{t.sub}</div>
            </div>
            <Switch checked={privacy[t.key]} onCheckedChange={(v) => toggle(t.key, v)} disabled={busy === t.key} aria-labelledby={`priv-${t.key}`} aria-describedby={`priv-${t.key}-d`} />
          </div>
        ))}
      </ListGroup>

      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-extrabold tracking-[-.01em] text-text">Block my contacts</h2>
          <span className={cn("inline-flex h-6 items-center rounded-xs px-2.5 text-[11px] font-extrabold", privacy.blockContacts ? "bg-aqua-soft text-ocean" : "bg-surface-muted text-text-secondary")} role="status">{privacy.blockContacts ? "ON" : "OFF"}</span>
        </div>
        <p className="m-0 text-body-sm leading-relaxed text-text-secondary">People you block from your contacts won&apos;t be shown your dating profile, and you won&apos;t see theirs. Numbers are hashed on your device — we never store your contacts.</p>
        {privacy.blockContacts ? (
          <>
            <p className="text-caption text-text-secondary">{privacy.contactHashCount} number{privacy.contactHashCount === 1 ? "" : "s"} on your list.</p>
            <Button variant="muted" onClick={() => setContactsOpen(true)} className="h-12.5">Manage blocked contacts</Button>
            <Button variant="ghost" size="md" onClick={() => toggle("blockContacts", false)} disabled={busy === "blockContacts"}>Turn off (keeps your list)</Button>
          </>
        ) : (
          <Button variant="ocean" onClick={() => toggle("blockContacts", true)} loading={busy === "blockContacts"} className="h-12.5">Block my contacts</Button>
        )}
      </div>

      <ListGroup>
        <LinkRow href="/settings/blocked" label="Blocked profiles" meta={String(privacy.blockedCount)} />
        <LinkRow href="/settings/verification" label="Verification" meta={VERIFICATION_LABELS[verificationStatus]} />
        <LinkRow href="/settings/safety" label="Safety Center" />
      </ListGroup>

      <p className="text-caption leading-relaxed text-text-secondary">Screenshots can&apos;t be prevented on the web. Only share what you&apos;d be comfortable seeing elsewhere.</p>

      <ResponsiveDialog open={plusOpen} onClose={() => setPlusOpen(false)} labelledBy={plusTitleId}>
        <div className="flex items-center gap-2"><PlusTag size="md" /></div>
        <DialogTitle id={plusTitleId} className="text-[22px]">Invisible Mode is part of Thundi Plus</DialogTitle>
        <DialogDescription>With Plus, only people you like can find you in Discover. {INVISIBLE_MODE_DISCLOSURE}</DialogDescription>
        <div className="flex flex-col gap-2.5 pt-1">
          <Link href="/settings/membership" className="flex h-13 items-center justify-center rounded-lg bg-ocean text-body font-bold text-sand">See Thundi Plus</Link>
          <Button variant="muted" size="md" onClick={() => setPlusOpen(false)} fullWidth>Not now</Button>
        </div>
      </ResponsiveDialog>

      <ContactsSheet open={contactsOpen} onClose={() => setContactsOpen(false)} privacy={privacy} onChange={(p) => { setPrivacy(p); router.refresh(); }} />
    </PageOverlay>
  );
}
