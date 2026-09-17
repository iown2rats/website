"use client";

import Image from "next/image";
import { useActionState, useRef, useState, useTransition } from "react";
import { submitPhotos, type StageFormState } from "@/actions/onboarding";
import { removePhoto, reorderMyPhotos } from "@/actions/photos";
import { PHOTO_LIMITS } from "@/config/product";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/badge";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/button";
import type { PhotoDto } from "@/server/photos/photos";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 9 / Edit profile → Photos: 3-column grid of 3:4 tiles (radius 18, dashed empty tiles; first tile
 * "Main photo"), note "Add at least 2. Your face should be clearly visible in the first.", remove ✕ 28 px,
 * drag to reorder. Uploads go through /api/photos via XHR for real progress; keyboard users reorder with the
 * move buttons. The server owns validation, ordering and limits.
 */
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

export function PhotosForm({ initialPhotos }: { initialPhotos: PhotoDto[] }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitPhotos, {});
  const [photos, setPhotos] = useState<PhotoDto[]>(initialPhotos);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);

  const total = photos.length + uploads.filter((u) => !u.error).length;
  const slots = Math.max(0, PHOTO_LIMITS.max - total);
  const activeCount = photos.filter((p) => p.moderation !== "REJECTED").length;

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
    startTransition(async () => {
      const result = await reorderMyPhotos({ photoIds: next.map((p) => p.id) });
      if (result.ok) setPhotos(result.photos);
      else setError(result.error);
    });
  };

  const tiles: React.ReactNode[] = [];
  photos.forEach((p, i) => {
    tiles.push(
      <li
        key={p.id}
        draggable
        onDragStart={() => { dragFrom.current = i; }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (dragFrom.current != null) move(dragFrom.current, i); dragFrom.current = null; }}
        className={cn("group relative aspect-[3/4] overflow-hidden rounded-xl border-[1.5px] border-border bg-surface-muted", p.moderation === "REJECTED" && "opacity-60")}
      >
        <Image src={p.thumbUrl} alt={`Photo ${i + 1}${i === 0 ? " (main photo)" : ""}`} fill unoptimized sizes="33vw" className="object-cover" draggable={false} />
        {p.isPrimary ? (
          <span className="absolute bottom-2.5 left-2.5 inline-flex h-6 items-center rounded-xs bg-white px-2.5 text-micro font-extrabold text-ocean shadow-sm">Main photo</span>
        ) : null}
        {p.moderation === "REJECTED" ? <Tag variant="danger" size="md" className="absolute left-2.5 top-2.5">Not allowed</Tag> : null}
        <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(p.id)} disabled={busy} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full border-0 bg-[rgba(6,20,26,.55)] text-white">
          <CloseIcon size={14} strokeWidth={2.6} />
        </button>
        <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" aria-label={`Move photo ${i + 1} earlier`} onClick={() => move(i, i - 1)} disabled={i === 0 || busy} className="grid size-7 place-items-center rounded-full border-0 bg-white/90 text-ocean disabled:opacity-30"><ChevronLeftIcon size={14} /></button>
          <button type="button" aria-label={`Move photo ${i + 1} later`} onClick={() => move(i, i + 1)} disabled={i === photos.length - 1 || busy} className="grid size-7 place-items-center rounded-full border-0 bg-white/90 text-ocean disabled:opacity-30"><ChevronRightIcon size={14} /></button>
        </div>
      </li>,
    );
  });
  uploads.forEach((u) => {
    tiles.push(
      <li key={u.localId} className="relative aspect-[3/4] overflow-hidden rounded-xl border-[1.5px] border-border bg-surface-muted" aria-live="polite">
        {u.previewBroken ? null : (
          <Image
            src={u.previewUrl}
            alt=""
            fill
            unoptimized
            sizes="33vw"
            className={cn("object-cover", !u.error && "opacity-60")}
            onError={() => setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, previewBroken: true } : x)))}
          />
        )}
        {u.error ? (
          <button type="button" onClick={() => retry(u)} className="absolute inset-0 flex flex-col items-center justify-center gap-1 border-0 bg-[rgba(6,20,26,.6)] p-2 text-center text-white">
            <span className="text-caption-sm font-semibold leading-snug">{u.error}</span>
            <span className="text-micro underline">Tap to retry</span>
          </button>
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
    tiles.push(
      <li key={`empty-${i}`}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={total === 0 && first ? "Add main photo" : "Add photo"}
          className="grid aspect-[3/4] w-full place-items-center rounded-xl border-[1.5px] border-dashed border-border bg-surface-muted text-micro text-text-secondary"
        >
          {total === 0 && first ? "Main photo" : first ? "Add photo" : <PlusIcon size={16} />}
        </button>
      </li>,
    );
  }

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onFiles(e.target.files)} />
      <ul className="grid grid-cols-3 gap-2.5 list-none p-0 m-0">{tiles}</ul>
      <p className="text-caption text-text-secondary">Add at least {PHOTO_LIMITS.min}. Your face should be clearly visible in the first. JPG, PNG or WebP up to 8 MB.</p>
      <FormError message={error ?? state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={activeCount < PHOTO_LIMITS.min || uploads.some((u) => !u.error) || busy}>
          {activeCount < PHOTO_LIMITS.min ? `Add ${PHOTO_LIMITS.min - activeCount} more photo${PHOTO_LIMITS.min - activeCount === 1 ? "" : "s"}` : "Continue"}
        </SubmitButton>
      </div>
    </form>
  );
}
