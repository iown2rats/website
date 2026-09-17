import { logout } from "@/actions/auth";
import { ProfileAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/ui/icons";
import { ListGroup, ListRow, SectionLabel } from "@/components/ui/surface";
import { AppScreen, ScrollArea, Stack } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { ThemeToggleIcon } from "@/components/layout/theme-toggle";
import { requireActiveUser } from "@/server/auth/current-user";
import { getMyProfileSummary } from "@/server/profiles/me";

export const metadata = { title: "Profile" };

/** Profile tab with the signed-in user's real data. Editing, privacy and settings pages arrive in Phase 10. */
export default async function ProfilePage() {
  const actor = await requireActiveUser();
  const me = await getMyProfileSummary(actor);
  const rows: [string, string][] = [
    ["My Likes", ""],
    ["My Matches", ""],
    ["Saved Posts", ""],
    ["Membership", "Free"],
    ["Privacy & Safety", ""],
    ["Verification", me.verified ? "Verified" : "Unverified"],
    ["Settings", ""],
    ["Help & Support", ""],
  ];
  const meta = [me.location, me.occupation].filter(Boolean).join(" · ");
  return (
    <AppScreen aria-label="Profile">
      <TabHeader title="Profile" actions={<ThemeToggleIcon />} />
      <ScrollArea>
        <Stack className="pt-2">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <ProfileAvatar name={me.name} photo={me.primaryPhoto ? { url: me.primaryPhoto.url, blurhash: me.primaryPhoto.blurhash } : null} completion={me.completion.percent} verified={me.verified} />
            <div className="mt-2 flex items-center gap-1.5 text-h3 text-text">
              <span>{me.age != null ? `${me.name}, ${me.age}` : me.name}</span>
              {me.verified ? <VerifiedBadge size={20} /> : null}
            </div>
            {meta ? <div className="-mt-2 text-body-sm text-text-secondary">{meta}</div> : null}
            <div className="mt-1 flex w-full max-w-95 gap-2.5">
              <Button size="md" fullWidth className="h-12.5">Edit profile</Button>
              <Button size="md" variant="secondary" fullWidth className="h-12.5">Preview</Button>
            </div>
          </div>

          {me.completion.suggestions.length > 0 ? (
            <Stack gap="sm">
              <SectionLabel>Complete your profile</SectionLabel>
              <ListGroup radius="2xl">
                {me.completion.suggestions.map((s) => (
                  <ListRow
                    key={s.key}
                    height={56}
                    label={s.label}
                    leading={<span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-aqua-soft text-micro font-extrabold text-primary-pressed">+{s.points}</span>}
                    className="pl-3 pr-3.5"
                  />
                ))}
              </ListGroup>
            </Stack>
          ) : null}

          <ListGroup>
            {rows.map(([label, value]) => (
              <ListRow key={label} height={60} label={label} meta={value || undefined} />
            ))}
          </ListGroup>

          <form action={logout} className="flex justify-center">
            <Button type="submit" variant="ghost" size="sm" className="text-caption text-text-secondary">
              Log out
            </Button>
          </form>
        </Stack>
      </ScrollArea>
    </AppScreen>
  );
}
