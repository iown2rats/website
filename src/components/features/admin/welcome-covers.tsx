"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  adminArchiveWelcomeCover,
  adminCreateWelcomeCover,
  adminPublishWelcomeCover,
  adminRemoveWelcomeCoverAsset,
  adminRestoreDefaultWelcomeCover,
  adminUpdateWelcomeCover,
} from "@/actions/admin";
import { Panel, StatusPill } from "@/components/features/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { WelcomeCoverDto, WelcomeCoverListDto } from "@/server/welcome/admin-covers";
import { formatBytes, WELCOME_COVER_VARIANTS_BY_DEVICE, type WelcomeCoverVariantKey } from "@/server/welcome/variants";

/*
 * Admin → App Settings → Welcome Screen (docs/ARCHITECTURE.md §26).
 *
 * The workflow this screen enforces is upload → preview → publish, and the ordering is the whole point: nothing an
 * admin does here changes the live site until Publish. Uploading attaches artwork to a DRAFT; Preview opens the
 * real Welcome Screen over it; Publish is the only button that a visitor can see the effect of.
 *
 * Authorization is server-side in every case (`welcome-cover.manage`, ADMIN only). This component hides buttons a
 * moderator cannot use, but hiding is tidiness — the action and the upload route both re-check.
 */

const STATE_LABELS: Record<WelcomeCoverDto["state"], string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  SUPERSEDED: "Published",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
};

/** "2026-09-20T18:30" — what <input type="datetime-local"> wants, in the admin's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** A function cannot cross the server/client boundary, so the preview link is rebuilt here from plain values. */
function previewHrefFor(coverId: string, device: string, guides: boolean): string {
  return `/admin/settings/welcome?preview=${encodeURIComponent(coverId)}&device=${encodeURIComponent(device)}${guides ? "&guides=1" : ""}`;
}

export function WelcomeCoverManager({ initial, previewDevice, previewGuides }: { initial: WelcomeCoverListDto; previewDevice: string; previewGuides: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const run = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, done: string) => {
    setBusy(true);
    setError(null);
    const r = await fn().catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      setError(r && !r.ok ? r.message : "That didn't go through.");
      return false;
    }
    toast.show(done);
    router.refresh();
    return true;
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="What visitors see now"
        description={
          initial.showingDefaults
            ? "The built-in Mellocrush cover. It ships with the app and always works, even if storage or the database is unavailable."
            : "A published cover. Any device it has no artwork for falls back to the built-in cover for that device."
        }
        actions={
          initial.showingDefaults ? null : (
            <Button variant="secondary" size="sm" onClick={() => setRestoring(true)} disabled={busy}>
              Restore default
            </Button>
          )
        }
      >
        <div className="flex items-center gap-3">
          <StatusPill status={initial.showingDefaults ? "ARCHIVED" : "LIVE"} label={initial.showingDefaults ? "Default cover" : "Live"} />
          <span className="text-body-sm text-text">{initial.covers.find((c) => c.state === "LIVE")?.name ?? "Mellocrush default"}</span>
        </div>
      </Panel>

      <Panel title="New cover" description="Create it, add artwork, preview it, then publish. Nothing goes live until you publish.">
        <form
          className="flex flex-col gap-3 desktop:flex-row desktop:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => adminCreateWelcomeCover({ name }), "Cover created")) setName("");
          }}
        >
          <Field label="Name" hint="For you, not for visitors — e.g. Ramadan 2027." className="flex-1">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="h-11" />}
          </Field>
          <Button type="submit" variant="ocean" size="sm" loading={busy} className="shrink-0">
            Create cover
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-2 text-caption font-medium text-danger">
            {error}
          </p>
        ) : null}
      </Panel>

      {initial.covers.length === 0 ? (
        <Panel title="Covers">
          <p className="text-body-sm text-text-secondary">No covers yet. The built-in cover is showing.</p>
        </Panel>
      ) : (
        initial.covers.map((cover) => <CoverCard key={cover.id} cover={cover} previewHref={(id) => previewHrefFor(id, previewDevice, previewGuides)} onRun={run} busy={busy} />)
      )}

      <ConfirmationDialog
        open={restoring}
        onClose={() => setRestoring(false)}
        onConfirm={async () => {
          await run(() => adminRestoreDefaultWelcomeCover(), "Restored the built-in cover");
          setRestoring(false);
        }}
        title="Restore the built-in cover?"
        description="Every published cover is archived and visitors go back to the Mellocrush cover straight away. No artwork is deleted — you can republish any of them from the list."
        confirmLabel="Restore default"
        loading={busy}
      />
    </div>
  );
}

type Runner = <T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, done: string) => Promise<boolean>;

