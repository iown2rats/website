import { IconButton } from "@/components/ui/button";
import { PeopleIcon, PlusIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { CommunityTabs } from "./community-tabs";

export const metadata = { title: "Community" };

/** Phase 4: Community screen chrome (pill tabs, FAB, empty state). Feed arrives in Phase 9. */
export default function CommunityPage() {
  return (
    <AppScreen aria-label="Community" className="relative">
      <TabHeader title="Community" />
      <CommunityTabs />
      <ScrollArea>
        <EmptyState icon={<PeopleIcon />} title="Nothing here yet." description="Be the first to post something." />
      </ScrollArea>
      <IconButton
        aria-label="Create post"
        variant="ocean"
        round
        size={54}
        className="absolute right-5 z-[5] shadow-lg desktop:bottom-6"
        style={{ bottom: "calc(88px + var(--safe-bottom))" }}
      >
        <PlusIcon size={26} strokeWidth={2.4} />
      </IconButton>
    </AppScreen>
  );
}
