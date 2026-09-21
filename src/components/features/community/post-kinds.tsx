"use client";

import type { ReactNode } from "react";
import { ChatPlusIcon, ImageIcon, PollIcon, QuestionIcon, WhisperIcon } from "@/components/ui/icons";
import type { CommunityPostKind } from "@/server/community/dto";

/**
 * The five things a member can post, described once (spec §3, §4). The create sheet, the quick-post row and the
 * compose sheet all read this list, so the wording of "Confession" — the one kind with a privacy promise attached
 * — cannot say one thing in the menu and another on the form.
 *
 * The order is the one the brief gives for the create sheet: Post, Question, Poll, Photo, Confession.
 */
export interface PostKindSpec {
  value: CommunityPostKind;
  label: string;
  /** One line under the label in the create sheet. */
  hint: string;
  placeholder: string;
  icon: ReactNode;
}

export const POST_KINDS: readonly PostKindSpec[] = [
  { value: "TEXT", label: "Post", hint: "Say what's on your mind", placeholder: "What's on your mind?", icon: <ChatPlusIcon size={19} /> },
  { value: "QUESTION", label: "Question", hint: "Ask the community something", placeholder: "Ask the community something…", icon: <QuestionIcon size={19} /> },
  { value: "POLL", label: "Poll", hint: "Two to four options, one vote each", placeholder: "What are you asking?", icon: <PollIcon size={19} /> },
  { value: "PHOTO", label: "Photo", hint: "Reviewed before anyone else sees it", placeholder: "Add a caption…", icon: <ImageIcon size={19} /> },
  { value: "CONFESSION", label: "Confession", hint: "Shown without your name", placeholder: "Get it off your chest…", icon: <WhisperIcon size={19} /> },
];

export function postKind(value: CommunityPostKind): PostKindSpec {
  return POST_KINDS.find((k) => k.value === value) ?? POST_KINDS[0]!;
}

/**
 * What a confession author is told, in the create sheet and again on the form. It is deliberately precise about
 * the limit of the promise: other members never see who posted it, and moderators still can. Promising more than
 * the system delivers is worse than promising nothing.
 */
export const CONFESSION_NOTICE = "Your name, photo and island are hidden from everyone. Moderators can still see who posted it if it's reported.";
