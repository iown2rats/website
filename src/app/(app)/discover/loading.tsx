import { IconButton } from "@/components/ui/button";
import { FilterIcon } from "@/components/ui/icons";
import { SkeletonCard } from "@/components/ui/skeleton";
import { AppScreen, DiscoveryFrame } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";

export default function DiscoverLoading() {
  return (
    <AppScreen aria-busy="true" aria-label="Loading Discover">
      <TabHeader logo title="Discover" actions={<IconButton aria-label="Filters" disabled><FilterIcon size={20} /></IconButton>} />
      <DiscoveryFrame>
        <SkeletonCard className="bottom-20" />
      </DiscoveryFrame>
    </AppScreen>
  );
}
