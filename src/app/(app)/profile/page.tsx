import Link from "next/link";
import { VERIFICATION_LABELS } from "@/constants/labels";
import { ProfileAvatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/icons";
import { LinkRow, ListGroup, SectionLabel } from "@/components/ui/surface";
import { AppScreen, ScrollArea, Stack } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { ThemeToggleIcon } from "@/components/layout/theme-toggle";
import { requireActiveUser } from "@/server/auth/current-user";
import { getMyProfileSummary } from "@/server/profiles/me";

export const metadata = { title: "Profile" };
// Private, personalised data: rendered per request for the signed-in user only.
export const dynamic = "force-dynamic";

const SUGGESTION_HREF: Record<string, string> = {
  prompt: "/profile/edit?section=prompts",
  verify: "/settings/verification",
  interests: "/profile/edit?section=interests",
  photo: "/profile/edit?section=photos",
  bio: "/profile/edit?section=about",
};

/** Profile tab (prototype): completion ring, name + seal, island · occupation, Edit / Preview, suggestions, rows. */
export default async function ProfilePage() {
  const actor = await requireActiveUser();
  const me = await getMyProfileSummary(actor);
  const rows: { label: string; meta: string; href: string }[] = [
    { label: "My Likes", meta: String(me.likesGiven), href: "/likes" },
    { label: "My Matches", meta: String(me.activeMatches), href: "/likes?tab=matches" },
    { label: "Saved Posts", meta: "", href: "/community" },
    { label: "Membership", meta: me.tier === "PLUS" ? "Plus" : "Free", href: "/settings/membership" },
    { label: "Privacy & Safety", meta: "", href: "/settings/privacy" },
    { label: "Verification", meta: VERIFICATION_LABELS[me.verificationStatus], href: "/settings/verification" },
    { label: "Settings", meta: "", href: "/settings" },
    { label: "Help & Support", meta: "", href: "/settings/safety" },
  ];
  const meta = [me.location, me.occupation].filter(Boolean).join(" · ");
  return (
    <AppScreen aria-label="Profile">
      <TabHeader title="Profile" actions={<ThemeToggleIcon />} />
      <ScrollArea>
        <Stack className="pt-2">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <ProfileAvatar name={me.name} photo={me.primaryPhoto ? { url: me.primaryPhoto.url, key: me.primaryPhoto.key, blurhash: me.primaryPhoto.blurhash } : null} completion={me.completion.percent} verified={me.verified} />
            <div className="mt-2 flex items-center gap-1.5 text-h3 text-text">
              <span>{me.age != null ? `${me.name}, ${me.age}` : me.name}</span>
              {me.verified ? <VerifiedBadge size={20} /> : null}
            </div>
            {meta ? <div className="-mt-2 text-body-sm text-text-secondary">{meta}</div> : null}
            <div className="mt-1 flex w-full max-w-95 gap-2.5">
              <Link href="/profile/edit" className="flex h-12.5 flex-1 items-center justify-center rounded-lg bg-primary text-body font-bold text-on-primary pressable">
                Edit profile
              </Link>
              <Link href="/profile/preview" className="flex h-12.5 flex-1 items-center justify-center rounded-lg border border-border bg-surface text-body font-bold text-text pressable">
                Preview
              </Link>
            </div>
          </div>

          {me.completion.suggestions.length > 0 ? (
            <Stack gap="sm">
              <SectionLabel>Complete your profile</SectionLabel>
              <ListGroup radius="2xl">
                {me.completion.suggestions.map((s) => (
                  <LinkRow
                    key={s.key}
                    href={SUGGESTION_HREF[s.key] ?? "/profile/edit"}
                    height={56}
                    label={s.label}
                    leading={<span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-aqua-soft text-micro font-extrabold text-primary-ink">+{s.points}</span>}
                    className="pl-3 pr-3.5"
                  />
                ))}
              </ListGroup>
            </Stack>
          ) : null}

          <ListGroup>
            {rows.map((r) => (
              <LinkRow key={r.label} href={r.href} height={60} label={r.label} meta={r.meta || undefined} />
            ))}
          </ListGroup>
        </Stack>
      </ScrollArea>
    </AppScreen>
  );
}
