"use client";

import { useId, useState } from "react";
import { CONNECTION_INTENT_LABELS, INTENT_LABELS, INTERESTED_IN_LABELS } from "@/constants/labels";
import { DISCOVERY } from "@/config/product";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/choice";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { LockIcon } from "@/components/ui/icons";
import { PlusTag } from "@/components/ui/badge";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";
import { ageRangeWarning, rememberedFriendship, resetFilterValues, showMeForMode } from "@/lib/discovery-filters";
import { DATING_NEEDS_GENDER, type ConnectionIntent } from "@/server/preferences/intent-policy";

/*
 * Prototype "FILTERS SHEET": 22/800 title with a "Reset" text button; Age range with two sliders; "Show me" three
 * 44 px segments (radius 14); Location chips 40 px; "Looking for" chips (Any + 4 intents); bordered "PREMIUM Advanced
 * filters" group with 52 px lock rows; "Apply" 52 px primary. Sheet on phones, modal on desktop.
 * Advanced filters offered: Height and Education — the two the profile actually stores. Occupation and Interests
 * appear in the prototype's list but have no filterable data model yet, so they are not shown as filters.
 *
 * Dating and Friendship are different products and the sheet shows each its own questions
 * (src/server/preferences/intent-policy.ts): "Looking for" is a Dating question and is not drawn at all on
 * Friendship, and each mode's "Show me" is restored from its own remembered value when the member switches — the
 * Dating one derived from gender, the Friendship one the member's own `friendshipInterestedIn`. None of this is the
 * enforcement; the server ignores hidden values whatever the sheet sends.
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

type InterestedIn = DiscoveryFiltersDto["interestedIn"];
type RelationshipIntent = NonNullable<DiscoveryFiltersDto["intent"]>;

/** Exactly what the sheet submits. Hidden fields ride along unchanged and the server decides what applies. */
export interface FiltersDraft {
  connectionIntent: ConnectionIntent;
  /** Null only on Friendship before the member has ever answered; Apply waits for an answer then. */
  interestedIn: InterestedIn | null;
  ageMin: number;
  ageMax: number;
  locationScope: DiscoveryFiltersDto["locationScope"];
  locationId: string | null;
  /** The Dating "Looking for" filter. Kept (not cleared) while on Friendship so a switch back restores it. */
  intent: RelationshipIntent | null;
  /** The member's OWN Dating answer, asked only when switching into Dating without one. */
  myIntent: RelationshipIntent | null;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  education: string | null;
}

const INTENTS = Object.entries(INTENT_LABELS) as [RelationshipIntent, string][];
const HEIGHTS = Array.from({ length: (210 - 140) / 5 + 1 }, (_, i) => 140 + i * 5);

function toDraft(f: DiscoveryFiltersDto): FiltersDraft {
  return { connectionIntent: f.connectionIntent, interestedIn: f.interestedIn, ageMin: f.ageMin, ageMax: f.ageMax, locationScope: f.locationScope, locationId: f.locationId, intent: f.intent, myIntent: null, heightMinCm: f.heightMinCm, heightMaxCm: f.heightMaxCm, education: f.education };
}

