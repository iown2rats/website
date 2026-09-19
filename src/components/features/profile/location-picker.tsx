"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";
import { SearchIcon } from "@/components/ui/icons";

/*
 * Island / atoll picker (prototype onboarding step 8 search + list, reused as a sheet for Edit profile → Info):
 * 56 px search field, bordered list of the first matches, "Selected" marker. No GPS, no coordinates — the user
 * picks from the seeded Maldives locations only.
 */
export interface LocationOption {
  id: string;
  name: string;
  kind: "CITY" | "ISLAND" | "ATOLL";
  atollName: string;
}

export interface LocationPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  locations: LocationOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Offer a "None" row (optional fields such as home island). */
  allowNone?: boolean;
}

export function LocationPicker({ open, onClose, title, locations, selectedId, onSelect, allowNone = false }: LocationPickerProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? locations.filter((l) => l.name.toLowerCase().includes(q) || l.atollName.toLowerCase().includes(q)) : locations;
    const chosen = locations.find((l) => l.id === selectedId);
    const top = list.slice(0, 8);
    return chosen && !q && !top.some((l) => l.id === chosen.id) ? [chosen, ...top.slice(0, 7)] : top;
  }, [locations, query, selectedId]);

  const choose = (id: string | null) => {
    onSelect(id);
    setQuery("");
    onClose();
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <div className="flex h-11 items-center gap-2.5 rounded-lg bg-surface-muted px-3.5 focus-within:outline-2 focus-within:outline-primary">
        <SearchIcon size={20} className="shrink-0 text-text-secondary" />
        <label htmlFor={`${titleId}-q`} className="sr-only">Search island or atoll</label>
        <input id={`${titleId}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search island or atoll" autoComplete="off" className="min-w-0 flex-1 border-0 bg-transparent text-field text-text outline-none placeholder:text-text-muted" />
      </div>
      <div role="listbox" aria-label={title} className="flex shrink-0 flex-col overflow-hidden rounded-2xl glass-card [&>*+*]:border-t [&>*+*]:border-border">
        {allowNone ? (
          <button type="button" role="option" aria-selected={selectedId === null} onClick={() => choose(null)} className="flex h-12 items-center justify-between border-0 bg-transparent px-3.5 text-left text-body font-medium text-text-secondary hover:bg-surface-muted">
            <span>None</span>
            {selectedId === null ? <span className="text-caption font-medium text-primary-ink">Selected</span> : null}
          </button>
        ) : null}
        {results.map((l) => {
          const isSelected = l.id === selectedId;
          return (
            <button key={l.id} type="button" role="option" aria-selected={isSelected} onClick={() => choose(l.id)} className={cn("flex h-12 items-center justify-between border-0 bg-transparent px-3.5 text-left text-body font-medium text-text hover:bg-surface-muted")}>
              <span>
                {l.name}
                {l.kind !== "ATOLL" && l.atollName !== l.name ? <span className="ml-1.5 text-caption font-medium text-text-secondary">{l.atollName}</span> : null}
              </span>
              {isSelected ? <span className="text-caption font-medium text-primary-ink">Selected</span> : null}
            </button>
          );
        })}
        {results.length === 0 ? <p className="px-3.5 py-3 text-body-sm text-text-secondary">No island or atoll matches that.</p> : null}
      </div>
      <p className="text-caption text-text-secondary">Only your island or atoll is ever shown — never a distance.</p>
    </ResponsiveDialog>
  );
}
