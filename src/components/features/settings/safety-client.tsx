"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "@/components/ui/icons";
import { PageOverlay } from "@/components/layout/page-overlay";

/*
 * Prototype "Safety Center": intro line, five numbered accordion cards (radius 22, 40 px aqua tile, chevron rotates)
 * and a support card. Copy is the prototype's guidance, kept factual. The support channel is not configured yet, so
 * the card says so instead of showing a "Message support" button that goes nowhere; 119 is the Maldives Police
 * emergency number.
 */
const CARDS: [string, string][] = [
  ["Dating safely", "Keep conversations on Thundi until you trust someone. Never send money, and be wary of anyone who asks — a request for money, gift cards or bank details is the clearest sign of a scam."],
  ["Meeting someone", "Meet in a public place in Malé or your island, tell a friend where you'll be, and arrange your own transport home."],
  ["Protecting your privacy", "Use only your island or atoll, hide your age or active status if you prefer, and block your contacts so family and colleagues never see you here. Your phone number is never shown to anyone."],
  ["Reporting someone", "Tap the ··· on any profile, post or chat. Reports are anonymous, and blocking is immediate. Reporting a chat also blocks that person; reporting a post doesn't, so you can choose."],
  ["Community guidelines", "Be respectful, be honest, be 18+. Harassment, fake profiles and financial requests lead to permanent removal."],
];

export function SafetyClient() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <PageOverlay title="Safety Center" backHref="/profile">
      <p className="text-body leading-relaxed text-text-secondary">Everything about staying safe on Thundi, in one place.</p>
      <div className="flex flex-col gap-2.5">
        {CARDS.map(([label, body], i) => {
          const isOpen = open === i;
          return (
            <div key={label} className="shrink-0 overflow-hidden rounded-[22px] glass-card">
              <button type="button" aria-expanded={isOpen} aria-controls={`safety-${i}`} onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center gap-3.5 border-0 bg-transparent px-4.5 py-4 text-left text-text">
                <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-aqua-soft text-body-sm font-extrabold text-ocean">{i + 1}</span>
                <span className="flex-1 text-body-lg font-bold">{label}</span>
                <ChevronDownIcon size={18} className={cn("shrink-0 text-text-secondary transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              {isOpen ? <p id={`safety-${i}`} className="m-0 px-4.5 pb-4.5 pl-18 text-[14.5px] leading-relaxed text-text-secondary">{body}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2.5 rounded-card bg-surface-muted p-5">
        <h2 className="text-body-lg font-extrabold text-text">Contact support</h2>
        <p className="m-0 text-body-sm leading-relaxed text-text-secondary">A support inbox isn&apos;t connected yet, so messaging from here isn&apos;t available. Use the ··· menus to report anything right away. In an emergency, call 119 (Maldives Police).</p>
      </div>
    </PageOverlay>
  );
}
