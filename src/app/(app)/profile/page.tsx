import { ProfileAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/ui/icons";
import { ListGroup, ListRow, SectionLabel } from "@/components/ui/surface";
import { AppScreen, ScrollArea, Stack } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { ThemeToggleIcon } from "@/components/layout/theme-toggle";
import { isDevelopment } from "@/lib/runtime";
import { FIXTURE_ME } from "@/dev/fixtures";

export const metadata = { title: "Profile" };

/** Phase 4: Profile screen chrome with fixture data. Editing, privacy and settings arrive in Phase 10. */
export default function ProfilePage() {
  const me = isDevelopment ? FIXTURE_ME : null;
  const suggestions = [
    { label: "Answer a profile prompt", pts: "+10" },
    { label: "Verify your profile", pts: "+15" },
    { label: "Add another photo", pts: "+5" },
  ];
  const rows: [string, string][] = [
    ["My Likes", "0"],
    ["My Matches", "3"],
    ["Saved Posts", ""],
    ["Membership", "Free"],
    ["Privacy & Safety", ""],
    ["Verification", "Unverified"],
    ["Settings", ""],
    ["Help & Support", ""],
  ];
  return (
    <AppScreen aria-label="Profile">
      <TabHeader title="Profile" actions={<ThemeToggleIcon />} />
      <ScrollArea>
        <Stack className="pt-2">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <ProfileAvatar name={me?.name ?? "You"} photo={me?.photo} completion={me?.completion ?? 0} verified={me?.verified} />
            <div className="mt-2 flex items-center gap-1.5 text-h3 text-text">
              <span>{me ? `${me.name}, ${me.age}` : "Your profile"}</span>
              {me?.verified ? <VerifiedBadge size={20} /> : null}
            </div>
            {me ? <div className="-mt-2 text-body-sm text-text-secondary">{me.location} · {me.occupation}</div> : null}
            <div className="mt-1 flex w-full max-w-95 gap-2.5">
              <Button size="md" fullWidth className="h-12.5">Edit profile</Button>
              <Button size="md" variant="secondary" fullWidth className="h-12.5">Preview</Button>
            </div>
          </div>

          <Stack gap="sm">
            <SectionLabel>Complete your profile</SectionLabel>
            <ListGroup radius="2xl">
              {suggestions.map((s) => (
                <ListRow
                  key={s.label}
                  height={56}
                  label={s.label}
                  leading={<span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-aqua-soft text-micro font-extrabold text-primary-pressed">{s.pts}</span>}
                  className="pl-3 pr-3.5"
                />
              ))}
            </ListGroup>
          </Stack>

          <ListGroup>
            {rows.map(([label, meta]) => (
              <ListRow key={label} height={60} label={label} meta={meta || undefined} />
            ))}
          </ListGroup>
        </Stack>
      </ScrollArea>
    </AppScreen>
  );
}
