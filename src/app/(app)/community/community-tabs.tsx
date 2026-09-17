"use client";

import { useState } from "react";
import { PillTabs } from "@/components/ui/tabs";

export function CommunityTabs() {
  const [tab, setTab] = useState<"foryou" | "following" | "new">("foryou");
  return (
    <PillTabs
      label="Community feeds"
      className="mb-3.5 mt-2"
      value={tab}
      onChange={setTab}
      items={[
        { value: "foryou", label: "For You" },
        { value: "following", label: "Following" },
        { value: "new", label: "New" },
      ]}
    />
  );
}
