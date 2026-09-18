import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Buttons — geometry from the prototype (primary 52 px radius 16, 16–17 px/700; secondary bordered surface; ghost
 * 44 px). Colour follows the Pastel Rose / Teal identity: every high-emphasis action (primary, the historic "ocean"
 * Post/Submit/Approve variant and the "plus" upgrade variant) is rose with plum text; there are no dark-teal blocks. Press feedback scale(.97) over 120 ms.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "ocean" | "plus" | "white" | "muted";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed border-0",
  secondary: "bg-surface text-text border border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-text-secondary hover:text-text border-0",
  destructive: "bg-transparent text-danger border border-border hover:bg-surface-muted",
  ocean: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed border-0",
  plus: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed border-0",
  white: "bg-white text-text border-0",
  muted: "bg-surface-muted text-text border-0 hover:bg-border",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-body-sm font-bold rounded-lg",
  md: "h-12 px-5 text-body-sm font-bold rounded-lg",
  lg: "h-13 px-6 text-body-lg font-bold rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "lg", loading = false, fullWidth = false, leadingIcon, trailingIcon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 select-none whitespace-nowrap pressable",
        "disabled:opacity-45 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leadingIcon}
      <span className={cn(loading && "opacity-80")}>{children}</span>
      {trailingIcon}
    </button>
  );
});

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("animate-spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/*
 * Icon buttons — 44 × 44 radius 14 bordered surface (headers), round white-on-photo, ghost, muted bg2 circle (composer),
 * and 36 × 36 radius 12 ghost (post options). `aria-label` is required.
 */
export type IconButtonVariant = "bordered" | "ghost" | "onPhoto" | "muted" | "primary" | "ocean";
export type IconButtonSize = 36 | 44 | 48 | 54 | 56 | 60 | 66;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  round?: boolean;
  elevated?: boolean;
}

const iconVariant: Record<IconButtonVariant, string> = {
  bordered: "bg-surface text-text border border-border",
  ghost: "bg-transparent text-text border-0",
  onPhoto: "bg-white/90 text-text border-0",
  muted: "bg-surface-muted text-text-secondary border-0",
  primary: "bg-primary text-on-primary border-0",
  ocean: "bg-primary text-on-primary border-0",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "bordered", size = 44, round = false, elevated = false, className, type = "button", children, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-grid place-items-center shrink-0 pressable-round disabled:opacity-45 disabled:pointer-events-none",
        round ? "rounded-full" : size <= 36 ? "rounded-sm" : "rounded-md",
        elevated && "shadow-sm",
        iconVariant[variant],
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});
