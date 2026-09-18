import type { SVGProps } from "react";

/**
 * Mellocrush icon set — line icons on a 24 grid with round caps, stroke 2–2.4, from the prototype.
 * Every icon is decorative by default (aria-hidden); pass `title` for a labelled standalone icon.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "strokeWidth"> {
  size?: number;
  strokeWidth?: number;
  title?: string;
}

function Base({ size = 20, strokeWidth = 2, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const WavesIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 15c3-4 6-4 9 0s6 4 9 0" />
    <path d="M3 9c3-4 6-4 9 0s6 4 9 0" />
  </Base>
);
export const PeopleIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8M21 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8" />
  </Base>
);
export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Base {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M12 21s-7.5-4.6-9.5-9.3C1 7.6 3.6 4 7.2 4c2 0 3.6 1 4.8 2.6C13.2 5 14.8 4 16.8 4c3.6 0 6.2 3.6 4.7 7.7C19.5 16.4 12 21 12 21z" />
  </Base>
);
export const ChatIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12a8 8 0 01-11.6 7.2L4 21l1.8-5A8 8 0 1121 12z" />
  </Base>
);
export const ChatPlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12a8 8 0 01-11.6 7.2L4 21l1.8-5A8 8 0 1121 12z" />
    <path d="M9 12h6" />
  </Base>
);
export const PersonIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 12a4 4 0 100-8 4 4 0 000 8M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
  </Base>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Base>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);
export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);
export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12l5 5L20 7" />
  </Base>
);
export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);
export const FilterIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M7 12h10M10 17h4" />
  </Base>
);
export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Base>
);
export const MoreIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Base>
);
export const PinIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.4" />
  </Base>
);
export const InfoIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </Base>
);
export const ShieldIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Base>
);
export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </Base>
);
export const MoonIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </Base>
);
export const SunIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);
export const ImageIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 15l-5-4-9 8" />
  </Base>
);
export const SendIcon = (p: IconProps) => (
  <Base {...p} strokeWidth={p.strokeWidth ?? 2.4}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Base>
);
export const ShareIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 15V3M7 8l5-5 5 5" />
  </Base>
);
export const UndoIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </Base>
);
export const EyeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7s-9-4-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);
export const EyeOffIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 002.8 2.8" />
    <path d="M9.9 5.1A10.4 10.4 0 0112 5c5 0 9 4 10 7-.4 1.1-1.2 2.4-2.4 3.6M6.6 6.6C4.4 8 2.8 10 2 12c1 3 5 7 10 7 1.6 0 3.1-.4 4.4-1" />
  </Base>
);
export const BoltIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </Base>
);
export const WifiOffIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015.6-2.9M12 20h.01M16.2 9.2A10 10 0 0119 13" />
  </Base>
);

/** Verified seal: 12-point teal badge with a plum check. Filled, not stroked. Teal marks trust (docs/DESIGN_SYSTEM.md §2). */
export function VerifiedBadge({ size = 20, className, title = "Photo verified" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <path
        fill="var(--accent)"
        d="M12 2l2.4 2.1 3.1-.4 1 3 2.9 1.3-.6 3.1 1.9 2.5-1.9 2.5.6 3.1-2.9 1.3-1 3-3.1-.4L12 22l-2.4-2.1-3.1.4-1-3-2.9-1.3.6-3.1L1.3 12l1.9-2.5-.6-3.1 2.9-1.3 1-3 3.1.4z"
      />
      <path d="M8.5 12l2.3 2.3 4.7-4.8" stroke="var(--on-accent)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

