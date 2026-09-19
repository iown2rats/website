import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { SectionLabel } from "@/components/ui/surface";
import type { PhotoRef } from "@/lib/photos";

/*
 * Desktop right panel on Discover: "NEW MATCHES" 48 px ringed avatars in a wrap row, then "ACTIVITY" rows:
 * 36 px avatar, 13 px text with a medium name, 11.5 px secondary time (compact pass, §32).
 */
export interface AsideMatch {
  name: string;
  photo: PhotoRef;
  href?: string;
}
export interface AsideActivity {
  name: string;
  text: string;
  time: string;
  photo: PhotoRef;
}

export function RightAside({ matches, activity, footer }: { matches: AsideMatch[]; activity: AsideActivity[]; footer?: ReactNode }) {
  return (
    <>
      <div>
        <SectionLabel className="mb-2.5">New matches</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {matches.map((m) => (
            <a key={m.name} href={m.href ?? "/chats"} aria-label={`Open chat with ${m.name}`} className="rounded-full">
              <Avatar name={m.name} photo={m.photo} size={48} ring />
            </a>
          ))}
          {matches.length === 0 ? <p className="text-caption text-text-secondary">No new matches yet.</p> : null}
        </div>
      </div>
      <div>
        <SectionLabel className="mb-2.5">Activity</SectionLabel>
        <ul className="flex flex-col gap-2.5">
          {activity.map((a, i) => (
            <li key={i} className="flex items-center gap-3">
              <Avatar name={a.name} photo={a.photo} size={36} />
              <div className="text-body-sm leading-snug text-text">
                <span className="font-medium">{a.name}</span> {a.text}
                <div className="text-micro text-text-secondary">{a.time}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {footer}
    </>
  );
}