function CoverCard({ cover, previewHref, onRun, busy }: { cover: WelcomeCoverDto; previewHref: (id: string) => string; onRun: Runner; busy: boolean }) {
  const [startsAt, setStartsAt] = useState(toLocalInput(cover.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(cover.endsAt));
  const [archiving, setArchiving] = useState(false);
  const hasArtwork = Object.values(cover.assets).some(Boolean);
  const dirty = startsAt !== toLocalInput(cover.startsAt) || endsAt !== toLocalInput(cover.endsAt);

  return (
    <Panel
      title={cover.name}
      description={`Created ${formatWhen(cover.createdAt)}${cover.createdBy ? ` by ${cover.createdBy}` : ""}`}
      actions={<StatusPill status={cover.state} label={STATE_LABELS[cover.state]} />}
    >
      <div className="flex flex-col gap-4">
        {cover.state === "SUPERSEDED" ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-caption text-text-secondary">
            Published, but another cover is showing. The most recently started promotion wins; a scheduled one beats an unscheduled one.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 desktop:grid-cols-3">
          {WELCOME_COVER_VARIANTS_BY_DEVICE.map((v) => (
            <VariantSlot key={v.key} cover={cover} variantKey={v.key} onRun={onRun} busy={busy} />
          ))}
        </div>

        <form
          className="flex flex-col gap-3 desktop:flex-row desktop:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            await onRun(() => adminUpdateWelcomeCover(cover.id, { startsAt: startsAt || null, endsAt: endsAt || null }), "Schedule saved");
          }}
        >
          <Field label="Starts" hint="Leave empty to go live as soon as it is published." className="flex-1">
            {(p) => <Input {...p} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-11" />}
          </Field>
          <Field label="Ends" hint="Leave empty to run until something replaces it." className="flex-1">
            {(p) => <Input {...p} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-11" />}
          </Field>
          <Button type="submit" variant="secondary" size="sm" disabled={!dirty || busy} className="shrink-0">
            Save schedule
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={previewHref(cover.id)}
            className="inline-flex h-9.5 items-center rounded-md bg-surface-muted px-3.5 text-body font-medium text-text pressable"
          >
            Preview
          </Link>
          {cover.state === "LIVE" || cover.state === "SUPERSEDED" || cover.state === "SCHEDULED" ? (
            <Button variant="secondary" size="sm" onClick={() => setArchiving(true)} disabled={busy}>
              Take off air
            </Button>
          ) : (
            <Button
              variant="ocean"
              size="sm"
              disabled={busy || !hasArtwork}
              onClick={() => onRun(() => adminPublishWelcomeCover(cover.id), cover.status === "DRAFT" ? "Cover published" : "Cover republished")}
            >
              {cover.status === "DRAFT" ? "Publish" : "Republish"}
            </Button>
          )}
          {!hasArtwork ? <span className="text-caption text-text-secondary">Add at least one image before publishing.</span> : null}
        </div>
      </div>

      <ConfirmationDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={async () => {
          await onRun(() => adminArchiveWelcomeCover(cover.id), "Taken off air");
          setArchiving(false);
        }}
        title={`Take "${cover.name}" off air?`}
        description="It keeps its artwork and stays in this list, so you can republish it later."
        confirmLabel="Take off air"
        loading={busy}
      />
    </Panel>
  );
}

function VariantSlot({ cover, variantKey, onRun, busy }: { cover: WelcomeCoverDto; variantKey: WelcomeCoverVariantKey; onRun: Runner; busy: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const spec = WELCOME_COVER_VARIANTS_BY_DEVICE.find((v) => v.key === variantKey)!;
  const asset = cover.assets[variantKey];
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("coverId", cover.id);
    body.append("variant", variantKey);
    const res = await fetch("/api/admin/welcome-cover", { method: "POST", body }).catch(() => null);
    setUploading(false);
    if (input.current) input.current.value = "";
    if (!res || !res.ok) {
      const message = res ? ((await res.json().catch(() => null))?.error ?? "That didn't upload.") : "That didn't upload.";
      setError(String(message));
      return;
    }
    toast.show(`${spec.label} image uploaded`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div>
        <div className="text-body-sm font-medium text-text">{spec.label}</div>
        <div className="text-caption text-text-secondary">
          {spec.range} · {spec.recommended.width}×{spec.recommended.height} recommended
        </div>
      </div>

      {/* The thumbnail keeps the variant's own shape, so a mis-shaped upload is visible before anything is published. */}
      <div
        className="relative w-full overflow-hidden rounded-md bg-surface-muted"
        style={{ aspectRatio: `${spec.recommended.width} / ${spec.recommended.height}` }}
      >
        {asset ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an already-sized WebP; the optimizer would add a hop for no gain.
          <img src={asset.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-2 text-center text-caption text-text-secondary">Using the built-in {spec.label.toLowerCase()} cover</div>
        )}
      </div>

      {asset ? (
        <div className="text-caption text-text-secondary">
          {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
        </div>
      ) : null}
      {asset?.warnings.map((w) => (
        <p key={w.code} className={cn("text-caption", w.code === "resolution" ? "text-danger" : "text-text-secondary")}>
          {w.message}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="mt-auto flex gap-2 pt-1">
        <Button variant="secondary" size="sm" loading={uploading} disabled={busy} onClick={() => input.current?.click()}>
          {asset ? "Replace" : "Upload"}
        </Button>
        {asset ? (
          <Button variant="ghost" size="sm" disabled={busy || uploading} onClick={() => onRun(() => adminRemoveWelcomeCoverAsset(cover.id, variantKey), `${spec.label} image removed`)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
