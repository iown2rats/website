"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { unblock } from "@/actions/settings";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { ShieldIcon, VerifiedBadge } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { ListGroup } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { PageOverlay } from "@/components/layout/page-overlay";
import type { BlockedUserDto } from "@/server/safety/blocked";

/*
 * Blocked users (prototype: "Blocked profiles (n)" under Privacy & Safety). Minimal identity to recognise the person
 * (avatar, name, seal) and an Unblock action with confirmation. Unblocking only removes the block: it never restores
 * likes, matches or conversations, and the other person is not notified.
 */
export function BlockedClient({ initial }: { initial: BlockedUserDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [blocked, setBlocked] = useState(initial);
  const [target, setTarget] = useState<BlockedUserDto | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    const r = await unblock({ handle: target.handle }).catch(() => null);
    setBusy(false);
    setTarget(null);
    if (!r || !r.ok) { toast.show(r && !r.ok ? r.message : "Couldn't unblock right now. Try again."); return; }
    setBlocked(r.blocked);
    toast.show(`Unblocked ${target.name}`);
    router.refresh();
  };

  return (
    <PageOverlay title="Blocked users" backHref="/settings/privacy">
      {blocked.length === 0 ? (
        <EmptyState icon={<ShieldIcon />} title="No one is blocked." description="People you block from Discover, chats or Community appear here, and you can unblock them any time." />
      ) : (
        <>
          <p className="text-body-sm text-text-secondary">Blocked people can&apos;t see your profile, posts or messages, and you can&apos;t see theirs. Unblocking doesn&apos;t restore old likes, matches or chats.</p>
          <ListGroup>
            {blocked.map((b) => (
              <div key={b.handle} className="flex items-center gap-3 px-4.5 py-3">
                <Avatar name="" aria-hidden="true" size={44} photo={b.photo ? { url: b.photo.url, key: b.photo.demoKey, blurhash: b.photo.blurhash } : null} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.25 text-body font-bold text-text"><span className="truncate">{b.name}</span>{b.verified ? <VerifiedBadge size={14} /> : null}</div>
                  <div className="text-caption text-text-secondary">Blocked {new Date(b.blockedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setTarget(b)} className="h-9 rounded-md px-3.5 text-caption" aria-label={`Unblock ${b.name}`}>Unblock</Button>
              </div>
            ))}
          </ListGroup>
        </>
      )}
      <ConfirmationDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => void confirm()}
        title={`Unblock ${target?.name ?? ""}?`}
        description="They may appear in Discover again if you match each other's preferences. Your old likes, match and chat are not restored, and they won't be told."
        confirmLabel="Unblock"
        loading={busy}
      />
    </PageOverlay>
  );
}
