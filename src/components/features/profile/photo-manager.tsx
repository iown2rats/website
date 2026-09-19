"use client";

import Image from "next/image";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { removePhoto, reorderMyPhotos } from "@/actions/photos";
import { PHOTO_LIMITS } from "@/config/product";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { Tag } from "@/components/ui/badge";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/button";
import type { PhotoDto } from "@/server/photos/photos";

/*
 * One photo grid for onboarding step 9 and Edit profile → Photos (prototype: 3-column 3:4 tiles, radius 18, dashed
 * empty tiles, "Main photo" badge, remove ✕ 28 px, drag to reorder; Edit profile shows the first tile at 2×2).
 * Uploads go through /api/photos via XHR for real progress and retry; keyboard users reorder with the move buttons
 * and can promote any photo to main. The server owns validation, ordering, limits and the minimum-photo rule.
 */
export interface PhotoManagerState {
  photos: PhotoDto[];
  activeCount: number;
  uploading: boolean;
  busy: boolean;
}

export interface PhotoManagerProps {
  initialPhotos: PhotoDto[];
  /**
   * True when a PENDING photo is hidden from other members until a reviewer approves it — the production policy
   * (src/lib/photo-policy.ts). False in development, where pending photos are already displayable and telling
   * someone they are waiting would be a lie.
   */
  reviewedBeforeVisible?: boolean;
  layout?: "uniform" | "featured";
  note?: ReactNode;
  /** Rendered below the grid with the live state (onboarding uses it for the Continue button). */
  footer?: (state: PhotoManagerState) => ReactNode;
  className?: string;
}

