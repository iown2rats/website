"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { toDeckCard } from "@/components/features/discovery/types";
import { EmptyState } from "@/components/ui/states";
import { PersonIcon } from "@/components/ui/icons";
import type { DiscoveryCardDto } from "@/server/discovery/dto";

export function PreviewProfile({ card }: { card: DiscoveryCardDto | null }) {
  const router = useRouter();
  if (!card) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <EmptyState
          icon={<PersonIcon />}
          title="Nothing to preview yet."
          description="Add your photos and details and your profile will appear here as others see it."
          actions={<Link href="/profile/edit" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-body-sm font-medium text-on-primary">Edit profile</Link>}
        />
      </div>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <FullProfile profile={toDeckCard(card)} onClose={() => router.push("/profile")} />
      <p role="status" className="pointer-events-none absolute inset-x-0 top-[calc(12px+var(--safe-top))] z-40 mx-auto w-fit rounded-full bg-ocean/90 px-4 py-2 text-caption font-medium text-on-ocean shadow-lg">
        This is how others see you
      </p>
    </div>
  );
}
