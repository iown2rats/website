"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Toast — prototype: ocean pill, 44 px, radius 22, white 14 px/600, shadow-lg, pop-in 300 ms,
 * centred at bottom: 90px + safe-bottom, auto-dismiss 1.8 s, role=status. One toast at a time.
 */
export interface ToastOptions {
  durationMs?: number;
  tone?: "ocean" | "success" | "danger";
}

interface ToastState {
  id: number;
  message: string;
  tone: NonNullable<ToastOptions["tone"]>;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, tone: options.tone ?? "ocean" });
      timer.current = setTimeout(() => setToast(null), options.durationMs ?? 1800);
    },
    [],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
        style={{ bottom: "calc(90px + var(--safe-bottom))" }}
      >
        {toast ? (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto min-h-11 max-w-full rounded-[22px] px-5 py-2.5 text-center text-body-sm font-semibold flex items-center shadow-lg animate-pop-in",
              toast.tone === "ocean" && "bg-ocean text-on-ocean",
              toast.tone === "success" && "bg-primary text-on-primary",
              toast.tone === "danger" && "bg-danger text-white",
            )}
          >
            {toast.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
