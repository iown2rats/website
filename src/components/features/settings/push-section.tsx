"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { disablePushEverywhere, forgetPushDevice, loadPushState, savePushDevice, saveNotificationSettings } from "@/actions/settings";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/ui/choice";
import { ListGroup, ListRow } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import type { NotificationSettingsDto } from "@/server/notifications/settings";

/*
 * "Also notify my phone" (docs/DESIGN_SYSTEM.md §41).
 *
 * Sits inside the existing Notifications section and uses the same ListGroup / ListRow / Switch the five in-app
 * categories already use — this is one more block in that screen, not a new screen.
 *
 * FEATURE-DETECTED, NEVER ASSUMED. `supported` is computed from what this runtime actually exposes rather than
 * from a guess about which browser is running. That matters most inside the Android shell, whose WebView is not
 * expected to provide the Push API: if it does not, this block simply does not appear, and if a future WebView
 * does, push starts working there with no change here. The alternative — a user-agent test — is exactly the kind
 * of assumption that cost this app a night of downtime once already (ARCHITECTURE §28.5).
 *
 * Everything is off until the member turns it on. Granting the browser permission and enabling the switch are one
 * gesture, and the categories appear underneath already showing what that gesture turned on, all individually
 * switchable, so nothing is enabled out of sight.
 */

interface PushCategoryRow {
  key: "pushMessages" | "pushLikes" | "pushMatches" | "pushReactions" | "pushCommunity" | "pushAccount";
  label: string;
  description: string;
}

const CATEGORIES: PushCategoryRow[] = [
  { key: "pushMessages", label: "Messages", description: "When someone leaves you a message." },
  { key: "pushLikes", label: "Likes", description: "When someone likes you. Never says who." },
  { key: "pushMatches", label: "Matches", description: "When you and someone else both like each other." },
  { key: "pushReactions", label: "Reactions", description: "When someone reacts to your message, post or comment." },
  { key: "pushCommunity", label: "Community activity", description: "Comments on your Community posts." },
  { key: "pushAccount", label: "Account and security", description: "Photo verification results, payments and Plus notices." },
];

/*
 * base64url → Uint8Array, the form `PushManager.subscribe` wants the VAPID key in.
 *
 * The return type is spelled `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: `applicationServerKey`
 * takes a `BufferSource`, which requires a view over a real `ArrayBuffer`, while `Uint8Array.from` infers the
 * wider `ArrayBufferLike` (it could be a `SharedArrayBuffer`). Allocating the buffer explicitly is what makes
 * the narrower type true rather than merely asserted.
 */
function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/*
 * Does this runtime have the Push API at all?
 *
 * `useSyncExternalStore` rather than an effect that calls setState, because that is what this is: a value that
 * lives outside React and never changes while the page is open. The server snapshot is `false`, so the block is
 * absent from the HTML and appears on the client only where push can actually work — no flash of a control that
 * then vanishes, and nothing to re-subscribe to.
 */
