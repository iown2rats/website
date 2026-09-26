"use client";

import { useId, useState } from "react";
import { CONNECTION_INTENT_LABELS, INTENT_LABELS } from "@/constants/labels";
import { DISCOVERY } from "@/config/product";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/choice";
import { ConfirmationDialog, ResponsiveDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { LockIcon } from "@/components/ui/icons";
import { PlusTag } from "@/components/ui/badge";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";
import { AGE_RANGE_TOO_NARROW, ageRangeTooNarrow, ageRangeWarning, moveAgeFrom, moveAgeTo, needsOwnAgeConfirmation, resetFilterValues } from "@/lib/discovery-filters";
import { DATING_NEEDS_GENDER, type ConnectionIntent } from "@/server/preferences/intent-policy";

/*
 * Prototype "FILTERS SHEET": 22/800 title with a "Reset" text button; Age range with two labelled sliders (From / To,
 * never closer than `filterAgeMinSpan` years, and a "Save it anyway?" check when the new range leaves out the
 * member's own age); "I'm here for" Dating / Friendship 44 px segments (radius 14); Location chips 40 px; bordered
 * "PREMIUM Advanced filters" group with 52 px lock rows; "Apply" 52 px primary. Sheet on phones, modal on desktop.
 * Advanced filters offered: Height and Education — the two the profile actually stores.
 *
 * There is no "Show me" and no "Looking for" (2026-09-26). Who a member sees follows from their gender and pool —
 * Dating is opposite gender, Friendship everyone in the pool — and relationship intention is shown on profiles but never
 * filters anybody out (src/server/discovery/predicate.ts). Switching pool is the whole of the change: Apply, and the
 * deck is that pool.
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

type RelationshipIntent = keyof typeof INTENT_LABELS;

/** Exactly what the sheet submits. */
export interface FiltersDraft {
  connectionIntent: ConnectionIntent;
  ageMin: number;
  ageMax: number;
  locationScope: DiscoveryFiltersDto["locationScope"];
  locationId: string | null;
  /** The member's OWN Dating answer, offered (optional) only when switching into Dating without one. */
  myIntent: RelationshipIntent | null;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  education: string | null;
}

const INTENTS = Object.entries(INTENT_LABELS) as [RelationshipIntent, string][];
const HEIGHTS = Array.from({ length: (210 - 140) / 5 + 1 }, (_, i) => 140 + i * 5);

function toDraft(f: DiscoveryFiltersDto): FiltersDraft {
  return { connectionIntent: f.connectionIntent, ageMin: f.ageMin, ageMax: f.ageMax, locationScope: f.locationScope, locationId: f.locationId, myIntent: null, heightMinCm: f.heightMinCm, heightMaxCm: f.heightMaxCm, education: f.education };
}

export function FiltersSheet({ open, onClose, filters, locations, saving, error, onApply, onLockedAdvanced }: FiltersSheetProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<FiltersDraft>(() => toDraft(filters));
  const [showPicker, setShowPicker] = useState(filters.locationScope === "SPECIFIC");
  const [wasOpen, setWasOpen] = useState(open);
  const [confirmingAge, setConfirmingAge] = useState(false);

  // Opening discards unsaved edits and starts from the persisted preferences (state adjusted on the prop change).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(toDraft(filters));
      setShowPicker(filters.locationScope === "SPECIFIC");
      setConfirmingAge(false);
    }
  }

  const set = <K extends keyof FiltersDraft>(key: K, value: FiltersDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dating = draft.connectionIntent === "DATING";
  const reset = () => {
    // The pool is not a filter, so Reset leaves it; everything else returns to THE defaults.
    setDraft((d) => ({ ...d, ...resetFilterValues() }));
    setShowPicker(false);
  };
  const chooseMode = (v: ConnectionIntent) => {
    if (v === "DATING" && !filters.canDate) return;
    set("connectionIntent", v);
  };
  const segment = (on: boolean) => cn("h-11 flex-1 rounded-md text-body-sm font-medium text-text disabled:opacity-45", on ? "bg-primary text-on-primary" : "bg-surface-muted");
  const specificName = locations.find((l) => l.id === draft.locationId)?.name;
  const offerMyIntent = dating && filters.canDate && !filters.hasDatingIntent;
  const warning = ageRangeWarning(filters.ownAge, draft.ageMin, draft.ageMax);
  const blockedReason =
    ageRangeTooNarrow(draft.ageMin, draft.ageMax) ? AGE_RANGE_TOO_NARROW
    : draft.locationScope === "SPECIFIC" && !draft.locationId ? "Choose an island or atoll."
    : null;
  // A range that leaves out the member's own age is asked about once, when they change it; it is never corrected.
  const apply = () => (needsOwnAgeConfirmation(filters.ownAge, filters, draft) ? setConfirmingAge(true) : onApply(draft));

  return (
    <>
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="desktop:max-w-[560px]"
      footer={
        <div className="flex flex-col gap-2.5">
          {error ? <p role="alert" className="text-body-sm font-medium text-danger">{error}</p> : null}
          {/* A disabled Apply always says why, right beside it: the question may be scrolled out of view. */}
          {blockedReason ? <p className="text-caption text-text-secondary">{blockedReason}</p> : null}
          <Button onClick={apply} loading={saving} fullWidth disabled={blockedReason != null}>Apply</Button>
        </div>
      }
    >
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-h3">Filters</h2>
        <button type="button" onClick={reset} className="h-10 border-0 bg-transparent text-body-sm font-medium text-primary-ink">Reset</button>
      </div>

      {/*
        * Age and "I'm here for" are both short controls, so from the desktop breakpoint they sit side by side instead
        * of each taking a full row of a 560 px panel. The wrapper is a plain column below that, which keeps the phone
        * sheet exactly as it was — and keeps it a direct child of the scrolling body, which must not shrink.
        */}
      <div className="flex flex-col gap-4 desktop:grid desktop:grid-cols-2 desktop:gap-3.5">
        <section className="flex flex-col gap-3">
          <div className="text-body font-medium">Age range</div>
          {/*
            * Half-width on desktop, so the two sliders stack rather than becoming 120 px each. Each slider carries its
            * own visible label and value: side by side on a phone, two unlabelled sliders read as one control, and
            * members dragged the left one to the end and saved 60–60.
            */}
          <div className="grid grid-cols-2 gap-3 desktop:grid-cols-1 desktop:gap-4">
            <AgeSlider label="From" value={draft.ageMin} onChange={(n) => set("ageMin", moveAgeFrom(n, draft.ageMax))} />
            <AgeSlider label="To" value={draft.ageMax} onChange={(n) => set("ageMax", moveAgeTo(n, draft.ageMin))} />
          </div>
          {warning ? <p role="status" className="text-caption font-medium leading-relaxed text-warning">{warning}</p> : null}
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="text-body font-medium">I&apos;m here for</div>
          <div className="flex gap-2" role="radiogroup" aria-label="I'm here for">
            {(Object.entries(CONNECTION_INTENT_LABELS) as [ConnectionIntent, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.connectionIntent === v}
                disabled={v === "DATING" && !filters.canDate}
                onClick={() => chooseMode(v)}
                className={segment(draft.connectionIntent === v)}
              >{label}</button>
            ))}
          </div>
          {/* Who you'll see follows from the choice itself; there is no second question. */}
          <p className="text-caption leading-relaxed text-text-secondary" data-testid="pool-explainer">
            {!filters.canDate ? DATING_NEEDS_GENDER : dating ? "Dating shows you women if you're a man, and men if you're a woman." : "Friendship shows you everyone here for friendship."}
          </p>
        </section>
      </div>

      {offerMyIntent ? (
        /* Their OWN answer, not a filter: somebody who came in through Friendship was never asked it. Optional — it
           shows on their profile, and not answering never hides anybody. */
        <section className="flex flex-col gap-2.5">
          <div className="text-body font-medium">What are you looking for? <span className="font-normal text-text-secondary">(optional)</span></div>
          <p className="-mt-1 text-caption text-text-secondary">Shown on your profile. You can change it later in Edit profile.</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What are you looking for?">
            {INTENTS.map(([v, label]) => (
              <Chip key={v} role="radio" aria-checked={draft.myIntent === v} selected={draft.myIntent === v} onClick={() => set("myIntent", v)}>{label}</Chip>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <div className="text-body font-medium">Location</div>
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
        <p className="text-caption text-text-secondary">Island or atoll only — Mellocrush never uses distance or GPS.</p>
      </section>

      <section className="overflow-hidden rounded-2xl glass-card">
        <div className="flex items-center gap-2 bg-surface-muted px-3.5 py-3.5 text-tag uppercase tracking-[.08em] text-ocean">
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
              <button key={label} type="button" onClick={onLockedAdvanced} className="flex h-11.5 w-full items-center justify-between border-0 bg-surface px-3.5 text-body font-medium text-text">
                <span>{label}</span>
                <LockIcon size={16} className="text-text-secondary" />
              </button>
            ))}
          </div>
        )}
      </section>

    </ResponsiveDialog>
    <ConfirmationDialog
      open={confirmingAge}
      onClose={() => setConfirmingAge(false)}
      onConfirm={() => {
        setConfirmingAge(false);
        onApply(draft);
      }}
      title="Your age isn't included in this range"
      description={`You're ${filters.ownAge} and you've chosen ${draft.ageMin}–${draft.ageMax}. Save it anyway?`}
      confirmLabel="Save anyway"
      cancelLabel="Change range"
    />
    </>
  );
}

/** One labelled age slider on the full 18–60 scale. The caller clamps, so the thumb stops where the rule says. */
function AgeSlider({ label, value, onChange }: { label: "From" | "To"; value: number; onChange: (next: number) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-caption font-medium text-text-secondary">
          {label}
          <span className="sr-only"> age</span>
        </label>
        <span aria-hidden="true" className="text-body font-medium tabular-nums text-text">{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={DISCOVERY.filterAgeMin}
        max={DISCOVERY.filterAgeMax}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
