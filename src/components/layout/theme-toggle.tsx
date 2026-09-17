"use client";

import { useCallback, useSyncExternalStore } from "react";
import { IconButton } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

/*
 * Appearance is a per-viewer convenience stored in localStorage and applied as data-theme on <html>
 * (see the inline script in app/layout.tsx). Without a stored value the system preference applies.
 */
type Theme = "light" | "dark";
const KEY = "thundi.theme";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    observer.disconnect();
    mq.removeEventListener("change", cb);
  };
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: theme still applies for this page */
    }
  }, []);
  return [theme, toggle];
}

/** Header icon button (prototype: moon icon, 44 px bordered). */
export function ThemeToggleIcon() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark";
  return (
    <IconButton aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"} aria-pressed={dark} onClick={toggle}>
      {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </IconButton>
  );
}

/** Sidebar text button (prototype: "Dark appearance" / "Light appearance", 44 px bordered, 13 px). */
export function ThemeToggleButton({ className }: { className?: string }) {
  const [theme, toggle] = useTheme();
  return (
    <Button variant="secondary" size="sm" onClick={toggle} className={className} aria-pressed={theme === "dark"}>
      <span className="text-caption font-semibold text-text-secondary">{theme === "dark" ? "Light appearance" : "Dark appearance"}</span>
    </Button>
  );
}
