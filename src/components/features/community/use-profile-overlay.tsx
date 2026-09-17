"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { loadCommunityProfile } from "@/actions/community";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { toDeckCard, type DeckCard } from "@/components/features/discovery/types";
import { useToast } from "@/components/ui/toast";
import type { CommunityAuthorDto } from "@/server/community/dto";
import { call } from "./call";

/**
 * Opens a Community author's profile in the prototype's full-profile overlay, read-only (no Pass/Like: dating
 * actions stay in Discover). The server applies block, contact-block, hidden age/location and photo policy; a
 * profile that isn't visible reads as "not available" rather than revealing why. Own avatar goes to /profile.
 */
export function useProfileOverlay(): { open: (author: CommunityAuthorDto) => Promise<void>; loadingHandle: string | null; element: ReactNode } {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<DeckCard | null>(null);
  const [loadingHandle, setLoadingHandle] = useState<string | null>(null);

  const open = useCallback(
    async (author: CommunityAuthorDto) => {
      if (author.isMe) { router.push("/profile"); return; }
      if (!author.handle) { toast.show("This profile isn't available."); return; }
      setLoadingHandle(author.handle);
      const r = await call(() => loadCommunityProfile({ handle: author.handle }));
      setLoadingHandle(null);
      if (!r.ok) { toast.show(r.code === "NOT_FOUND" ? "This profile isn't available." : r.message); return; }
      setProfile(toDeckCard(r.profile));
    },
    [router, toast],
  );

  const element = profile ? <FullProfile profile={profile} onClose={() => setProfile(null)} /> : null;
  return { open, loadingHandle, element };
}
