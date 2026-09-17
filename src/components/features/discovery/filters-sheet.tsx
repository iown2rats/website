"use client";

import { useId, useState } from "react";
import { INTENT_LABELS } from "@/constants/labels";
import { DISCOVERY } from "@/config/product";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/choice";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { LockIcon } from "@/components/ui/icons";
import { PlusTag } from "@/components/ui/badge";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";

/*
 * Prototype "FILTERS SHEET": 22/800 title with a "Reset" text button; Age range with two sliders and "22–34";
 * "Show me" three 44 px segments (radius 14); Location chips 40 px; "Looking for" chips (Any + 4 intents);
 * bordered "PREMIUM Advanced filters" group with 52 px lock rows; "Apply" 52 px primary. Sheet on phones, modal on desktop.
 * Advanced filters offered: Height and Education — the two the profile actually stores. Occupation and Interests
 * appear in the prototype's list but have no filterable data model yet, so they are not shown as filters.
 */
export interface LocationOption {
  id: string;
  name: string;
  kind: "CITY" | "ISLAND" | "ATOLL";
}

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  filters: DiscoveryFiltersDto;
  locations: LocationOption[];
  saving: boolean;
  error: string | null;
  onApply: (next: FiltersDraft) => void;
  onLockedAdvanced: () => void;
}

export type FiltersDraft = Omit<DiscoveryFiltersDto, "advancedEnabled" | "hasOwnLocation">;

const INTENTS = Object.entries(INTENT_LABELS) as [keyof typeof INTENT_LABELS, string][];
const HEIGHTS = Array.from({ length: (210 - 140) / 5 + 1 }, (_, i) => 140 + i * 5);

function toDraft(f: DiscoveryFiltersDto): FiltersDraft {
  return { interestedIn: f.interestedIn, ageMin: f.ageMin, ageMax: f.ageMax, locationScope: f.locationScope, locationId: f.locationId, intent: f.intent, heightMinCm: f.heightMinCm, heightMaxCm: f.heightMaxCm, education: f.education };
}