interface Upload {
  localId: string;
  previewUrl: string;
  previewBroken?: boolean;
  progress: number;
  error?: string;
  file: File;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<PhotoDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/photos");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { photo?: PhotoDto; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.photo) resolve(body.photo);
        else reject(new Error(body.error ?? "We couldn't save that photo. Try again."));
      } catch {
        reject(new Error("We couldn't save that photo. Try again."));
      }
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export function PhotoManager({ initialPhotos, reviewedBeforeVisible = false, layout = "uniform", note, footer, className }: PhotoManagerProps) {
  const [photos, setPhotos] = useState<PhotoDto[]>(initialPhotos);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);

  const total = photos.length + uploads.filter((u) => !u.error).length;
  const slots = Math.max(0, PHOTO_LIMITS.max - total);
  const activeCount = photos.filter((p) => p.moderation !== "REJECTED").length;
  const uploading = uploads.some((u) => !u.error);

  const startUpload = (file: File) => {
    const localId = crypto.randomUUID();
    const upload: Upload = { localId, previewUrl: URL.createObjectURL(file), progress: 0, file };
    setUploads((u) => [...u, upload]);
    uploadWithProgress(file, (pct) => setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, progress: pct } : x))))
      .then((photo) => {
        setPhotos((p) => [...p.filter((x) => x.id !== photo.id), photo].sort((a, b) => a.position - b.position));
        setUploads((u) => u.filter((x) => x.localId !== localId));
        URL.revokeObjectURL(upload.previewUrl);
      })
      .catch((e: Error) => setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, error: e.message } : x))));
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const allowed = Math.max(0, PHOTO_LIMITS.max - total);
    const list = Array.from(files).slice(0, allowed);
    if (files.length > allowed) setError(`You can have up to ${PHOTO_LIMITS.max} photos.`);
    list.forEach(startUpload);
    if (inputRef.current) inputRef.current.value = "";
  };

  const retry = (u: Upload) => {
    setUploads((list) => list.filter((x) => x.localId !== u.localId));
    startUpload(u.file);
  };
  const dismissUpload = (u: Upload) => {
    URL.revokeObjectURL(u.previewUrl);
    setUploads((list) => list.filter((x) => x.localId !== u.localId));
  };

  const remove = (photoId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removePhoto({ photoId });
      if (result.ok) setPhotos(result.photos);
      else setError(result.error);
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setPhotos(next.map((p, i) => ({ ...p, position: i, isPrimary: i === 0 })));
    setError(null);
    startTransition(async () => {
      const result = await reorderMyPhotos({ photoIds: next.map((p) => p.id) });
      if (result.ok) setPhotos(result.photos);
      else setError(result.error);
    });
  };

  const featured = layout === "featured";
  const tileClass = (i: number) => cn(featured && i === 0 && "col-span-2 row-span-2");
  const tiles: ReactNode[] = [];
  photos.forEach((p, i) => {
    tiles.push(
      <li
        key={p.id}
        draggable
        onDragStart={() => { dragFrom.current = i; }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (dragFrom.current != null) move(dragFrom.current, i); dragFrom.current = null; }}
        className={cn("group relative aspect-[3/4] overflow-hidden rounded-xl bg-surface-muted", p.moderation === "REJECTED" && "opacity-60", tileClass(i))}
        style={photoBackground({ url: null, key: p.demoKey })}
      >
        {p.thumbUrl ? <Image src={p.thumbUrl} alt={`Photo ${i + 1}${i === 0 ? " (main photo)" : ""}`} fill unoptimized sizes="33vw" className="object-cover" draggable={false} /> : <span role="img" aria-label={`Photo ${i + 1}${i === 0 ? " (main photo)" : ""}`} className="absolute inset-0" />}
        {p.isPrimary ? <span className="absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-xs bg-white px-2.5 text-micro font-medium text-ocean shadow-sm">Main photo</span> : null}
        {p.moderation === "PENDING" ? <Tag variant="warning" size="sm" className="absolute bottom-2.5 left-2.5 bg-white/90">Under review</Tag> : null}
        {p.moderation === "REJECTED" ? <Tag variant="danger" size="md" className="absolute left-2.5 top-2.5">Not allowed</Tag> : null}
        <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(p.id)} disabled={busy} className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full border-0 bg-[rgba(6,20,26,.55)] text-white">
          <CloseIcon size={14} strokeWidth={2.6} />
        </button>
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" aria-label={`Move photo ${i + 1} earlier`} onClick={() => move(i, i - 1)} disabled={i === 0 || busy} className="grid size-8 place-items-center rounded-full border-0 bg-white/90 text-ocean disabled:opacity-30"><ChevronLeftIcon size={14} /></button>
          {i > 0 ? (
            <button type="button" onClick={() => move(i, 0)} disabled={busy} className="h-8 rounded-full border-0 bg-white/90 px-2.5 text-tag font-medium text-ocean">Make main</button>
          ) : null}
          <button type="button" aria-label={`Move photo ${i + 1} later`} onClick={() => move(i, i + 1)} disabled={i === photos.length - 1 || busy} className="grid size-8 place-items-center rounded-full border-0 bg-white/90 text-ocean disabled:opacity-30"><ChevronRightIcon size={14} /></button>
        </div>
      </li>,
    );
  });
  uploads.forEach((u, j) => {
    tiles.push(
      <li key={u.localId} className={cn("relative aspect-[3/4] overflow-hidden rounded-xl bg-surface-muted", tileClass(photos.length + j))} aria-live="polite">
        {u.previewBroken ? null : (
          <Image src={u.previewUrl} alt="" fill unoptimized sizes="33vw" className={cn("object-cover", !u.error && "opacity-60")} onError={() => setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, previewBroken: true } : x)))} />
        )}
        {u.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgba(6,20,26,.6)] p-2 text-center text-white">
            <span className="text-caption-sm font-medium leading-snug">{u.error}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => retry(u)} className="h-8 rounded-full border-0 bg-white px-2.5 text-micro font-medium text-ocean">Retry</button>
              <button type="button" onClick={() => dismissUpload(u)} className="h-8 rounded-full border border-white/60 bg-transparent px-2.5 text-micro font-medium text-white">Remove</button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <Spinner size={22} />
            <span className="text-micro tabular-nums">{u.progress}%</span>
            <span className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/30"><span className="block h-full bg-primary transition-[width]" style={{ width: `${u.progress}%` }} /></span>
          </div>
        )}
      </li>,
    );
  });
  for (let i = 0; i < slots; i++) {
    const first = i === 0;
    const index = photos.length + uploads.length + i;
    tiles.push(
      <li key={`empty-${i}`} className={tileClass(index)}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={total === 0 && first ? "Add main photo" : "Add photo"}
          className="grid aspect-[3/4] size-full place-items-center rounded-xl bg-surface-muted text-micro text-text-secondary"
        >
          {total === 0 && first ? "Main photo" : first ? "Add photo" : <PlusIcon size={16} />}
        </button>
      </li>,
    );
  }

  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onFiles(e.target.files)} />
      <ul className={cn("m-0 grid list-none grid-cols-3 gap-2.5 p-0", featured && "auto-rows-fr")}>{tiles}</ul>
      {reviewedBeforeVisible ? <ReviewNotice photos={photos} /> : null}
      {note ? <p className="text-caption text-text-secondary">{note}</p> : null}
      {error ? <p role="alert" className="text-caption font-medium text-danger">{error}</p> : null}
      {footer ? footer({ photos, activeCount, uploading, busy }) : null}
    </div>
  );
}

/**
 * What is actually true of these photos right now, said plainly: how many are waiting, and whether the profile is
 * visible in Discover yet. Without it an uploaded photo looks published the moment it appears in the grid, which is
 * the opposite of what happens — it is hidden until a reviewer approves it.
 */
function ReviewNotice({ photos }: { photos: PhotoDto[] }) {
  const pending = photos.filter((p) => p.moderation === "PENDING").length;
  const approved = photos.filter((p) => p.moderation === "APPROVED").length;
  const rejected = photos.filter((p) => p.moderation === "REJECTED").length;
  if (pending === 0 && rejected === 0) return null;

  const lines: string[] = [];
  if (pending > 0) {
    lines.push(
      pending === 1
        ? "1 photo is being reviewed. Nobody else can see it yet."
        : `${pending} photos are being reviewed. Nobody else can see them yet.`,
    );
  }
  if (rejected > 0) lines.push(rejected === 1 ? "1 photo wasn't allowed. Remove it and add another." : `${rejected} photos weren't allowed. Remove them and add others.`);
  if (approved < PHOTO_LIMITS.min) {
    lines.push(`Your profile appears in Discover once ${PHOTO_LIMITS.min} of your photos are approved (${approved} so far).`);
  }

  return (
    <div role="status" className="flex flex-col gap-1 rounded-xl bg-surface-muted px-3.5 py-3 text-caption text-text-secondary">
      {lines.map((line) => (
        <p key={line} className="m-0">{line}</p>
      ))}
    </div>
  );
}
