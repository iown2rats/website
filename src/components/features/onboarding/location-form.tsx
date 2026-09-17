"use client";

import { useActionState, useMemo, useState } from "react";
import { submitLocation, type StageFormState } from "@/actions/onboarding";
import { SearchIcon } from "@/components/ui/icons";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 8: search field (56 px, radius 18) and a bordered list (radius 20) of the first six matches,
 * "Selected" in primary-pressed on the chosen row, note "Only your island or atoll is ever shown — never a distance."
 * No GPS, no browser geolocation: the user picks from the seeded Maldives locations.
 */
export interface LocationOption {
  id: string;
  name: string;
  kind: "CITY" | "ISLAND" | "ATOLL";
  atollName: string;
}

export function LocationForm({ locations, initialId }: { locations: LocationOption[]; initialId: string | null }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitLocation, {});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? locations.filter((l) => l.name.toLowerCase().includes(q) || l.atollName.toLowerCase().includes(q)) : locations;
    const chosen = locations.find((l) => l.id === selected);
    const top = list.slice(0, 6);
    return chosen && !top.some((l) => l.id === chosen.id) && !q ? [chosen, ...top.slice(0, 5)] : top;
  }, [locations, query, selected]);

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input type="hidden" name="locationId" value={selected ?? ""} />
      <div className="flex h-14 items-center gap-2.5 rounded-xl border border-border bg-surface px-4 focus-within:border-primary">
        <SearchIcon size={20} className="shrink-0 text-text-secondary" />
        <label htmlFor="location-search" className="sr-only">Search island or atoll</label>
        <input
          id="location-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search island or atoll"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent text-body-lg text-text outline-none placeholder:text-text-muted"
        />
      </div>
      <div role="listbox" aria-label="Locations" className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface [&>*+*]:border-t [&>*+*]:border-border">
        {results.map((l) => {
          const isSelected = l.id === selected;
          return (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => setSelected(l.id)}
              className="flex h-13.5 items-center justify-between border-0 bg-transparent px-4.5 text-left text-body font-semibold text-text hover:bg-surface-muted"
            >
              <span>
                {l.name}
                {l.kind !== "ATOLL" ? <span className="ml-2 text-caption font-medium text-text-secondary">{l.atollName}</span> : null}
              </span>
              {isSelected ? <span className="text-caption font-semibold text-primary-pressed">Selected</span> : null}
            </button>
          );
        })}
        {results.length === 0 ? <div className="px-4.5 py-4 text-body-sm text-text-secondary">No islands or atolls match that.</div> : null}
      </div>
      <p className="text-caption text-text-secondary">Only your island or atoll is ever shown — never a distance. You can hide it entirely later.</p>
      <FormError message={state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={!selected}>Continue</SubmitButton>
      </div>
    </form>
  );
}
