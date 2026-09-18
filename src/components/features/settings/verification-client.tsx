"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { VerificationStateDto } from "@/server/verification";
import { Callout } from "@/components/ui/alert";
import { Button, Spinner } from "@/components/ui/button";
import { CheckIcon, VerifiedBadge } from "@/components/ui/icons";
import { ListGroup } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";

/*
 * Photo verification, member side (docs/ARCHITECTURE.md §11). Four states driven by the server: not started
 * (instructions → take or choose a selfie → preview → submit), under review (own selfie, submitted time), not
 * approved (reason, retry time, then the same flow) and photo verified. The badge is described as exactly what it
 * is. The client sends a file and nothing else; eligibility, retry window and status are the server's.
 */
const ACCEPT = "image/jpeg,image/png,image/webp";

const INSTRUCTIONS: [string, string][] = [
  ["A recent photo of you", "Taken now or in the last few days"],
  ["Face clearly visible", "Look straight at the camera, no sunglasses or masks"],
  ["Good light", "Daylight or a bright room, no heavy filters"],
  ["Only you in the frame", "Nobody else, no photos of photos"],
];

function upload(file: File, onProgress: (pct: number) => void): Promise<VerificationStateDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/verification/selfie");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { verification?: VerificationStateDto; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.verification) resolve(body.verification);
        else reject(new Error(body.error ?? "We couldn't save that selfie. Try again."));
      } catch {
        reject(new Error("We couldn't save that selfie. Try again."));
      }
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

