"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { adminDecidePhoto } from "@/actions/admin";
import { formatDateTime } from "@/lib/format";
import { photoBackground } from "@/lib/photos";
import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PendingPhotoRowDto } from "@/server/admin/photo-moderation";
import { ReasonDialog } from "./reason-dialog";

/*
 * The photo moderation queue (docs/ARCHITECTURE.md §21.5). One tile per waiting photo, newest upload first, with
 * everything a reviewer needs and nothing more: the image, who uploaded it, when, whether it is their main photo and
 * how many of their photos are already approved — so the cost of a rejection is visible before it is made.
 *
 * Approve is one tap. Reject asks for a reason, which the audit log keeps. A decided tile leaves the list
 * immediately; if the server refuses because somebody else already decided that photo, the message says so and the
 * tile is marked rather than silently disappearing, so the reviewer knows their click did nothing.
 */
export function PhotoQueue({ items }: { items: PendingPhotoRowDto[] }) {
  const toast = useToast();
  const [rows, setRows] = useState(items);
  const [rejecting, setRejecting] = useState<PendingPhotoRowDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stale, setStale] = useState<Record<string, string>>({});

  const decide = async (photo: PendingPhotoRowDto, decision: "APPROVED" | "REJECTED", reason: string) => {
    setBusyId(photo.photoId);
    const r = await adminDecidePhoto(photo.photoId, { decision, reason }).catch(() => null);
    setBusyId(null);
    setRejecting(null);
    if (!r || !r.ok) {
      const message = r && !r.ok ? r.message : "That didn't go through.";
      setStale((s) => ({ ...s, [photo.photoId]: message }));
      return toast.show(message);
    }
    setRows((list) => list.filter((p) => p.photoId !== photo.photoId));
    toast.show(decision === "APPROVED" ? "Photo approved" : "Photo rejected");
  };

  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-body-sm text-text-secondary">No photos waiting for review.</p>;
  }

  return (
    <>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => {
          const blocked = stale[p.photoId];
          return (
            <li key={p.photoId} className="flex flex-col gap-2.5 rounded-2xl glass-card p-3">
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-surface-muted" style={photoBackground({ url: null, key: p.demoKey })}>
                {p.url ? (
                  <Image src={p.url} alt={`Photo ${p.position + 1} from ${p.displayName ?? "a member"}`} fill unoptimized sizes="(min-width: 1024px) 320px, 50vw" className="object-cover" />
                ) : (
                  <span role="img" aria-label={`Photo ${p.position + 1} from ${p.displayName ?? "a member"}`} className="absolute inset-0" />
                )}
                {p.isPrimary ? <Tag variant="onPhoto" size="sm" className="absolute left-2.5 top-2.5">Main photo</Tag> : null}
              </div>
              <div className="flex flex-col gap-0.5">
                <Link href={`/admin/users/${p.userId}`} className="text-body-sm font-bold text-primary-ink hover:underline">
                  {p.displayName ?? "(no name)"}
                  {p.handle ? <span className="font-normal text-text-secondary"> @{p.handle}</span> : null}
                </Link>
                <span className="text-caption text-text-secondary">
                  Uploaded {formatDateTime(p.uploadedAt)} · position {p.position + 1} · {p.approvedCount} approved, {p.pendingCount} waiting
                </span>
                {p.accountStatus !== "ACTIVE" ? <Tag variant="warning" size="sm" className="self-start">Account {p.accountStatus.toLowerCase()}</Tag> : null}
              </div>
              {blocked ? (
                <p role="alert" className="text-caption font-semibold text-danger">{blocked}</p>
              ) : (
                <div className="flex gap-2">
                  <Button size="md" fullWidth loading={busyId === p.photoId} onClick={() => void decide(p, "APPROVED", "")}>Approve</Button>
                  <Button variant="secondary" size="md" fullWidth disabled={busyId === p.photoId} onClick={() => setRejecting(p)}>Reject</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ReasonDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => { if (rejecting) void decide(rejecting, "REJECTED", reason); }}
        title="Reject this photo"
        description="It stays hidden from everyone and the member sees it marked on their own photos. Say why, for the audit log."
        confirmLabel="Reject photo"
        confirmVariant="destructive"
        loading={busyId !== null}
      />
    </>
  );
}
