import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { LikesPreview } from "./likes-preview";

export const metadata = { title: "Likes" };

export default function LikesPage() {
  return (
    <AppScreen aria-label="Likes">
      <TabHeader title="Likes" />
      <ScrollArea>
        <LikesPreview />
      </ScrollArea>
    </AppScreen>
  );
}
