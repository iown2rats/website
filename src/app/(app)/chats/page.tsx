import { Input } from "@/components/ui/field";
import { ChatIcon, SearchIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";

export const metadata = { title: "Chats" };

/** Phase 4: Chats screen chrome. Conversations arrive in Phase 8. */
export default function ChatsPage() {
  return (
    <AppScreen aria-label="Chats">
      <TabHeader title="Chats" />
      <div className="mb-4.5 mt-2">
        <Input leading={<SearchIcon size={18} />} placeholder="Search matches" aria-label="Search matches" className="h-12 rounded-lg border-0 bg-surface-muted" />
      </div>
      <ScrollArea>
        <EmptyState icon={<ChatIcon />} title="Match with someone to start a conversation." />
      </ScrollArea>
    </AppScreen>
  );
}