const noop = () => () => {};
const detectPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function PushSection({ settings, onSettings }: { settings: NotificationSettingsDto; onSettings: (s: NotificationSettingsDto) => void }) {
  const toast = useToast();
  const supported = useSyncExternalStore(noop, detectPush, () => false);
  const [available, setAvailable] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Whether this deployment has VAPID keys at all is a server question, so it is asked once the client is up.
  useEffect(() => {
    if (!supported) return;
    void loadPushState().then((r) => {
      if (!r.ok) return;
      setAvailable(r.push.available);
      setPublicKey(r.push.publicKey);
    });
  }, [supported]);

  /** Registers the worker, asks for permission, subscribes, and tells the server. Any refusal leaves push off. */
  const enable = async (): Promise<boolean> => {
    if (!publicKey) {
      toast.show("Push notifications aren't available right now.");
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // Denied at the browser level. Saying so plainly beats a switch that flips back with no explanation.
        toast.show(permission === "denied" ? "Your browser is blocking notifications for Mellocrush." : "Notifications weren't allowed.");
        return false;
      }
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required by every browser: a push that shows nothing visible is not allowed, which suits us — every
          // push we send is one the member asked for and will see.
          userVisibleOnly: true,
          applicationServerKey: decodeKey(publicKey),
        }));

      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) {
        toast.show("This browser didn't provide the keys needed for notifications.");
        return false;
      }
      const saved = await savePushDevice({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      });
      if (!saved.ok) {
        toast.show(saved.message);
        return false;
      }
      return true;
    } catch {
      toast.show("Couldn't turn on notifications on this device.");
      return false;
    }
  };

  /** Unsubscribes this browser and clears the preference, so nothing can arrive afterwards. */
  const disable = async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await forgetPushDevice({ endpoint: subscription.endpoint });
      }
    } catch {
      // The server is told either way below; a browser that cannot unsubscribe must not leave the switch stuck on.
    }
    const r = await disablePushEverywhere();
    if (r.ok) onSettings(r.settings);
  };

  const toggleMaster = async (value: boolean) => {
    setBusy("push");
    if (!value) {
      await disable();
      setBusy(null);
      return;
    }
    const ok = await enable();
    if (!ok) {
      setBusy(null);
      return;
    }
    const r = await saveNotificationSettings({ push: true });
    setBusy(null);
    if (!r.ok) {
      toast.show(r.message);
      return;
    }
    onSettings(r.settings);
  };

  const toggleCategory = async (key: PushCategoryRow["key"], value: boolean) => {
    setBusy(key);
    const before = settings;
    onSettings({ ...settings, [key]: value });
    const r = await saveNotificationSettings({ [key]: value });
    setBusy(null);
    if (!r.ok) {
      onSettings(before);
      toast.show(r.message);
      return;
    }
    onSettings(r.settings);
  };

  // This runtime has no Push API (the Android shell today), or this deployment has no keys.
  if (!supported || !available) return null;

  return (
    <>
      <ListGroup>
        <ListRow
          asDiv
          height={48}
          label={<span id="push-master">Also notify my phone</span>}
          meta={<span className="sr-only">{settings.push ? "On" : "Off"}</span>}
          trailing={
            <Switch
              compact
              checked={settings.push}
              onCheckedChange={(v) => void toggleMaster(v)}
              disabled={busy === "push"}
              aria-labelledby="push-master"
              aria-describedby="push-master-d"
            />
          }
          className="py-1"
        />
      </ListGroup>
      <p id="push-master-d" className={cn("px-3.5 text-caption text-text-secondary", settings.push && "pb-1")}>
        Notifications on your lock screen when you&apos;re not using Mellocrush. They never show what a message
        says — only that one is waiting.
      </p>

      {settings.push ? (
        <>
          <ListGroup>
            {CATEGORIES.map((row) => (
              <ListRow
                key={row.key}
                asDiv
                height={48}
                label={<span id={`push-${row.key}`}>{row.label}</span>}
                meta={<span className="sr-only">{settings[row.key] ? "On" : "Off"}</span>}
                trailing={
                  <Switch
                    compact
                    checked={settings[row.key]}
                    onCheckedChange={(v) => void toggleCategory(row.key, v)}
                    disabled={busy === row.key}
                    aria-labelledby={`push-${row.key}`}
                    aria-describedby={`push-${row.key}-d`}
                  />
                }
                className="py-1"
              />
            ))}
          </ListGroup>
          <p className="px-3.5 text-caption text-text-secondary">
            {CATEGORIES.map((r) => (
              <span key={r.key} id={`push-${r.key}-d`} className="sr-only">
                {r.description}
              </span>
            ))}
            Turning this off stops notifications reaching your phone. Everything still appears in Mellocrush.
          </p>
        </>
      ) : null}
    </>
  );
}
