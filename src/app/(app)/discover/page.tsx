import { IconButton } from "@/components/ui/button";
import { FilterIcon } from "@/components/ui/icons";
import { AppScreen, DiscoveryFrame } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { isDevelopment } from "@/lib/runtime";
import { FIXTURE_CARDS } from "@/dev/fixtures";
import { DiscoverDeck } from "./discover-deck";

export const metadata = { title: "Discover" };

export default function DiscoverPage() {
  // Phase 4: visual foundation with development fixtures. Production discovery queries arrive in Phase 6.
  const cards = isDevelopment ? FIXTURE_CARDS : [];
  return (
    <AppScreen aria-label="Discover">
      <TabHeader
        logo
        title="Discover"
        actions={
          <IconButton aria-label="Filters">
            <FilterIcon size={20} />
          </IconButton>
        }
      />
      <DiscoveryFrame>
        <DiscoverDeck cards={cards} />
      </DiscoveryFrame>
    </AppScreen>
  );
}
