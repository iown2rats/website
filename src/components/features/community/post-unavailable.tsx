import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";

/** "Content removed / not visible" state for a post that this viewer can no longer see (deleted, blocked, hidden). */
export function PostUnavailable() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 px-1.5" style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
        <Link href="/community" aria-label="Back" className="grid size-11 place-items-center rounded-md text-text hover:bg-surface-muted">
          <ChevronLeftIcon size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="flex-1 truncate text-prompt font-extrabold text-text">Post</h1>
      </header>
      <EmptyState
        className="my-auto"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        }
        title="This post isn't available."
        description="It may have been removed by its author, or it isn't visible to you."
        actions={
          <Link href="/community" className="inline-flex h-11 items-center rounded-lg border-[1.5px] border-border bg-surface px-5 text-body-sm font-bold text-text">
            Back to Community
          </Link>
        }
      />
    </div>
  );
}
