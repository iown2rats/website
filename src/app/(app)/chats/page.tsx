export const metadata = { title: "Chats" };

/** Desktop detail placeholder (prototype: "Select a conversation"). On phones the layout shows the list alone. */
export default function ChatsPage() {
  return (
    <div className="hidden flex-1 place-items-center text-body text-text-secondary desktop:grid" aria-live="polite">
      Select a conversation
    </div>
  );
}
