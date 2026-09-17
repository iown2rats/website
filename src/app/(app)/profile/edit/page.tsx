import { EditProfile, type EditSection } from "@/components/features/profile/edit-profile";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getEditProfileData } from "@/server/profiles/edit";

export const metadata = { title: "Edit profile" };
export const dynamic = "force-dynamic";

const SECTIONS = new Set<EditSection>(["photos", "info", "about", "interests", "prompts"]);

export default async function EditProfilePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const actor = await requireActiveUser();
  const { section } = await searchParams;
  const db = getDb();
  const [profile, locations, interests, prompts] = await Promise.all([
    getEditProfileData(actor, { db }),
    db.location.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true, atollName: true } }),
    db.interest.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
    db.prompt.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, text: true } }),
  ]);
  const initialSection = SECTIONS.has(section as EditSection) ? (section as EditSection) : "photos";
  return <EditProfile initial={profile} section={initialSection} locations={locations} interests={interests} prompts={prompts} />;
}
