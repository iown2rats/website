"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HeartIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { SegmentedControl } from "@/components/ui/tabs";

/** Phase 4: the Likes screen chrome (segmented control + states). The grids arrive with Phase 7. */
export function LikesPreview() {
  const [tab, setTab] = useState<"you" | "matches">("you");
  const router = useRouter();
  return (
    <>
      <SegmentedControl
        label="Likes sections"
        className="mb-4 mt-2"
        value={tab}
        onChange={setTab}
        items={[
          { value: "you", label: "Likes You" },
          { value: "matches", label: "Matches" },
        ]}
      />
      {tab === "you" ? (
        <EmptyState icon={<HeartIcon />} title="No new likes yet." description="When someone likes you, they'll appear here." />
      ) : (
        <EmptyState
          icon={<HeartIcon />}
          title="Your next match could be one swipe away."
          actions={<Button size="md" onClick={() => router.push("/discover")}>Start swiping</Button>}
        />
      )}
    </>
  );
}
