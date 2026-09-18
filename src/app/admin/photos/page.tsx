import Link from "next/link";
import { AdminPage, Pagination } from "@/components/features/admin/admin-ui";
import { PhotoQueue } from "@/components/features/admin/photo-queue";
import { requireAdminPage } from "@/server/admin/authz";
import { listPendingPhotos } from "@/server/admin/photo-moderation";

export const metadata = { title: "Photos · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPhotosPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const admin = await requireAdminPage("photos.moderate");
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const queue = await listPendingPhotos(admin, { page });
  return (
    <AdminPage
      title="Photos"
      description="Every uploaded photo waits here before anyone else can see it. A profile needs two approved photos to appear in Discover, so an unreviewed queue keeps people invisible."
    >
      <PhotoQueue items={queue.items} />
      <Pagination page={queue.page} pageSize={queue.pageSize} total={queue.total} hrefFor={(p) => `/admin/photos?page=${p}`} />
      <p className="text-caption text-text-secondary">
        Decisions are recorded in the <Link href="/admin/audit" className="font-semibold text-primary-ink hover:underline">audit log</Link> with the reviewer and the reason.
      </p>
    </AdminPage>
  );
}
