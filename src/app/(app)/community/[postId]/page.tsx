import { PostDetail } from "@/components/features/community/post-detail";
import { PostUnavailable } from "@/components/features/community/post-unavailable";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { requireActiveUser } from "@/server/auth/current-user";
import { listComments } from "@/server/community/comments";
import { getPost } from "@/server/community/feed";

export const metadata = { title: "Post" };
export const dynamic = "force-dynamic";

/**
 * One Community post with its comments. Visibility is decided server-side (deleted, blocked either way, contact
 * block, suspended author, undisplayable media): anything the viewer may not see renders the same "not available"
 * state, never a reason.
 */
export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await requireActiveUser();
  const { postId } = await params;
  const db = getDb();
  const now = new Date();
  const post = await getPost(actor, postId, { db, now }).catch((e: unknown) => {
    if (isDomainError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  });
  if (!post) return <PostUnavailable />;
  const comments = await listComments(actor, postId, {}, { db });
  return <PostDetail key={postId} initialPost={post} initialComments={comments} serverNow={now.toISOString()} />;
}