export function FiltersSheet({ open, onClose, filters, locations, saving, error, onApply, onLockedAdvanced }: FiltersSheetProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<FiltersDraft>(() => toDraft(filters));
  const [friendshipShowMe, setFriendshipShowMe] = useState<InterestedIn | null>(() => rememberedFriendship(filters));
  const [showPicker, setShowPicker] = useState(filters.locationScope === "SPECIFIC");
  const [wasOpen, setWasOpen] = useState(open);

  // Opening discards unsaved edits and starts from the persisted preferences (state adjusted on the prop change).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(toDraft(filters));
      setFriendshipShowMe(rememberedFriendship(filters));
      setShowPicker(filters.locationScope === "SPECIFIC");
    }
  }

  const set = <K extends keyof FiltersDraft>(key: K, value: FiltersDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dating = draft.connectionIntent === "DATING";
  const reset = () => {
    // The mode and its "Show me" are not filters, so Reset leaves them; everything else returns to THE defaults.
    setDraft((d) => ({ ...d, ...resetFilterValues(d.connectionIntent, d.intent) }));
    setShowPicker(false);
  };
  const chooseMode = (v: ConnectionIntent) => {
    if (v === "DATING" && !filters.canDate) return;
    setDraft((d) => ({
      ...d,
      connectionIntent: v,
      // Each mode restores its own "Show me": Dating's is derived from gender, Friendship's is the member's answer.
      interestedIn: showMeForMode(v, filters.datingInterestedIn, friendshipShowMe),
    }));
  };
  const chooseFriendshipShowMe = (v: InterestedIn) => {
    setFriendshipShowMe(v);
    set("interestedIn", v);
  };
  const segment = (on: boolean) => cn("h-11 flex-1 rounded-md text-body-sm font-medium text-text disabled:opacity-45", on ? "bg-primary text-on-primary" : "bg-surface-muted");
  const specificName = locations.find((l) => l.id === draft.locationId)?.name;
  const needsMyIntent = dating && !filters.hasDatingIntent;
  const warning = ageRangeWarning(filters.ownAge, draft.ageMin, draft.ageMax);
  const blockedReason =
    needsMyIntent && !draft.myIntent ? "Answer “What are you looking for?” to switch to Dating."
    : draft.interestedIn == null ? "Choose who you'd like to meet."
    : draft.locationScope === "SPECIFIC" && !draft.locationId ? "Choose an island or atoll."
    : null;

  return (
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
          <Button onClick={() => onApply(draft)} loading={saving} fullWidth disabled={blockedReason != null}>Apply</Button>
        </div>
      }
    >
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-h3">Filters</h2>
        <button type="button" onClick={reset} className="h-10 border-0 bg-transparent text-body-sm font-medium text-primary-ink">Reset</button>
      </div>

      {/*
        * Age and "Show me" are both short controls, so from the desktop breakpoint they sit side by side instead of
        * each taking a full row of a 560 px panel. The wrapper is a plain column below that, which keeps the phone
        * sheet exactly as it was — and keeps it a direct child of the scrolling body, which must not shrink.
        */}
      <div className="flex flex-col gap-4 desktop:grid desktop:grid-cols-2 desktop:gap-3.5">
        <section className="flex flex-col gap-3">
          <div className="flex justify-between text-body font-medium">
            <span>Age range</span>
            <span className="text-text-secondary tabular-nums">{draft.ageMin}–{draft.ageMax}</span>
          </div>
          {/* Half-width on desktop, so the two sliders stack rather than becoming 120 px each. */}
          <div className="grid grid-cols-2 gap-3 desktop:grid-cols-1 desktop:gap-4">
            <input type="range" min={DISCOVERY.filterAgeMin} max={DISCOVERY.filterAgeMax} value={draft.ageMin} onChange={(e) => set("ageMin", Math.min(Number(e.target.value), draft.ageMax))} aria-label="Minimum age" className="w-full accent-primary" />
            <input type="range" min={DISCOVERY.filterAgeMin} max={DISCOVERY.filterAgeMax} value={draft.ageMax} onChange={(e) => set("ageMax", Math.max(Number(e.target.value), draft.ageMin))} aria-label="Maximum age" className="w-full accent-primary" />
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
          {!filters.canDate ? <p className="text-caption leading-relaxed text-text-secondary">{DATING_NEEDS_GENDER}</p> : null}
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="text-body font-medium">Show me</div>
          {!dating ? (
            <div className="flex gap-2" role="radiogroup" aria-label="Show me">
              {([["WOMEN", "Women"], ["MEN", "Men"], ["EVERYONE", "Everyone"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={draft.interestedIn === v} onClick={() => chooseFriendshipShowMe(v)} className={segment(draft.interestedIn === v)}>{label}</button>
              ))}
            </div>
          ) : (
            /* Dating has one answer, so this states it instead of offering a choice that cannot be made. */
            <p className="text-body-sm text-text-secondary">{draft.interestedIn ? INTERESTED_IN_LABELS[draft.interestedIn] : "—"} — Dating on Mellocrush is opposite gender only.</p>
          )}
        </section>
      </div>

      {needsMyIntent ? (
        /* Their OWN answer, not a filter: somebody who came in through Friendship was never asked it, and Dating needs it.
           Drawn right under the switch that caused it, so it is on screen the moment they tap Dating. */
        <section className="flex flex-col gap-2.5">
          <div className="text-body font-medium">What are you looking for?</div>
          <p className="-mt-1 text-caption text-text-secondary">Dating needs your answer to this. It shows on your profile, and you can change it later in Edit profile.</p>
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

      {/* A Dating question. Not drawn on Friendship at all — the stored answer waits, inert, for a switch back. */}
      {dating ? (
        <section className="flex flex-col gap-2.5">
          <div className="text-body font-medium">Looking for</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Looking for">
            <Chip role="radio" aria-checked={draft.intent === null} selected={draft.intent === null} onClick={() => set("intent", null)}>Any</Chip>
            {INTENTS.map(([v, label]) => (
              <Chip key={v} role="radio" aria-checked={draft.intent === v} selected={draft.intent === v} onClick={() => set("intent", v)}>{label}</Chip>
            ))}
          </div>
        </section>
      ) : null}

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
  );
}
