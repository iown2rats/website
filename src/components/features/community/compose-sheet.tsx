"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COMMUNITY } from "@/config/product";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { CloseIcon, ImageIcon, PinIcon } from "@/components/ui/icons";
import type { CommunityPostDto } from "@/server/community/dto";

/*
 * Prototype "New post" sheet: 22/800 title, three 44 px radius-14 kind pills (Text / Photo / Question; selected =
 * aqua-soft + primary border), 4-row textarea (radius 18) whose placeholder follows the kind, a 13 px footer
 * "Posting as Malé · Community posts don't create matches", and a 52 px ocean Post button. Photo posts upload
 * through POST /api/community/posts (multipart, progress via XHR); the server validates, re-encodes and holds the
 * photo under the active moderation policy.
 */

const KINDS = [
  { value: "TEXT", label: "Text", placeholder: "What's on your mind?" },
  { value: "PHOTO", label: "Photo", placeholder: "Add a caption…" },
  { value: "QUESTION", label: "Question", placeholder: "Ask the community something…" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

export interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Viewer's island label, or null when their location is hidden / unknown. */
  island: string | null;
  onPosted: (post: CommunityPostDto) => void;
}

export function ComposeSheet({ open, onClose, island, onPosted }: ComposeSheetProps) {
  const titleId = useId();
  const [kind, setKind] = useState<Kind>("TEXT");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => xhrRef.current?.abort(), []);

  const reset = () => {
    setKind("TEXT");
    setBody("");
    setFile(null);
    setPreview(null);
    setError(null);
    setProgress(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) { setFile(null); setPreview(null); return; }
    if (!ACCEPT.split(",").includes(f.type)) { setError("Choose a JPEG, PNG or WebP photo."); return; }
    if (f.size > MAX_BYTES) { setError("That photo is too large. Choose one under 8 MB."); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const placeholder = KINDS.find((k) => k.value === kind)!.placeholder;
  const trimmed = body.trim();
  const canPost = !busy && trimmed.length > 0 && trimmed.length <= COMMUNITY.postMaxLength && (kind !== "PHOTO" || file !== null);

  const submit = () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("body", body);
    if (kind === "PHOTO" && file) form.set("photo", file, file.name);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/community/posts");
    xhr.responseType = "json";
    if (kind === "PHOTO") {
      setProgress(0);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    }
    xhr.onerror = () => { setBusy(false); setProgress(null); setError("Couldn't reach Mellocrush. Check your connection and try again."); };
    xhr.onload = () => {
      xhrRef.current = null;
      setBusy(false);
      setProgress(null);
      const data = (xhr.response ?? null) as { post?: CommunityPostDto; error?: string } | null;
      if (xhr.status === 201 && data?.post) {
        const post = data.post;
        reset();
        onPosted(post);
        return;
      }
      if (xhr.status === 401) { setError("Your session ended. Sign in again to post."); return; }
      setError(data?.error ?? "We couldn't publish that right now. Try again.");
    };
    xhr.send(form);
  };

  return (
    <ResponsiveDialog open={open} onClose={close} labelledBy={titleId} dismissible={!busy}>
      <DialogTitle id={titleId}>New post</DialogTitle>

      <div className="flex gap-2" role="radiogroup" aria-label="Post type">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={kind === k.value}
            disabled={busy}
            onClick={() => { setKind(k.value); setError(null); }}
            className={cn("h-11 flex-1 rounded-[14px] text-body-sm font-medium text-text", kind === k.value ? "bg-primary text-on-primary" : "bg-surface-muted")}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${titleId}-body`} className="sr-only">Post text</label>
        <Textarea
          id={`${titleId}-body`}
          rows={4}
          value={body}
          disabled={busy}
          maxLength={COMMUNITY.postMaxLength}
          placeholder={placeholder}
          onChange={(e) => { setBody(e.target.value); setError(null); }}
          className="bg-surface-muted"
        />
        {body.length > COMMUNITY.postMaxLength - 200 ? (
          <p className="text-right text-micro tabular-nums text-text-secondary" aria-live="polite">{body.length}/{COMMUNITY.postMaxLength}</p>
        ) : null}
      </div>

      {kind === "PHOTO" ? (
        <div className="flex flex-col gap-2">
          <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          {preview ? (
            <div className="relative h-50 overflow-hidden rounded-xl bg-aqua-soft">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={preview} alt="Selected photo preview" className="size-full object-cover" />
              <button type="button" onClick={() => pickFile(null)} disabled={busy} aria-label="Remove photo" className="absolute right-2.5 top-2.5 grid size-9 place-items-center rounded-full border-0 bg-white/90 text-ocean shadow-sm">
                <CloseIcon size={18} strokeWidth={2.4} />
              </button>
              {progress != null ? (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload progress">
                  <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="flex h-30 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-muted text-text-secondary hover:bg-surface-muted">
              <ImageIcon size={24} />
              <span className="text-body-sm font-medium text-text">Add a photo</span>
              <span className="text-micro">JPEG, PNG or WebP · up to 8 MB</span>
            </button>
          )}
        </div>
      ) : null}

      {error ? <p role="alert" className="-mt-1 text-caption font-medium text-danger">{error}</p> : null}

      <p className="flex items-center gap-2.5 text-caption text-text-secondary">
        <PinIcon size={16} className="shrink-0" />
        <span>{island ? `Posting as ${island}` : "Posting to Community"} · Community posts don&apos;t create matches</span>
      </p>

      <Button variant="ocean" onClick={submit} disabled={!canPost} loading={busy} fullWidth>
        {busy && progress != null ? `Uploading ${progress}%` : "Post"}
      </Button>
    </ResponsiveDialog>
  );
}
