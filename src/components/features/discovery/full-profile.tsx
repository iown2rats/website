"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { intentLower, INTENT_LABELS } from "@/constants/labels";
import { cn } from "@/lib/cn";
import { photoBackground } from "@/lib/photos";
import { ChevronLeftIcon, CloseIcon, HeartIcon, VerifiedBadge } from "@/components/ui/icons";
import type { DeckCard } from "./types";

/*
 * Prototype "FULL PROFILE" overlay: hero photo min(70vh, 560px) with 50 % scrim, 44 px white round Back button,
 * name 30/800 + 22 px seal, location 15 px at 85 % white; then 20 px gap sections: ABOUT ME label + 16 px bio,
 * 40 px aqua-soft "Looking for" pill, prompt card (radius 24, 22 padding, 13 px label + 19/700 answer),
 * second photo 320 px radius 22, info rows (15 px, label secondary / value 600), INTERESTS chips 38 px bordered,
 * ocean prompt card, third photo, and floating Pass 60 / Like 66 controls at bottom 18 px. Report/Block arrive
 * with Safety (Phase 10). Only safe DTO fields are rendered; hidden age/location are simply absent.
 */
export interface FullProfileProps {
  profile: DeckCard;
  onClose: () => void;
  /** When provided the floating Pass/Like controls are shown (the card is the current deck head). */
  onPass?: () => void;
  onLike?: () => void;
}

function Photo({ photo, alt, className, priority = false }: { photo: DeckCard["photos"][number] | undefined; alt: string; className?: string; priority?: boolean }) {
  if (!photo) return null;
  return (
    <div className={cn("relative overflow-hidden bg-aqua-soft", className)} style={photoBackground(photo)}>
      {photo.url ? <Image src={photo.url} alt={alt} fill unoptimized sizes="(min-width: 900px) 640px, 100vw" className="object-cover" priority={priority} loading={priority ? undefined : "lazy"} /> : null}
    </div>
  );
}

export function FullProfile({ profile, onClose, onPass, onLike }: FullProfileProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = profile.age != null ? `${profile.name}, ${profile.age}` : profile.name;
  const intent = intentLower(profile.intent);
  const [firstPrompt, secondPrompt] = profile.prompts;
  const info: [string, string][] = [
    ["Occupation", profile.occupation ?? ""],
    ["Education", profile.education ?? ""],
    ["Location", profile.location ?? ""],
    ["Languages", profile.languages.join(", ")],
    ["Height", profile.heightCm ? `${profile.heightCm} cm` : ""],
    ["Looking for", profile.intent ? ((INTENT_LABELS as Record<string, string>)[profile.intent] ?? "") : ""],
  ];
  const rows = info.filter(([, v]) => v);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${profile.name}'s profile`} className="absolute inset-0 z-30 flex justify-center bg-background text-text animate-fade-in">
      <div className="relative flex min-h-0 w-full max-w-[var(--content-max)] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-30">
          <div className="relative h-[min(70vh,560px)]">
            <Photo photo={profile.photos[0]} alt={profile.photos[0]?.alt ?? profile.name} className="absolute inset-0" priority />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 photo-scrim" />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="absolute left-4 grid size-11 place-items-center rounded-full border-0 bg-white/90 text-ocean pressable-round"
              style={{ top: "calc(14px + var(--safe-top))" }}
            >
              <ChevronLeftIcon size={20} strokeWidth={2.2} />
            </button>
            <div className="absolute inset-x-6 bottom-6 flex flex-col gap-1.5 text-on-photo">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[30px] font-extrabold leading-none tracking-[-.025em]">{title}</h2>
                {profile.verified ? <VerifiedBadge size={22} className="self-center" /> : null}
              </div>
              {profile.location ? <p className="text-body text-on-photo-muted">{profile.location}</p> : null}
              {profile.isActiveNow ? <p className="text-caption font-semibold text-aqua">Active now</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-5 px-4 py-5">
            {profile.bio ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-tag font-bold uppercase tracking-[.08em] text-text-secondary">About me</h3>
                <p className="text-body-lg leading-normal">{profile.bio}</p>
              </section>
            ) : null}
            {intent ? (
              <span className="inline-flex h-10 items-center gap-2 self-start rounded-full bg-aqua-soft px-4 text-body-sm font-bold text-on-aqua-soft">
                <HeartIcon size={16} strokeWidth={2.2} />
                Looking for {intent}
              </span>
            ) : null}
            {firstPrompt ? (
              <div className="flex flex-col gap-2.5 rounded-3xl border border-border bg-surface p-5.5 shadow-sm">
                <div className="text-[13px] font-semibold text-text-secondary">{firstPrompt.prompt}</div>
                <div className="text-prompt font-bold leading-[1.35] tracking-[-.015em] text-pretty">{firstPrompt.answer}</div>
              </div>
            ) : null}
            <Photo photo={profile.photos[1]} alt={profile.photos[1]?.alt ?? ""} className="h-80 rounded-[22px]" />
            {rows.length > 0 ? (
              <dl className="m-0 overflow-hidden rounded-3xl border border-border bg-surface [&>div+div]:border-t [&>div+div]:border-border">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-5 py-3.75 text-body">
                    <dt className="text-text-secondary">{k}</dt>
                    <dd className="m-0 text-right font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {profile.interests.length > 0 ? (
              <section className="flex flex-col gap-2.5">
                <h3 className="text-tag font-bold uppercase tracking-[.08em] text-text-secondary">Interests</h3>
                <div className="flex flex-wrap gap-2">
                  {profile.interests.map((t) => (
                    <span key={t} className="inline-flex h-9.5 items-center rounded-full border border-border bg-surface px-4 text-body-sm font-semibold">{t}</span>
                  ))}
                </div>
              </section>
            ) : null}
            {secondPrompt ? (
              <div className="flex flex-col gap-2.5 rounded-3xl bg-ocean p-5.5 text-on-ocean">
                <div className="text-[13px] font-semibold text-aqua">{secondPrompt.prompt}</div>
                <div className="text-prompt font-bold leading-[1.35] tracking-[-.015em]">{secondPrompt.answer}</div>
              </div>
            ) : null}
            <Photo photo={profile.photos[2]} alt={profile.photos[2]?.alt ?? ""} className="h-80 rounded-[22px]" />
            {profile.photos.slice(3).map((p, i) => <Photo key={i} photo={p} alt={p.alt ?? ""} className="h-80 rounded-[22px]" />)}
          </div>
        </div>

        {onPass && onLike ? (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center gap-5.5" style={{ bottom: "calc(18px + var(--safe-bottom))" }}>
            <button type="button" onClick={onPass} aria-label="Pass" className="pointer-events-auto grid size-15 place-items-center rounded-full border border-border bg-surface text-text shadow-lg pressable-round">
              <CloseIcon size={24} strokeWidth={2.4} />
            </button>
            <button type="button" onClick={onLike} aria-label="Like" className="pointer-events-auto grid size-16.5 place-items-center rounded-full border-0 like-gradient text-white shadow-like pressable-round">
              <HeartIcon size={30} filled strokeWidth={0} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
