"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAboutSection, saveInfo } from "@/actions/profile";
import { GENDER_LABELS, INTENT_LABELS } from "@/constants/labels";
import { INTEREST_LIMITS, PROMPT_LIMITS } from "@/config/product";
import { HEIGHT_RANGE, PROFILE_TEXT_LIMITS } from "@/lib/validation/profile";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip, RadioCard, RadioGroup } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/field";
import { ChevronRightIcon } from "@/components/ui/icons";
import { SectionLabel } from "@/components/ui/surface";
import { PillTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { PageOverlay } from "@/components/layout/page-overlay";
import type { EditProfileData } from "@/server/profiles/edit";
import { LocationPicker, type LocationOption } from "./location-picker";
import { PhotoManager } from "./photo-manager";

/*
 * Prototype "Edit profile" page: pill tabs Photos / Info / About / Interests / Prompts and a Save button in the
 * header ("Profile saved" toast). Photos save as they change (upload, remove, reorder, make main). Info rows are
 * a bordered card with the label on the left and the value right-aligned; Name and Date of birth are read-only
 * ("Name and date of birth can't be changed after verification"). About/Interests/Prompts share one save.
 */
export type EditSection = "photos" | "info" | "about" | "interests" | "prompts";
const SECTIONS: { value: EditSection; label: string }[] = [
  { value: "photos", label: "Photos" },
  { value: "info", label: "Info" },
  { value: "about", label: "About" },
  { value: "interests", label: "Interests" },
  { value: "prompts", label: "Prompts" },
];
const INTENTS = Object.entries(INTENT_LABELS) as [keyof typeof INTENT_LABELS, string][];
const GENDERS = Object.entries(GENDER_LABELS) as [keyof typeof GENDER_LABELS, string][];

export interface EditProfileProps {
  initial: EditProfileData;
  section: EditSection;
  locations: LocationOption[];
  interests: { id: string; label: string }[];
  prompts: { id: string; text: string }[];
  /** Production hides a photo until a reviewer approves it; the grid says so (src/lib/photo-policy.ts). */
  reviewedBeforeVisible: boolean;
}

interface InfoDraft {
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | "";
  locationId: string | null;
  homeLocationId: string | null;
  occupation: string;
  education: string;
  heightCm: string;
}

function infoDraft(p: EditProfileData): InfoDraft {
  return { gender: p.gender ?? "", locationId: p.locationId, homeLocationId: p.homeLocationId, occupation: p.occupation, education: p.education, heightCm: p.heightCm ? String(p.heightCm) : "" };
}

export function EditProfile({ initial, section: initialSection, locations, interests, prompts, reviewedBeforeVisible }: EditProfileProps) {
  const router = useRouter();
  const toast = useToast();
  const [section, setSection] = useState<EditSection>(initialSection);
  const [profile, setProfile] = useState(initial);
  const [info, setInfo] = useState<InfoDraft>(() => infoDraft(initial));
  const [bio, setBio] = useState(initial.bio);
  const [intent, setIntent] = useState(initial.intent);
  const [selected, setSelected] = useState<string[]>(initial.interestIds);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(initial.prompts.map((p) => [p.promptId, p.answer])));
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [picker, setPicker] = useState<"location" | "home" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = Object.entries(answers).filter(([, a]) => a.trim().length > 0);
  const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? null;

  const save = async () => {
    setSaving(true);
    setError(null);
    let result;
    if (section === "info") {
      const height = info.heightCm.trim();
      result = await saveInfo({ gender: info.gender, locationId: info.locationId, homeLocationId: info.homeLocationId, occupation: info.occupation, education: info.education, heightCm: height ? Number(height) : null }).catch(() => null);
    } else {
      if (!intent) { setSaving(false); setError("Choose what you're looking for."); setSection("about"); return; }
      result = await saveAboutSection({ bio, intent, interestIds: selected, prompts: answered.map(([promptId, answer]) => ({ promptId, answer: answer.trim() })) }).catch(() => null);
    }
    setSaving(false);
    if (!result) { setError("Mellocrush couldn't reach the server. Check your connection and try again."); return; }
    if (!result.ok) { setError(result.message); return; }
    setProfile(result.profile);
    setInfo(infoDraft(result.profile));
    toast.show("Profile saved");
    router.refresh();
  };

  const toggleInterest = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= INTEREST_LIMITS.max ? s : [...s, id]));
  const dob = profile.dob ? `${String(profile.dob.day).padStart(2, "0")} · ${String(profile.dob.month).padStart(2, "0")} · ${profile.dob.year}` : "";

  const rowClass = "flex h-12 items-center justify-between gap-4 px-3.5 text-body";
  const valueInput = "min-w-0 flex-1 border-0 bg-transparent text-right text-body font-medium text-text outline-none placeholder:font-medium placeholder:text-text-muted";

  return (
    <PageOverlay
      title="Edit profile"
      backHref="/profile"
      action={section !== "photos" ? <Button size="sm" onClick={() => void save()} loading={saving} className="h-10 rounded-md px-4 text-body-sm">Save</Button> : undefined}
    >
      <PillTabs label="Edit profile sections" value={section} onChange={(s) => { setSection(s); setError(null); }} items={SECTIONS} scrollable />

      {section === "photos" ? (
        <>
          <p className="text-body-sm leading-relaxed text-text-secondary">Up to 6 photos. Drag to reorder — the first is your main photo. Changes to photos save automatically.</p>
          <PhotoManager initialPhotos={profile.photos} reviewedBeforeVisible={reviewedBeforeVisible} layout="featured" note="Keep at least 2 photos. New photos are reviewed before other members see them. JPG, PNG or WebP up to 8 MB." />
        </>
      ) : null}

      {section === "info" ? (
        <>
          <div className="flex shrink-0 flex-col overflow-hidden rounded-card glass-card [&>*+*]:border-t [&>*+*]:border-border">
            <div className={rowClass}>
              <span className="shrink-0 text-text-secondary">Name</span>
              <span className="truncate text-right font-medium text-text opacity-55" aria-readonly="true">{profile.name}</span>
            </div>
            <div className={rowClass}>
              <span className="shrink-0 text-text-secondary">Date of birth</span>
              <span className="text-right font-medium text-text opacity-55 tabular-nums" aria-readonly="true">{dob}</span>
            </div>
            <label className={rowClass}>
              <span className="shrink-0 text-text-secondary">Gender</span>
              <select value={info.gender} onChange={(e) => setInfo({ ...info, gender: e.target.value as InfoDraft["gender"] })} className={cn(valueInput, "appearance-none cursor-pointer")} aria-label="Gender">
                <option value="" disabled>Choose</option>
                {GENDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setPicker("location")} className={cn(rowClass, "w-full border-0 bg-transparent text-left hover:bg-surface-muted")} aria-haspopup="dialog">
              <span className="shrink-0 text-text-secondary">Location</span>
              <span className="flex min-w-0 items-center gap-1 font-medium text-text"><span className="truncate">{locationName(info.locationId) ?? "Choose"}</span><ChevronRightIcon size={16} className="text-text-secondary" /></span>
            </button>
            <button type="button" onClick={() => setPicker("home")} className={cn(rowClass, "w-full border-0 bg-transparent text-left hover:bg-surface-muted")} aria-haspopup="dialog">
              <span className="shrink-0 text-text-secondary">Home island</span>
              <span className="flex min-w-0 items-center gap-1 font-medium text-text"><span className={cn("truncate", !info.homeLocationId && "font-medium text-text-muted")}>{locationName(info.homeLocationId) ?? "Optional"}</span><ChevronRightIcon size={16} className="text-text-secondary" /></span>
            </button>
            <label className={rowClass}>
              <span className="shrink-0 text-text-secondary">Occupation</span>
              <input value={info.occupation} maxLength={PROFILE_TEXT_LIMITS.occupation} onChange={(e) => setInfo({ ...info, occupation: e.target.value })} placeholder="What you do" className={valueInput} aria-label="Occupation" />
            </label>
            <label className={rowClass}>
              <span className="shrink-0 text-text-secondary">Education</span>
              <input value={info.education} maxLength={PROFILE_TEXT_LIMITS.education} onChange={(e) => setInfo({ ...info, education: e.target.value })} placeholder="School or college" className={valueInput} aria-label="Education" />
            </label>
            <label className={rowClass}>
              <span className="shrink-0 text-text-secondary">Height</span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
                <input value={info.heightCm} inputMode="numeric" pattern="[0-9]*" maxLength={3} onChange={(e) => setInfo({ ...info, heightCm: e.target.value.replace(/\D/g, "") })} placeholder="Optional" className={cn(valueInput, "w-20 flex-none")} aria-label={`Height in centimetres, ${HEIGHT_RANGE.min} to ${HEIGHT_RANGE.max}`} />
                <span className="text-caption text-text-secondary">cm</span>
              </span>
            </label>
          </div>
          <p className="text-caption leading-relaxed text-text-secondary">Name and date of birth can&apos;t be changed after verification. Home island is optional and never shown unless you allow it.</p>
        </>
      ) : null}

      {section === "about" ? (
        <>
          <SectionLabel>About me</SectionLabel>
          <label htmlFor="edit-bio" className="sr-only">About me</label>
          <Textarea id="edit-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={300} placeholder="A line or two about you" className="-mt-2" />
          <SectionLabel>Relationship intention</SectionLabel>
          <RadioGroup label="Relationship intention" className="-mt-2 gap-2">
            {INTENTS.map(([value, label]) => (
              <RadioCard key={value} selected={intent === value} onSelect={() => setIntent(value)} label={label} className="h-12" />
            ))}
          </RadioGroup>
        </>
      ) : null}

      {section === "interests" ? (
        <>
          <p className="text-body-sm text-text-secondary">Pick up to {INTEREST_LIMITS.max}. {selected.length} selected.</p>
          <div className="-mt-2 flex flex-wrap gap-2">
            {interests.map((i) => (
              <Chip key={i.id} selected={selected.includes(i.id)} onClick={() => toggleInterest(i.id)} disabled={!selected.includes(i.id) && selected.length >= INTEREST_LIMITS.max} aria-pressed={selected.includes(i.id)}>
                {i.label}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {section === "prompts" ? (
        <>
          <p className="text-body-sm text-text-secondary">Choose up to {PROMPT_LIMITS.max} prompts and answer them in your own words.</p>
          <div className="-mt-2 flex flex-col gap-2.5">
            {prompts.map((p) => {
              const answer = answers[p.id] ?? "";
              const has = answer.trim().length > 0;
              const isOpen = openPrompt === p.id;
              const canOpen = has || answered.length < PROMPT_LIMITS.max;
              return (
                <div key={p.id} className={cn("shrink-0 overflow-hidden rounded-2xl", has ? "bg-primary-soft" : "bg-surface-muted")}>
                  <button type="button" aria-expanded={isOpen} onClick={() => (isOpen ? setOpenPrompt(null) : canOpen ? setOpenPrompt(p.id) : undefined)} className="flex h-12 w-full items-center justify-between border-0 bg-transparent px-3.5 text-left text-body font-medium text-text">
                    <span>{p.text}</span>
                    <span className="text-micro text-primary-ink">{has ? "Answered" : canOpen ? "Add" : ""}</span>
                  </button>
                  {isOpen ? (
                    <textarea aria-label={p.text} value={answer} maxLength={200} rows={2} autoFocus onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))} placeholder="Your answer" className="block w-full resize-none border-0 border-t border-border bg-surface-muted px-3.5 py-3.5 text-body leading-normal text-text outline-none placeholder:text-text-muted" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {error ? <p role="alert" className="text-caption font-medium text-danger">{error}</p> : null}

      <LocationPicker open={picker === "location"} onClose={() => setPicker(null)} title="Where do you live?" locations={locations} selectedId={info.locationId} onSelect={(id) => setInfo({ ...info, locationId: id })} />
      <LocationPicker open={picker === "home"} onClose={() => setPicker(null)} title="Home island" locations={locations} selectedId={info.homeLocationId} onSelect={(id) => setInfo({ ...info, homeLocationId: id })} allowNone />
    </PageOverlay>
  );
}
