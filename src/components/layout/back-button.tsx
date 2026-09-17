"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon } from "@/components/ui/icons";

/** 44 px back control for page overlays: goes back in history when there is one, otherwise to the fallback route. */
export function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className="grid size-11 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text hover:bg-surface-muted"
    >
      <ChevronLeftIcon size={22} strokeWidth={2.2} />
    </button>
  );
}
