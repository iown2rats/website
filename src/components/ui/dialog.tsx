"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button, type ButtonVariant } from "./button";

/*
 * One dialog system built on the native <dialog> element (top layer, focus trap, Escape, inert background).
 *  - BottomSheet: prototype sheets — bottom-anchored, max-width 560, max-height 88 %, radius 26 top corners,
 *    padding 10px 16px calc(16px + safe-bottom), 40 × 4 drag handle, sheet-in 450 ms, scrim rgba(6,59,76,.4) + blur 4.
 *  - Modal: centred card (radius 26, max-width 420) with fade-in — used on desktop where a sheet would float oddly.
 *  - ResponsiveDialog: sheet below the desktop breakpoint, modal above.
 *  - ConfirmationDialog: title, body, confirm/cancel in the prototype's button language.
 */

export interface DialogBaseProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Either a visible title id is used or this label. */
  label?: string;
  labelledBy?: string;
  children: ReactNode;
  className?: string;
  /** Prevent closing via backdrop / Escape (e.g. blocking actions). */
  dismissible?: boolean;
}

function useNativeDialog(open: boolean, onClose: () => void, dismissible: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      previouslyFocused.current = document.activeElement;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  const onCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, onClose],
  );

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (!dismissible) return;
      if (e.target === e.currentTarget) onClose();
    },
    [dismissible, onClose],
  );

  return { ref, onCancel, onBackdropClick };
}

export function BottomSheet({ open, onClose, label, labelledBy, children, className, dismissible = true }: DialogBaseProps) {
  const { ref, onCancel, onBackdropClick } = useNativeDialog(open, onClose, dismissible);
  return (
    <dialog
      ref={ref}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onCancel={onCancel}
      onClick={onBackdropClick}
      className={cn(
        "m-0 mt-auto mx-auto w-full max-w-[var(--sheet-max)] max-h-[88dvh] glass-card text-text border-0 p-0",
        "rounded-t-card rounded-b-none open:animate-sheet-in overflow-visible",
        className,
      )}
    >
      <div className="flex flex-col gap-4 px-4 pt-2.5 max-h-[88dvh] overflow-auto" style={{ paddingBottom: "calc(16px + var(--safe-bottom))" }}>
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-[2px] bg-border shrink-0" />
        {children}
      </div>
    </dialog>
  );
}

export function Modal({ open, onClose, label, labelledBy, children, className, dismissible = true }: DialogBaseProps) {
  const { ref, onCancel, onBackdropClick } = useNativeDialog(open, onClose, dismissible);
  return (
    <dialog
      ref={ref}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onCancel={onCancel}
      onClick={onBackdropClick}
      className={cn("m-auto w-[calc(100%-32px)] max-w-105 glass-card text-text border-0 p-0 rounded-card open:animate-fade-in", className)}
    >
      <div className="flex flex-col gap-4 p-5 max-h-[85dvh] overflow-auto">{children}</div>
    </dialog>
  );
}

const desktopQuery = "(min-width: 900px)";
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(desktopQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => false);
}

/** Sheet on phones, modal on desktop. */
export function ResponsiveDialog(props: DialogBaseProps) {
  const desktop = useIsDesktop();
  return desktop ? <Modal {...props} /> : <BottomSheet {...props} />;
}

export function DialogTitle({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn("text-h3 text-text", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-body-sm text-text-secondary -mt-2", className)}>{children}</p>;
}

export interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "ocean",
  loading = false,
}: ConfirmationDialogProps) {
  const titleId = useId();
  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId} dismissible={!loading}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
      <div className="flex flex-col gap-2.5 pt-1">
        <Button variant={confirmVariant} onClick={onConfirm} loading={loading} fullWidth>
          {confirmLabel}
        </Button>
        <Button variant="muted" size="md" onClick={onClose} disabled={loading} fullWidth>
          {cancelLabel}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

/** Action list sheet (Report / Block / Unmatch + Cancel) in the prototype's 56 px row style. */
export interface ActionSheetItem {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}

export function ActionSheet({ open, onClose, label, items, cancelLabel = "Cancel" }: { open: boolean; onClose: () => void; label: string; items: ActionSheetItem[]; cancelLabel?: string }) {
  return (
    <BottomSheet open={open} onClose={onClose} label={label}>
      <div className="flex flex-col rounded-2xl bg-surface-muted overflow-hidden [&>*+*]:border-t [&>*+*]:border-border">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onSelect}
            className={cn("h-14 px-4.5 text-left text-body-lg font-semibold bg-transparent border-0 hover:bg-surface-muted", item.tone === "danger" ? "text-danger" : "text-text")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Button variant="muted" onClick={onClose} fullWidth className="rounded-xl">
        {cancelLabel}
      </Button>
    </BottomSheet>
  );
}
