"use client";

import { useCallback, useSyncExternalStore } from "react";
import { IconButton } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

/*
 * Appearance is a per-viewer convenience stored in localStorage and applied as data-theme on <html>
 * (see the inline script in app/layout.tsx). Light is the default; dark applies only when chosen here, never from
 * the system setting, so the rose palette is what every new visitor sees.
 */
type Theme = "light" | "dark";
const KEY = "thundi.theme";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#000000" : "#FFFBF1");
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
