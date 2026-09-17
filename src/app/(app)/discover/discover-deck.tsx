"use client";

import { useState } from "react";
import { SwipeDeck } from "@/components/features/discovery/swipe-deck";
import type { CardProfile } from "@/components/features/discovery/types";
import { useToast } from "@/components/ui/toast";

/** Phase 4 wrapper: local-only interactions with toasts. Real like/pass mutations are wired in Phase 6/7. */
export function DiscoverDeck({ cards }: { cards: CardProfile[] }) {
  const toast = useToast();
  const [round, setRound] = useState(0);
  return (
    <SwipeDeck
      key={round}
      profiles={cards}
      showPlaceholderLabels
      onLike={(p) => toast.show(`Liked ${p.name} (preview)`)}
      onPass={() => undefined}
      onOpen={(p) => toast.show(`${p.name}'s full profile opens in Phase 6`)}
      onIntro={(p) => toast.show(`Intro to ${p.name} arrives in Phase 7`)}
      onAdjustFilters={() => toast.show("Filters arrive in Phase 6")}
      onReset={() => setRound((r) => r + 1)}
    />
  );
}
