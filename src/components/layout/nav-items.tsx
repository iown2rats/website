import type { ComponentType } from "react";
import { ChatIcon, HeartIcon, PeopleIcon, PersonIcon, WavesIcon, type IconProps } from "@/components/ui/icons";

/** Primary navigation exactly as the prototype orders and labels it. */
export type NavKey = "discover" | "community" | "likes" | "chats" | "profile";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  Icon: ComponentType<IconProps>;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "discover", label: "Discover", href: "/discover", Icon: WavesIcon },
  { key: "community", label: "Community", href: "/community", Icon: PeopleIcon },
  { key: "likes", label: "Likes", href: "/likes", Icon: HeartIcon },
  { key: "chats", label: "Chats", href: "/chats", Icon: ChatIcon },
  { key: "profile", label: "Profile", href: "/profile", Icon: PersonIcon },
];

export type NavBadges = Partial<Record<NavKey, number>>;

export function activeNavKey(pathname: string): NavKey | null {
  const item = NAV_ITEMS.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  return item?.key ?? null;
}