export function FiltersSheet({ open, onClose, filters, locations, saving, error, onApply, onLockedAdvanced }: FiltersSheetProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<FiltersDraft>(() => toDraft(filters));
  const [showPicker, setShowPicker] = useState(filters.locationScope === "SPECIFIC");
  const [wasOpen, setWasOpen] = useState(open);

  // Opening discards unsaved edits and starts from the persisted preferences (state adjusted on the prop change).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(toDraft(filters));
      setShowPicker(filters.locationScope === "SPECIFIC");
    }
  }

  const set = <K extends keyof FiltersDraft>(key: K, value: FiltersDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const reset = () => {
    setDraft({ interestedIn: draft.interestedIn, ageMin: 22, ageMax: 34, locationScope: "ANYWHERE", locationId: null, intent: null, heightMinCm: null, heightMaxCm: null, education: null });
    setShowPicker(false);
  };
  const segment = (on: boolean) => cn("h-11 flex-1 rounded-md border-[1.5px] text-body-sm font-semibold text-text", on ? "border-primary bg-aqua-soft" : "border-border bg-surface");
  const specificName = locations.find((l) => l.id === draft.locationId)?.name;

  return (
    <ResponsiveDialog open={open} onClose={onClose} labelledBy={titleId} className="desktop:max-w-[560px]">
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-[22px] font-extrabold tracking-[-.02em]">Filters</h2>
        <button type="button" onClick={reset} className="h-10 border-0 bg-transparent text-body-sm font-bold text-primary-pressed">Reset</button>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex justify-between text-body font-semibold">
          <span>Age range</span>
          <span className="text-text-secondary tabular-nums">{draft.ageMin}–{draft.ageMax}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input type="range" min={DISCOVERY.filterAgeMin} max={DISCOVERY.filterAgeMax} value={draft.ageMin} onChange={(e) => set("ageMin", Math.min(Number(e.target.value), draft.ageMax))} aria-label="Minimum age" className="w-full accent-primary" />
          <input type="range" min={DISCOVERY.filterAgeMin} max={DISCOVERY.filterAgeMax} value={draft.ageMax} onChange={(e) => set("ageMax", Math.max(Number(e.target.value), draft.ageMin))} aria-label="Maximum age" className="w-full accent-primary" />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="text-body font-semibold">Show me</div>
        <div className="flex gap-2" role="radiogroup" aria-label="Show me">
          {([["WOMEN", "Women"], ["MEN", "Men"], ["EVERYONE", "Everyone"]] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={draft.interestedIn === v} onClick={() => set("interestedIn", v)} className={segment(draft.interestedIn === v)}>{label}</button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="text-body font-semibold">Location</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Location">
          <Chip role="radio" aria-checked={draft.locationScope === "ANYWHERE"} selected={draft.locationScope === "ANYWHERE"} onClick={() => { set("locationScope", "ANYWHERE"); setShowPicker(false); }}>Anywhere in Maldives</Chip>
          <Chip role="radio" aria-checked={draft.locationScope === "GREATER_MALE"} selected={draft.locationScope === "GREATER_MALE"} onClick={() => { set("locationScope", "GREATER_MALE"); setShowPicker(false); }}>Greater Malé</Chip>
          <Chip role="radio" aria-checked={draft.locationScope === "MY_ATOLL"} selected={draft.locationScope === "MY_ATOLL"} disabled={!filters.hasOwnLocation} onClick={() => { set("locationScope", "MY_ATOLL"); setShowPicker(false); }}>My atoll</Chip>
          <Chip role="radio" aria-checked={draft.locationScope === "SPECIFIC"} selected={draft.locationScope === "SPECIFIC"} onClick={() => { set("locationScope", "SPECIFIC"); setShowPicker(true); }}>
            {draft.locationScope === "SPECIFIC" && specificName ? specificName : "Choose island or atoll"}
          </Chip>
        </div>
        {showPicker ? (
          <Select aria-label="Island or atoll" placeholder="Choose island or atoll" value={draft.locationId ?? ""} onChange={(e) => set("locationId", e.target.value || null)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        ) : null}
        <p className="text-caption text-text-secondary">Island or atoll only — Thundi never uses distance or GPS.</p>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="text-body font-semibold">Looking for</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Looking for">
          <Chip role="radio" aria-checked={draft.intent === null} selected={draft.intent === null} onClick={() => set("intent", null)}>Any</Chip>
          {INTENTS.map(([v, label]) => (
            <Chip key={v} role="radio" aria-checked={draft.intent === v} selected={draft.intent === v} onClick={() => set("intent", v)}>{label}</Chip>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border">
        <div className="flex items-center gap-2 bg-surface-muted px-4.5 py-3.5 text-tag font-bold uppercase tracking-[.08em] text-ocean">
          <PlusTag size="sm" label="Premium" />
          Advanced filters
        </div>
        {filters.advancedEnabled ? (
          <div className="flex flex-col gap-3 border-t border-border bg-surface p-4">
            <div className="grid grid-cols-2 gap-2.5">
              <Select aria-label="Minimum height" placeholder="Min height" value={draft.heightMinCm ?? ""} onChange={(e) => set("heightMinCm", e.target.value ? Number(e.target.value) : null)}>
                {HEIGHTS.map((h) => <option key={h} value={h}>{h} cm</option>)}
              </Select>
              <Select aria-label="Maximum height" placeholder="Max height" value={draft.heightMaxCm ?? ""} onChange={(e) => set("heightMaxCm", e.target.value ? Number(e.target.value) : null)}>
                {HEIGHTS.map((h) => <option key={h} value={h}>{h} cm</option>)}
              </Select>
            </div>
            <Input aria-label="Education" placeholder="Education (e.g. MNU, Villa College)" value={draft.education ?? ""} maxLength={60} onChange={(e) => set("education", e.target.value || null)} />
          </div>
        ) : (
          <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-border">
            {["Height", "Education"].map((label) => (
              <button key={label} type="button" onClick={onLockedAdvanced} className="flex h-13 w-full items-center justify-between border-0 bg-surface px-4.5 text-body font-semibold text-text">
                <span>{label}</span>
                <LockIcon size={16} className="text-text-secondary" />
              </button>
            ))}
          </div>
        )}
      </section>

      {error ? <p role="alert" className="text-body-sm font-semibold text-danger">{error}</p> : null}
      <Button onClick={() => onApply(draft)} loading={saving} fullWidth disabled={draft.locationScope === "SPECIFIC" && !draft.locationId}>Apply</Button>
    </ResponsiveDialog>
  );
}