function Seal({ verified }: { verified: boolean }) {
  return (
    <span className={cn("grid size-21 place-items-center rounded-full", verified ? "bg-aqua-soft" : "bg-surface-muted")} aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill={verified ? "var(--accent)" : "var(--border)"}><path d="M12 2l2.4 2.1 3.1-.4 1 3 2.9 1.3-.6 3.1 1.9 2.5-1.9 2.5.6 3.1-2.9 1.3-1 3-3.1-.4L12 22l-2.4-2.1-3.1.4-1-3-2.9-1.3.6-3.1L1.3 12l1.9-2.5-.6-3.1 2.9-1.3 1-3 3.1.4z" /><path d="M8.5 12l2.3 2.3 4.7-4.8" stroke={verified ? "var(--on-accent)" : "var(--text-secondary)"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

export function VerificationClient({ initial }: { initial: VerificationStateDto }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // Object URLs are created when a file is chosen and revoked when it is replaced or the screen unmounts.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setError(null);
  };

  const submit = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const next = await upload(file, setProgress);
      setState(next);
      setFile(null);
      setPreview(null);
      toast.show("Selfie sent · under review");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save that selfie. Try again.");
    } finally {
      setProgress(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  };

  const uploading = progress !== null;
  const phase = state.phase;
  const retryPending = phase === "REJECTED" && !state.canSubmit && state.retryAvailableAt;
  const title = phase === "VERIFIED" ? "Photo verified" : phase === "PENDING" ? "Under review" : phase === "REJECTED" ? "Not approved yet" : "Get verified";
  const subtitle =
    phase === "VERIFIED"
      ? "Your photos have been checked against a selfie by our team. The badge tells people your photos show you."
      : phase === "PENDING"
        ? "Our team compares your selfie with your profile photos, usually within 24 hours. Nothing else is needed from you."
        : phase === "REJECTED"
          ? "Your last selfie couldn't be matched to your profile photos. You can try again with a clearer one."
          : "A short selfie check. Our team compares it with your profile photos and, if they show the same person, your profile gets the Photo verified badge.";

  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2.5 text-center" aria-live="polite">
        <Seal verified={phase === "VERIFIED"} />
        <h2 className="text-[22px] font-extrabold tracking-[-.02em] text-text">{title}</h2>
        <p className="max-w-80 text-body-sm leading-normal text-text-secondary">{subtitle}</p>
      </div>

      {phase === "VERIFIED" ? (
        <Callout tone="success" title="What the badge means" icon={<VerifiedBadge size={18} />}>
          Photo verified means a person on our team checked that a selfie you took matches your profile photos. It is not an identity, age or background check, and signing in with Google was not part of it.
        </Callout>
      ) : null}

      {phase === "PENDING" ? (
        <div className="flex flex-col gap-3">
          <Callout tone="info" title={`Submitted ${formatDateTime(state.submittedAt)}`}>We&apos;ll let you know here and on your profile once it has been reviewed. Your selfie is never shown to other members.</Callout>
          {state.selfieUrl ? (
            <figure className="mx-auto w-40 overflow-hidden rounded-2xl bg-surface-muted">
              {/* Short-lived signed URL to the member's own private selfie. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.selfieUrl} alt="The selfie you submitted" className="aspect-[3/4] w-full object-cover" />
              <figcaption className="px-2 py-1.5 text-center text-caption-sm text-text-secondary">Your submitted selfie</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}

      {phase === "REJECTED" ? (
        <Callout tone="warning" title="Why it wasn't approved">
          {state.rejectionReason ?? "The selfie couldn't be matched to your profile photos."}
          {retryPending ? <div className="mt-1 font-semibold">You can try again after {formatDateTime(state.retryAvailableAt)}.</div> : null}
        </Callout>
      ) : null}

      {(phase === "NONE" || phase === "REJECTED") && state.canSubmit ? (
        <>
          <ListGroup>
            {INSTRUCTIONS.map(([label, sub]) => (
              <div key={label} className="flex items-center gap-3.5 px-4.5 py-3.5">
                <span className="grid size-8.5 shrink-0 place-items-center rounded-full bg-aqua-soft text-accent"><CheckIcon size={16} strokeWidth={2.4} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-body font-bold text-text">{label}</div>
                  <div className="text-caption-sm text-text-secondary">{sub}</div>
                </div>
              </div>
            ))}
          </ListGroup>

          <input ref={cameraRef} type="file" accept={ACCEPT} capture="user" className="sr-only" aria-label="Take a selfie with the camera" onChange={(e) => pick(e.target.files?.[0])} />
          <input ref={libraryRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a selfie from your photos" onChange={(e) => pick(e.target.files?.[0])} />

          {preview ? (
            <figure className="mx-auto w-44 overflow-hidden rounded-2xl bg-surface-muted">
              {/* Local object URL of the file the member just chose; nothing has been uploaded yet. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Preview of the selfie you chose" className="aspect-[3/4] w-full object-cover" />
              <figcaption className="px-2 py-1.5 text-center text-caption-sm text-text-secondary">{file?.name ? "Ready to submit" : ""}</figcaption>
            </figure>
          ) : null}

          {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
          {uploading ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-aqua-soft px-4 py-3 text-caption font-semibold text-on-aqua-soft" role="status" aria-live="polite">
              <Spinner size={16} /> {progress && progress < 100 ? `Uploading ${progress}%` : "Saving your selfie…"}
            </div>
          ) : null}

          <div className="flex flex-col gap-2.5">
            {file ? (
              <>
                <Button variant="primary" size="lg" fullWidth onClick={submit} loading={uploading}>Submit for review</Button>
                <Button variant="muted" size="md" fullWidth onClick={clearFile} disabled={uploading}>Choose a different photo</Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="lg" fullWidth onClick={() => cameraRef.current?.click()}>Take a selfie</Button>
                <Button variant="secondary" size="md" fullWidth onClick={() => libraryRef.current?.click()}>Choose from photos</Button>
              </>
            )}
          </div>
          <p className="px-1 text-center text-caption-sm leading-relaxed text-text-secondary">JPG, PNG or WebP up to 8 MB. Your selfie is stored privately, seen only by our review team, and never shown on your profile.</p>
        </>
      ) : null}

      {phase !== "VERIFIED" ? <p className="px-1 text-center text-caption-sm leading-relaxed text-text-secondary">Signing in with Google confirms your Google account, not who is in your photos. Verification is separate and optional.</p> : null}
    </>
  );
}
