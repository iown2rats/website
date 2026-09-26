"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveFilters } from "@/actions/discovery";
import { CONNECTION_INTENT_LABELS } from "@/constants/labels";
import { FiltersSheet, type FiltersDraft, type LocationOption } from "@/components/features/discovery/filters-sheet";
import { ageRangeWarning } from "@/lib/discovery-filters";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListGroup, ListRow } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { PageOverlay } from "@/components/layout/page-overlay";
import type { DiscoveryFiltersDto } from "@/server/discovery/filters";

/*
 * Discovery preferences from Settings: a summary of the persisted Phase 6 filters and the same Filters sheet as
 * Discover, saved through the same server rules (advanced filters are stored only for Plus).
 */
const SCOPES: Record<DiscoveryFiltersDto["locationScope"], string> = { ANYWHERE: "Anywhere", GREATER_MALE: "Greater Malé", MY_ATOLL: "My atoll", SPECIFIC: "Specific island or atoll" };

export function DiscoveryClient({ initial, locations }: { initial: DiscoveryFiltersDto; locations: LocationOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (draft: FiltersDraft) => {
    setSaving(true);
    setError(null);
    const r = await saveFilters(draft).catch(() => null);
    setSaving(false);
    if (!r || !r.ok) { setError(r && !r.ok ? r.message : "Couldn't save your preferences. Try again."); return; }
    setFilters(r.filters);
    setOpen(false);
    toast.show("Preferences saved");
    router.refresh();
  };

  const ageWarning = ageRangeWarning(filters.ownAge, filters.ageMin, filters.ageMax);
  const locationName = filters.locationScope === "SPECIFIC" ? (locations.find((l) => l.id === filters.locationId)?.name ?? "Specific island") : SCOPES[filters.locationScope];
  return (
    <PageOverlay title="Discovery preferences" backHref="/settings">
      <p className="text-body-sm text-text-secondary">Who you see in Discover. These are the same preferences as the Filters button on Discover.</p>
      <ListGroup>
        <ListRow asDiv label="I’m here for" meta={CONNECTION_INTENT_LABELS[filters.connectionIntent]} />
        <ListRow asDiv label="Age range" meta={`${filters.ageMin}–${filters.ageMax}`} />
        <ListRow asDiv label="Location" meta={locationName} />
        <ListRow asDiv label={<span className="flex items-center gap-2">Height <PlusTag size="xs" /></span>} meta={filters.advancedEnabled ? (filters.heightMinCm || filters.heightMaxCm ? `${filters.heightMinCm ?? "…"}–${filters.heightMaxCm ?? "…"} cm` : "Any") : "Mellocrush Plus"} />
        <ListRow asDiv label={<span className="flex items-center gap-2">Education <PlusTag size="xs" /></span>} meta={filters.advancedEnabled ? (filters.education || "Any") : "Mellocrush Plus"} />
      </ListGroup>
      {ageWarning ? <p role="status" className="text-caption font-medium leading-relaxed text-warning">{ageWarning}</p> : null}
      <Button onClick={() => setOpen(true)} className="h-11.5">Edit preferences</Button>
      <FiltersSheet open={open} onClose={() => setOpen(false)} filters={filters} locations={locations} saving={saving} error={error} onApply={(d) => void apply(d)} onLockedAdvanced={() => router.push("/settings/membership")} />
    </PageOverlay>
  );
}
