import Image from "next/image";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { intentLower } from "@/constants/labels";
import { isDemoPhoto, photoBackground } from "@/lib/photos";
import { PinIcon, VerifiedBadge } from "@/components/ui/icons";
import type { CardProfile } from "./types";

/*
 * Deck card (prototype lines 158–169): radius 26, shadow-lg, photo fills; bottom scrim 55 %;
 * 3 px photo bars (gap 5, top 12, inset 14); LIKE stamp (teal, rotate −12°, top 40 left 24) and PASS stamp
 * (white, rotate 12°, right 24); info block padding 18px 18px 20px, gap 7: name 28/800 + 20 px badge,
 * location · occupation 15 px with 14 px pin, "Looking for …" glass pill 30 px, interest chips 28 px white/.92 ocean 12.5/700.
 */
export interface ProfileCardProps {
  profile: CardProfile;
  photoIndex?: number;
  likeOpacity?: number;
  passOpacity?: number;
  /** Compact variant for the Likes/Matches 3:4 grid tiles. */
  variant?: "deck" | "tile";
  className?: string;
  style?: CSSProperties;
  /** Show the demo "PHOTO n" watermark on placeholder gradients (dev only). */
  showPlaceholderLabel?: boolean;
  /** Absolutely fill the parent (deck) instead of sizing itself (grid tiles, showcase). */
  fill?: boolean;
}

export function ProfileCard({
  profile,
  photoIndex = 0,
  likeOpacity = 0,
  passOpacity = 0,
  variant = "deck",
  className,
  style,
  showPlaceholderLabel = false,
  fill = false,
}: ProfileCardProps) {
  const photo = profile.photos[photoIndex] ?? profile.photos[0] ?? null;
  const title = profile.age != null ? `${profile.name}, ${profile.age}` : profile.name;
  const intent = intentLower(profile.intent);
  const meta = [profile.location, profile.occupation].filter(Boolean);

  return (
    <div
      className={cn(fill ? "absolute inset-0" : "relative", "overflow-hidden bg-aqua-soft select-none", variant === "deck" ? "rounded-card shadow-lg" : "rounded-3xl", className)}
      style={{ ...photoBackground(photo, 160), ...style }}
    >
      {photo?.url ? (
        // Signed, short-lived URLs from the storage layer; optimisation happens at upload time (server-produced variants).
        <Image src={photo.url} alt={photo.alt ?? ""} fill unoptimized sizes="(min-width: 900px) 500px, 100vw" className="object-cover" draggable={false} />
      ) : null}
      {showPlaceholderLabel && isDemoPhoto(photo) ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] font-semibold uppercase tracking-[.14em] text-white/45">
          Photo {photoIndex + 1}
        </span>
      ) : null}

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 photo-scrim" style={{ height: variant === "deck" ? "55%" : "55%" }} />

      {variant === "deck" && profile.photos.length > 1 ? (
        <div className="pointer-events-none absolute left-3.5 right-3.5 top-3 flex gap-1.25" aria-hidden="true">
          {profile.photos.map((_, i) => (
            <span key={i} className="h-[3px] flex-1 rounded-[2px] bg-white transition-opacity duration-200" style={{ opacity: i === photoIndex ? 1 : 0.4 }} />
          ))}
        </div>
      ) : null}

      {variant === "deck" ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-6 top-10 rounded-sm border-[2.5px] border-primary px-3.5 py-2 text-h3 tracking-[.06em] text-primary transition-opacity duration-100 -rotate-12"
            style={{ opacity: likeOpacity }}
          >
            LIKE
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-6 top-10 rounded-sm border-[2.5px] border-white px-3.5 py-2 text-h3 tracking-[.06em] text-white transition-opacity duration-100 rotate-12"
            style={{ opacity: passOpacity }}
          >
            PASS
          </span>
        </>
      ) : null}

      <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex flex-col text-on-photo", variant === "deck" ? "gap-1.75 px-4.5 pb-5 pt-4.5" : "gap-0.5 p-3.5")}>
        <div className="flex items-baseline gap-2">
          <span className={variant === "deck" ? "text-name" : "text-[17px] font-extrabold leading-tight"}>{title}</span>
          {profile.verified ? <VerifiedBadge size={variant === "deck" ? 20 : 15} className="shrink-0 self-center" /> : null}
        </div>
        {variant === "deck" ? (
          <>
            {meta.length > 0 ? (
              <div className="flex items-center gap-1.5 text-body text-on-photo-muted">
                <PinIcon size={14} strokeWidth={2.2} className="shrink-0" />
                <span className="truncate">{meta.join(" · ")}</span>
              </div>
            ) : null}
            {intent ? (
              <span className="inline-flex h-7.5 items-center self-start gap-1.5 rounded-full bg-on-photo-glass px-3 text-caption font-semibold backdrop-blur-[8px]">
                Looking for {intent}
              </span>
            ) : null}
            {profile.interests.length > 0 ? (
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {profile.interests.slice(0, 3).map((t) => (
                  <span key={t} className="inline-flex h-7 items-center rounded-full bg-white/92 px-3 text-caption-sm font-bold text-ocean">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : profile.location ? (
          <span className="text-caption text-on-photo-muted">{profile.location}</span>
        ) : null}
      </div>
    </div>
  );
}
