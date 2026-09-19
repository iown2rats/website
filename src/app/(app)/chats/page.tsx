import { ChatIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";

export const metadata = { title: "Chats" };

/**
 * The detail pane with no conversation chosen. On phones the layout shows the list alone and this never renders.
 * From 900 px it fills the pane rather than sitting as one grey line in the middle of it: at desktop scale an
 * unexplained sentence in an empty half-screen reads like a page that failed to load.
 */
export default function ChatsPage() {
  return (
    <div className="hidden flex-1 place-items-center p-8 desktop:grid" aria-live="polite">
      <EmptyState
        icon={<ChatIcon />}
        title="Choose a conversation"
        description="Your matches are listed on the left. Open one to pick up where you left off."
      />
    </div>
  );
}
