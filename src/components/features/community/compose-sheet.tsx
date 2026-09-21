"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COMMUNITY } from "@/config/product";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { CloseIcon, ImageIcon, PinIcon, PlusIcon, WhisperIcon } from "@/components/ui/icons";
import type { CommunityPostDto, CommunityPostKind } from "@/server/community/dto";
import { POLL_RULES } from "@/server/community/rules";
import { suggestedTopic, type TopicKey } from "@/server/community/topics";
import { CONFESSION_NOTICE, postKind } from "./post-kinds";
import { TopicChips } from "./topic-chips";

/*
 * The compose form. The KIND is chosen before this opens (create-menu.tsx, or one of the quick-post shortcuts),
 * so the sheet no longer carries a row of kind pills — five of them do not fit across a 320 px screen, and the
 * choice has already been made by the time you get here. "Change type" hands the decision back to the menu.
 *
 * Photo posts still upload through POST /api/community/posts (multipart, progress via XHR); the server validates,
 * re-encodes and holds the photo under the active moderation policy. Polls and confessions go through the same
 * endpoint, which carries no "anonymous" field at all: a confession is anonymous because of its kind, decided on
 * the server, so nothing a client sends can make a confession signed or make anything else anonymous.
 */

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;
const EMPTY_OPTIONS = ["", ""];

export interface ComposeSheetProps {
  open: boolean;
  kind: CommunityPostKind;
  onClose: () => void;
  /** Reopens the kind menu without losing the sheet's place in the flow. */
  onChangeKind?: () => void;
  /** Viewer's island label, or null when their location is hidden / unknown. */
  island: string | null;
  onPosted: (post: CommunityPostDto) => void;
}

export function ComposeSheet({ open, kind, onClose, onChangeKind, island, onPosted }: ComposeSheetProps) {
  const titleId = useId();
  const [body, setBody] = useState("");
  // `undefined` = the author has not touched the chips, so the kind's own suggestion stands. Deriving it rather
  // than seeding it from an effect keeps "which topic is selected" a single source of truth and avoids a render
  // pass where the sheet is open with the wrong chip lit.
  const [topic, setTopic] = useState<TopicKey | null | undefined>(undefined);
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const spec = postKind(kind);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => xhrRef.current?.abort(), []);
  // A fresh kind starts on its own chip: a poll under Polls, a confession under Confessions. The author can still
  // move it, including to "All", which is why `null` and `undefined` mean different things above.
  const chosenTopic = topic === undefined ? suggestedTopic(kind) : topic;

  const reset = () => {
    setBody("");
    setTopic(undefined);
    setOptions(EMPTY_OPTIONS);
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

  const setOption = (index: number, value: string) => setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  const addOption = () => setOptions((prev) => (prev.length < POLL_RULES.maxOptions ? [...prev, ""] : prev));
  const removeOption = (index: number) => setOptions((prev) => (prev.length > POLL_RULES.minOptions ? prev.filter((_, i) => i !== index) : prev));

  const filledOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const trimmed = body.trim();
  const canPost =
    !busy &&
    trimmed.length > 0 &&
    trimmed.length <= COMMUNITY.postMaxLength &&
    (kind !== "PHOTO" || file !== null) &&
    (kind !== "POLL" || (filledOptions.length >= POLL_RULES.minOptions && new Set(filledOptions.map((o) => o.toLowerCase())).size === filledOptions.length));

  const submit = () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("body", body);
    if (chosenTopic) form.set("topic", chosenTopic);
    if (kind === "PHOTO" && file) form.set("photo", file, file.name);
    if (kind === "POLL") for (const option of filledOptions) form.append("option", option);
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
      <div className="flex items-baseline justify-between gap-3">
        <DialogTitle id={titleId}>New {spec.label.toLowerCase()}</DialogTitle>
        {onChangeKind ? (
          <button type="button" disabled={busy} onClick={onChangeKind} className="shrink-0 border-0 bg-transparent p-0 text-caption font-medium text-primary-ink underline decoration-primary/40 underline-offset-[3px] disabled:opacity-60">
            Change type
          </button>
        ) : null}
      </div>

      {kind === "CONFESSION" ? (
        <p className="flex items-start gap-2.5 rounded-xl bg-surface-muted p-3 text-caption text-text-secondary">
          <WhisperIcon size={16} className="mt-0.5 shrink-0 text-primary-ink" />
          <span>{CONFESSION_NOTICE}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${titleId}-body`} className="sr-only">Post text</label>
        <Textarea
          id={`${titleId}-body`}
          rows={4}
          value={body}
          disabled={busy}
          maxLength={COMMUNITY.postMaxLength}
          placeholder={spec.placeholder}
          onChange={(e) => { setBody(e.target.value); setError(null); }}
          className="bg-surface-muted"
        />
        {body.length > COMMUNITY.postMaxLength - 200 ? (
          <p className="text-right text-micro tabular-nums text-text-secondary" aria-live="polite">{body.length}/{COMMUNITY.postMaxLength}</p>
        ) : null}
      </div>

      {kind === "POLL" ? (
        <div className="flex flex-col gap-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <label htmlFor={`${titleId}-option-${index}`} className="sr-only">{`Option ${index + 1}`}</label>
              <Input
                id={`${titleId}-option-${index}`}
                value={option}
                disabled={busy}
                maxLength={POLL_RULES.optionMaxLength}
                placeholder={`Option ${index + 1}`}
                onChange={(e) => { setOption(index, e.target.value); setError(null); }}
                className="min-w-0 flex-1 bg-surface-muted"
              />
              {options.length > POLL_RULES.minOptions ? (
                <button type="button" disabled={busy} onClick={() => removeOption(index)} aria-label={`Remove option ${index + 1}`} className="grid size-9 shrink-0 place-items-center rounded-full border-0 bg-transparent text-text-secondary hover:bg-surface-muted">
                  <CloseIcon size={17} />
                </button>
              ) : null}
            </div>
          ))}
          {options.length < POLL_RULES.maxOptions ? (
            <button type="button" disabled={busy} onClick={addOption} className="flex h-9 items-center gap-1.5 self-start rounded-full border-0 bg-surface-muted px-3 text-caption font-medium text-text">
              <PlusIcon size={15} />
              Add option
            </button>
          ) : null}
        </div>
      ) : null}

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

      <div className="flex flex-col gap-1.5">
        <span className="text-caption-sm text-text-secondary">Topic (optional)</span>
        <TopicChips value={chosenTopic} onChange={setTopic} disabled={busy} />
      </div>

      {error ? <p role="alert" className="-mt-1 text-caption font-medium text-danger">{error}</p> : null}

      <p className="flex items-center gap-2.5 text-caption text-text-secondary">
        <PinIcon size={16} className="shrink-0" />
        <span>
          {kind === "CONFESSION" ? "Posting anonymously" : island ? `Posting as ${island}` : "Posting to Community"} · Community posts don&apos;t create matches
        </span>
      </p>

      <Button variant="ocean" onClick={submit} disabled={!canPost} loading={busy} fullWidth className={cn(busy && "pointer-events-none")}>
        {busy && progress != null ? `Uploading ${progress}%` : "Post"}
      </Button>
    </ResponsiveDialog>
  );
}
