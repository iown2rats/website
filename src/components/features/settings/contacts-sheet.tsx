"use client";

import { useId, useState } from "react";
import { addHiddenContacts, clearHiddenContacts, loadContactHashKey } from "@/actions/settings";
import { normalizeMaldivianPhone } from "@/server/auth/phone";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import type { PrivacySettingsDto } from "@/server/privacy/settings";

/*
 * "Manage blocked contacts" (docs/CONTACT_BLOCKING.md §2, §7). The web cannot read an address book, so this offers
 * what browsers actually support: the Contact Picker where available (Chrome on Android) and typing or pasting
 * numbers everywhere. Numbers are normalised and hashed here, in the browser, with WebCrypto HMAC-SHA-256 and the
 * public salt; only 32-byte digests reach the server. The count shown is the size of the user's own list, never
 * how many of them are on Mellocrush.
 */
type ContactsNavigator = Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ tel?: string[] }[]> } };

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ContactsSheet({ open, onClose, privacy, onChange }: { open: boolean; onClose: () => void; privacy: PrivacySettingsDto; onChange: (p: PrivacySettingsDto) => void }) {
  const titleId = useId();
  const [numbers, setNumbers] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const pickerSupported = typeof navigator !== "undefined" && "contacts" in navigator && typeof (navigator as ContactsNavigator).contacts?.select === "function";

  const submit = async (raw: string[], source: "PICKER" | "MANUAL") => {
    const valid = raw.map((n) => normalizeMaldivianPhone(n)).filter((r): r is { ok: true; e164: string; local: string } => r.ok).map((r) => r.e164);
    if (valid.length === 0) { setMessage({ tone: "error", text: "No Maldivian mobile numbers found. Use 7 digits starting with 7 or 9." }); return; }
    setBusy(true);
    setMessage(null);
    const keyResult = await loadContactHashKey().catch(() => null);
    if (!keyResult || !keyResult.ok) { setBusy(false); setMessage({ tone: "error", text: "Couldn't prepare hashing. Try again." }); return; }
    const hashes = await Promise.all([...new Set(valid)].map((e164) => hmacHex(keyResult.key, e164)));
    const r = await addHiddenContacts({ hashes, source }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) { setMessage({ tone: "error", text: r && !r.ok ? r.message : "Couldn't save that. Try again." }); return; }
    onChange(r.privacy);
    setNumbers("");
    setMessage({ tone: "ok", text: `${r.added} number${r.added === 1 ? "" : "s"} added. Only hashes were sent.` });
  };

  const pick = async () => {
    try {
      const picked = await (navigator as ContactsNavigator).contacts!.select(["tel"], { multiple: true });
      await submit(picked.flatMap((c) => c.tel ?? []), "PICKER");
    } catch {
      setMessage({ tone: "error", text: "Nothing was selected." });
    }
  };

  const clear = async () => {
    setBusy(true);
    const r = await clearHiddenContacts().catch(() => null);
    setBusy(false);
    if (!r || !r.ok) { setMessage({ tone: "error", text: "Couldn't clear the list. Try again." }); return; }
    onChange(r.privacy);
    setMessage({ tone: "ok", text: "List cleared." });
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId} dismissible={!busy}>
      <DialogTitle id={titleId}>Blocked contacts</DialogTitle>
      <DialogDescription>
        People whose numbers you add here won&apos;t see your dating profile, and you won&apos;t see theirs. Numbers are hashed on this device — Mellocrush never receives or stores them in plain text.
      </DialogDescription>
      <p className="text-body-sm font-medium text-text">{privacy.contactHashCount} number{privacy.contactHashCount === 1 ? "" : "s"} on your list</p>
      {pickerSupported ? (
        <Button variant="secondary" size="md" onClick={() => void pick()} disabled={busy} fullWidth>Choose from contacts</Button>
      ) : (
        <p className="text-caption text-text-secondary">This browser can&apos;t open your address book. Type or paste numbers below; full address-book blocking is available in the Mellocrush app.</p>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${titleId}-numbers`} className="text-body-sm font-medium text-text">Add numbers to hide from</label>
        <Textarea id={`${titleId}-numbers`} value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={3} placeholder={"One per line, e.g. 777 1234"} disabled={busy} />
        <Button size="md" onClick={() => void submit(numbers.split(/[\n,;]+/), "MANUAL")} loading={busy} disabled={numbers.trim().length === 0} fullWidth>Hide from these numbers</Button>
      </div>
      {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-caption font-medium text-danger" : "text-caption font-medium text-primary-ink"}>{message.text}</p> : null}
      {privacy.contactHashCount > 0 ? (
        <Button variant="ghost" size="md" onClick={() => void clear()} disabled={busy} fullWidth className="text-danger">Clear the list</Button>
      ) : null}
      <Button variant="muted" size="md" onClick={onClose} disabled={busy} fullWidth>Done</Button>
    </ResponsiveDialog>
  );
}
