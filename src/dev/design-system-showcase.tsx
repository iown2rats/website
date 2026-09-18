"use client";

import { useState, type ReactNode } from "react";
import { Callout } from "@/components/ui/alert";
import { Avatar, ProfileAvatar } from "@/components/ui/avatar";
import { CounterBadge, PlusHeroTag, PlusTag, StatusBadge, Tag } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, Chip, Radio, RadioCard, RadioGroup, Switch } from "@/components/ui/choice";
import { ActionSheet, BottomSheet, ConfirmationDialog, DialogDescription, DialogTitle, Modal } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ChatPlusIcon, CloseIcon, EyeOffIcon, FilterIcon, HeartIcon, LockIcon, MoreIcon, SearchIcon, ShieldIcon, WavesIcon } from "@/components/ui/icons";
import { ProgressBar, StepCounter } from "@/components/ui/progress";
import { SkeletonCard, SkeletonRow, SkeletonText, SkeletonTile } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, OfflineBanner, SuccessMark } from "@/components/ui/states";
import { Card, Divider, ListGroup, ListRow, OceanCard, SectionLabel, Surface } from "@/components/ui/surface";
import { PillTabs, SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ThemeToggleIcon } from "@/components/layout/theme-toggle";
import { ProfileCard } from "@/components/features/discovery/profile-card";
import { SwipeDeck } from "@/components/features/discovery/swipe-deck";
import type { CardProfile } from "@/components/features/discovery/types";

function Section({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4 scroll-mt-4">
      <div>
        <h2 className="text-h3">{title}</h2>
        {note ? <p className="text-caption text-text-secondary">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

const SWATCHES: [string, string][] = [
  ["background", "bg-background border border-border"],
  ["surface", "bg-surface border border-border"],
  ["surface-muted", "bg-surface-muted"],
  ["border", "bg-border"],
  ["primary", "bg-primary"],
  ["primary-hover", "bg-primary-hover"],
  ["primary-pressed", "bg-primary-pressed"],
  ["ocean", "bg-ocean"],
  ["aqua", "bg-aqua"],
  ["aqua-soft", "bg-aqua-soft"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["sand (Plus accent)", "bg-sand"],
];

const TYPE_SCALE: [string, string, string][] = [
  ["display", "text-display", "It's a Match"],
  ["hero", "text-hero", "Meet someone closer to home."],
  ["name", "text-name", "Aishath, 26"],
  ["h1", "text-h1", "Likes"],
  ["h2", "text-h2", "When's your birthday?"],
  ["h3", "text-h3", "Filters"],
  ["h4", "text-h4", "That's everyone for now."],
  ["prompt", "text-prompt", "A ferry to a quiet island, a book, and no signal until Sunday evening."],
  ["body-lg", "text-body-lg", "Malé born, lagoon raised. I plan trips I never take and take trips I never plan."],
  ["body", "text-body", "Only your island or atoll is ever shown — never a distance."],
  ["body-sm", "text-body-sm", "Set up how private you want to be before anyone sees you."],
  ["caption", "text-caption", "Your number is never shown on your profile."],
  ["label", "text-label uppercase text-text-secondary", "About me"],
  ["micro", "text-micro", "4 / 12"],
];

export function DesignSystemShowcase({ cards }: { cards: CardProfile[] }) {
  const toast = useToast();
  const [segment, setSegment] = useState<"you" | "matches">("you");
  const [pill, setPill] = useState<"foryou" | "following" | "new">("foryou");
  const [radio, setRadio] = useState("Serious relationship");
  const [switches, setSwitches] = useState({ a: true, b: false, c: true });
  const [chips, setChips] = useState<string[]>(["Diving", "Coffee"]);
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [actions, setActions] = useState(false);
  const [plusSheet, setPlusSheet] = useState(false);
  const [loadingBtn, setLoadingBtn] = useState(false);
  const first = cards[0]!;

  return (
    <div className="min-h-dvh bg-background text-text">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur">
        <div className="flex items-center gap-2 text-h3 whitespace-nowrap">
          <WavesIcon size={22} className="text-primary" /> Design system
          <Tag variant="neutral" size="sm">dev only</Tag>
        </div>
        <ThemeToggleIcon />
      </header>

      <div className="mx-auto flex max-w-[1100px] flex-col gap-12 px-4 py-8 pb-32">
        <nav aria-label="Sections" className="flex flex-wrap gap-2">
          {["typography", "colors", "buttons", "inputs", "choice", "badges", "avatars", "surfaces", "tabs", "states", "dialogs", "plus", "card", "deck"].map((s) => (
            <a key={s} href={`#${s}`} className="rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-semibold capitalize text-text hover:bg-surface-muted">
              {s}
            </a>
          ))}
        </nav>

        <Section id="typography" title="Typography" note="Plus Jakarta Sans, self-hosted variable subsets. Sizes are the prototype's exact values.">
          <div className="flex flex-col gap-4">
            {TYPE_SCALE.map(([name, cls, sample]) => (
              <div key={name} className="grid grid-cols-[96px_1fr] items-baseline gap-4 border-b border-border pb-3">
                <code className="text-micro text-text-secondary">{name}</code>
                <div className={cls}>{sample}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="colors" title="Colour tokens" note="Semantic tokens switch with the theme; components never use raw hex.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {SWATCHES.map(([name, cls]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <div className={`h-14 rounded-lg ${cls}`} />
                <code className="text-tiny text-text-secondary">{name}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="buttons" title="Buttons" note="52 px primary / 48 md / 40 sm. Touch targets stay ≥ 44 px; press = scale(.97) 120 ms.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Continue</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="ghost">Maybe later</Button>
            <Button variant="destructive">Unmatch</Button>
            <Button variant="ocean">Submit report</Button>
            <Button variant="plus">Get Thundi Plus</Button>
            <Button variant="muted">Cancel</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md">Edit profile</Button>
            <Button size="sm">Unlock</Button>
            <Button loading={loadingBtn} onClick={() => { setLoadingBtn(true); setTimeout(() => setLoadingBtn(false), 1500); }}>
              {loadingBtn ? "Saving" : "Save (click for loading)"}
            </Button>
            <Button disabled>Disabled</Button>
            <Button leadingIcon={<HeartIcon size={18} filled strokeWidth={0} />} size="md">With icon</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <IconButton aria-label="Filters"><FilterIcon size={20} /></IconButton>
            <IconButton aria-label="Back" variant="ghost"><CloseIcon size={22} /></IconButton>
            <IconButton aria-label="More" variant="onPhoto" round className="bg-ocean/80 text-white"><MoreIcon size={20} /></IconButton>
            <IconButton aria-label="Add photo" variant="muted" round><SearchIcon size={20} /></IconButton>
            <IconButton aria-label="Send" variant="primary" round><ChatPlusIcon size={20} /></IconButton>
            <IconButton aria-label="Create post" variant="ocean" round size={54} elevated><HeartIcon size={24} /></IconButton>
            <IconButton aria-label="Options" variant="ghost" size={36}><MoreIcon size={18} /></IconButton>
          </div>
        </Section>

        <Section id="inputs" title="Inputs" note="52 px fields, radius 16; textarea radius 18; select with custom chevron.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" hint="Shown on your profile. You can't change it later.">{(p) => <Input {...p} emphasis placeholder="First name" />}</Field>
            <Field label="Phone" error="Enter the 7 digits after +960.">{(p) => <Input {...p} inputMode="tel" placeholder="7XX XXXX" emphasis />}</Field>
            <Field label="Search island or atoll" hideLabel>{(p) => <Input {...p} leading={<SearchIcon size={20} />} placeholder="Search island or atoll" className="h-14 rounded-xl" />}</Field>
            <Field label="Month">{(p) => <Select {...p} placeholder="Month" defaultValue=""><option>January</option><option>February</option><option>March</option></Select>}</Field>
            <Field label="About you" className="sm:col-span-2">{(p) => <Textarea {...p} placeholder="A line or two about you" />}</Field>
          </div>
        </Section>

        <Section id="choice" title="Choice controls" note="Radio cards, chips, switches (52×32 / 44×26), checkbox.">
          <RadioGroup label="Relationship intention" className="max-w-md">
            {["Serious relationship", "Dating", "Marriage", "Still figuring it out"].map((o) => (
              <RadioCard key={o} label={o} selected={radio === o} onSelect={() => setRadio(o)} />
            ))}
            <RadioCard label="Only people I like" description="You're invisible until you like someone first" selected={false} onSelect={() => setPlusSheet(true)} />
          </RadioGroup>
          <div className="flex flex-wrap gap-2">
            {["Travel", "Diving", "Coffee", "Football", "Photography", "Cooking"].map((c) => (
              <Chip key={c} selected={chips.includes(c)} onClick={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
                {c}
              </Chip>
            ))}
          </div>
          <ListGroup className="max-w-md">
            {(["a", "b", "c"] as const).map((k, i) => (
              <ListRow
                key={k}
                asDiv
                label={["Hide my location", "Hide my age", "Read receipts"][i]}
                meta={undefined}
                trailing={<Switch checked={switches[k]} onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k]: v }))} aria-label={["Hide my location", "Hide my age", "Read receipts"][i]} />}
                className="py-3.5"
              />
            ))}
          </ListGroup>
          <div className="flex flex-wrap gap-6">
            <Checkbox label="I'm 18 or older" defaultChecked />
            <Radio name="r" label="Option A" defaultChecked />
            <Radio name="r" label="Option B" />
            <Switch compact checked={switches.a} onCheckedChange={(v) => setSwitches((s) => ({ ...s, a: v }))} aria-label="Compact switch" />
          </div>
        </Section>

        <Section id="badges" title="Badges & tags">
          <div className="flex flex-wrap items-center gap-3">
            <CounterBadge count={4} />
            <CounterBadge count={12} />
            <CounterBadge count={120} />
            <CounterBadge compact count={3} />
            <Tag>Question</Tag>
            <PlusTag />
            <PlusTag size="xs" />
            <Tag variant="premium" size="sm">Premium</Tag>
            <PlusHeroTag />
            <StatusBadge tone="success">Verified</StatusBadge>
            <StatusBadge tone="neutral">Pending</StatusBadge>
            <StatusBadge tone="aqua">On</StatusBadge>
            <StatusBadge tone="danger">Rejected</StatusBadge>
            <Tag variant="onPhoto" size="md">Main photo</Tag>
          </div>
        </Section>

        <Section id="avatars" title="Avatars" note="Plain 40–64, ringed new-match avatars, profile avatar with completion ring.">
          <div className="flex flex-wrap items-end gap-4">
            {([40, 44, 48, 52, 56, 64] as const).map((s) => (
              <Avatar key={s} size={s} name={first.name} photo={first.photos[0]} />
            ))}
            <Avatar size={56} name="Hassan" photo={cards[1]!.photos[0]} ring />
            <Avatar size={64} name="Zara" photo={cards[8]!.photos[0]} ring />
            <ProfileAvatar name="Ismail" photo={cards[5]!.photos[0]} completion={75} />
            <ProfileAvatar name="Aishath" photo={first.photos[0]} verified size={88} />
          </div>
        </Section>

        <Section id="surfaces" title="Surfaces & lists">
          <div className="grid gap-4 md:grid-cols-2">
            <Card elevated className="flex flex-col gap-2.5">
              <div className="text-caption font-semibold text-text-secondary">My perfect weekend...</div>
              <div className="text-prompt">A ferry to a quiet island, a book, and no signal until Sunday evening.</div>
            </Card>
            <OceanCard>
              <div className="text-caption font-semibold text-aqua">My ideal first date...</div>
              <div className="text-prompt text-on-ocean">Somewhere with a view of the water and nowhere to be after.</div>
            </OceanCard>
            <ListGroup>
              <ListRow height={60} label="My Likes" meta="0" />
              <ListRow height={60} label="My Matches" meta="3" />
              <ListRow height={60} label="Membership" meta="Free" />
              <ListRow height={60} label="Delete account" tone="danger" chevron={false} />
            </ListGroup>
            <div className="flex flex-col gap-3">
              <SectionLabel>Section label</SectionLabel>
              <Surface className="flex flex-col gap-1.5">
                <div className="text-micro text-text-secondary">The quickest way to win me over...</div>
                <div className="text-body font-semibold">Bring good hedhikaa and a strong opinion about football.</div>
              </Surface>
              <Divider />
              <Callout>{"Thundi is 18+ only. Your age is shown, your birthday isn't."}</Callout>
              <Callout tone="ocean" icon={<ShieldIcon size={26} />}>You control exactly who sees you. Your phone number, email and exact location are never shown to anyone.</Callout>
              <Callout tone="warning" icon={<LockIcon size={18} />}>Development pricing — not production pricing.</Callout>
              <Callout tone="danger">You must be 18 or older to use Thundi.</Callout>
            </div>
          </div>
        </Section>

        <Section id="tabs" title="Tabs & progress">
          <div className="grid gap-4 md:grid-cols-2">
            <SegmentedControl label="Likes" value={segment} onChange={setSegment} items={[{ value: "you", label: "Likes You" }, { value: "matches", label: "Matches" }]} />
            <PillTabs label="Community" value={pill} onChange={setPill} items={[{ value: "foryou", label: "For You" }, { value: "following", label: "Following" }, { value: "new", label: "New" }]} />
            <div className="flex items-center gap-3.5">
              <ProgressBar value={4} max={12} label="Onboarding progress" />
              <StepCounter step={4} total={12} />
            </div>
          </div>
        </Section>

        <Section id="states" title="States" note="Loading, empty, error, offline, success — in Thundi's language.">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative h-72"><SkeletonCard /></div>
            <div className="flex flex-col gap-2"><SkeletonRow /><SkeletonRow /><SkeletonText lines={3} className="px-1.5" /><div className="grid grid-cols-2 gap-3"><SkeletonTile /><SkeletonTile /></div></div>
            <div className="flex flex-col gap-4"><OfflineBanner /><div className="flex justify-center py-4"><SuccessMark /></div></div>
            <Card padding="none"><EmptyState icon={<HeartIcon />} title="Your next match could be one swipe away." actions={<Button size="md">Start swiping</Button>} /></Card>
            <Card padding="none"><ErrorState onRetry={() => toast.show("Retrying…")} /></Card>
            <Card padding="none">
              <EmptyState
                icon={<HeartIcon />}
                title="You've used today's 30 likes."
                description="More available in 4h 12m."
                actions={<><Button variant="plus" size="md">Get Thundi Plus</Button><Button variant="ghost" size="md">Maybe later</Button></>}
              />
            </Card>
          </div>
        </Section>

        <Section id="dialogs" title="Dialogs & toasts" note="One system on <dialog>: bottom sheets on phones, modals on desktop; safe-area padded.">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="md" onClick={() => setSheet(true)}>Bottom sheet</Button>
            <Button variant="secondary" size="md" onClick={() => setModal(true)}>Modal</Button>
            <Button variant="secondary" size="md" onClick={() => setConfirm(true)}>Confirmation</Button>
            <Button variant="secondary" size="md" onClick={() => setActions(true)}>Action sheet</Button>
            <Button variant="secondary" size="md" onClick={() => toast.show("Profile saved")}>Toast</Button>
            <Button variant="secondary" size="md" onClick={() => toast.show("Welcome to Thundi Plus", { tone: "success" })}>Success toast</Button>
          </div>
          <BottomSheet open={sheet} onClose={() => setSheet(false)} labelledBy="ds-sheet-title">
            <div className="flex items-center justify-between"><DialogTitle id="ds-sheet-title">Filters</DialogTitle><Button variant="ghost" size="sm" className="text-primary-ink" onClick={() => setSheet(false)}>Reset</Button></div>
            <div className="flex flex-col gap-2.5"><div className="text-body font-semibold">Show me</div><div className="flex gap-2">{["Women", "Men", "Everyone"].map((g, i) => <Chip key={g} selected={i === 0} className="flex-1 justify-center rounded-md">{g}</Chip>)}</div></div>
            <Button onClick={() => setSheet(false)} className="text-cta-lg">Apply</Button>
          </BottomSheet>
          <Modal open={modal} onClose={() => setModal(false)} labelledBy="ds-modal-title">
            <DialogTitle id="ds-modal-title">Turn on Invisible Mode?</DialogTitle>
            <DialogDescription>Only people you like will be able to discover your profile.</DialogDescription>
            <Button onClick={() => setModal(false)}>Enable Invisible Mode</Button>
            <Button variant="ghost" size="md" onClick={() => setModal(false)}>Cancel</Button>
          </Modal>
          <ConfirmationDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); toast.show("Unmatched."); }} title="Unmatch Aishath?" description="You won't be able to message each other. This can't be undone." confirmLabel="Unmatch" confirmVariant="destructive" />
          <ActionSheet open={actions} onClose={() => setActions(false)} label="Profile options" items={[{ label: "Report", onSelect: () => setActions(false) }, { label: "Block", onSelect: () => setActions(false) }, { label: "Unmatch", tone: "danger", onSelect: () => setActions(false) }]} />
        </Section>

        <Section id="plus" title="Plus visual language" note="Ocean + turquoise with a restrained sand accent. Not gold. Communicates capability and privacy.">
          <div className="grid gap-4 md:grid-cols-2">
            <OceanCard premium>
              <PlusHeroTag className="self-start" />
              <div className="text-h2 text-on-ocean">{"More of what matters. Nothing you don't need."}</div>
              <p className="text-body-sm text-on-ocean-muted">Dating on Thundi stays free. Plus adds a few quiet advantages.</p>
            </OceanCard>
            <div className="flex flex-col gap-3">
              <OceanCard className="gap-2">
                <div className="flex items-center gap-2 text-body-lg font-extrabold text-on-ocean"><EyeOffIcon size={20} className="text-aqua" /> Invisible Mode</div>
                <p className="text-body-sm text-on-ocean-muted">Only people you like can discover your profile. Existing matches and chats stay available.</p>
                <Button variant="plus" size="md" onClick={() => setPlusSheet(true)}>Enable Invisible Mode</Button>
              </OceanCard>
              <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface px-4.5 py-3.5">
                <span className="grid size-9 place-items-center rounded-sm bg-surface-muted text-ocean"><LockIcon size={18} /></span>
                <div className="flex-1"><div className="text-body font-bold">Chat without waiting</div><div className="text-caption-sm text-text-secondary">No 9-minute message cooldown.</div></div>
                <PlusTag />
              </div>
              <Button variant="plus" className="text-cta-lg">Continue with Plus</Button>
            </div>
          </div>
          <BottomSheet open={plusSheet} onClose={() => setPlusSheet(false)} labelledBy="ds-plus-title">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-aqua-soft text-on-aqua-soft"><EyeOffIcon size={22} /></span>
              <div className="flex-1"><DialogTitle id="ds-plus-title" className="text-prompt font-extrabold">Invisible Mode</DialogTitle><p className="text-caption text-text-secondary">Choose who can see you.</p></div>
              <PlusTag />
            </div>
            <ul className="flex flex-col gap-2 text-body-sm">
              {["More control over who sees you", "Stay hidden from people you haven’t liked", "Fewer unwanted likes", "Existing matches and chats stay available"].map((b) => (
                <li key={b} className="flex items-center gap-2.5"><span className="grid size-6 place-items-center rounded-full bg-aqua-soft text-on-aqua-soft"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>{b}</li>
              ))}
            </ul>
            <Button variant="plus" onClick={() => setPlusSheet(false)}>Get Thundi Plus</Button>
            <Button variant="ghost" size="md" onClick={() => setPlusSheet(false)}>Maybe later</Button>
          </BottomSheet>
        </Section>

        <Section id="card" title="Profile card" note="Deck card at 3:4 and grid tile variant.">
          <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
            <ProfileCard profile={first} className="aspect-[3/4]" likeOpacity={0} showPlaceholderLabel />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cards.slice(1, 4).map((c) => <ProfileCard key={c.id} profile={c} variant="tile" className="aspect-[3/4]" />)}
              <ProfileCard profile={cards[4]!} className="aspect-[3/4] rounded-3xl" likeOpacity={1} />
              <ProfileCard profile={cards[5]!} className="aspect-[3/4] rounded-3xl" passOpacity={1} />
            </div>
          </div>
        </Section>

        <Section id="deck" title="Swipe deck" note="Drag, rotation, stamps, stacked next card, spring back, keyboard (←, →, ↑) and buttons. Preview only.">
          <div className="relative mx-auto h-[640px] w-full max-w-[var(--deck-max)]">
            <ShowcaseDeck cards={cards} />
          </div>
        </Section>
      </div>
    </div>
  );
}

/** Fixture-driven deck for the showcase: local state only, no server round-trips. */
function ShowcaseDeck({ cards }: { cards: CardProfile[] }) {
  const toast = useToast();
  const [deck, setDeck] = useState(cards);
  const advance = () => setDeck((d) => d.slice(1));
  return (
    <SwipeDeck
      profiles={deck}
      showPlaceholderLabels
      onLike={(p) => { toast.show(`Liked ${p.name}`); advance(); }}
      onPass={advance}
      onOpen={(p) => toast.show(`Open ${p.name}`)}
      onIntro={(p) => toast.show(`Intro to ${p.name}`)}
      empty={
        <EmptyState
          framed
          className="h-full"
          icon={<WavesIcon strokeWidth={2} />}
          title="That's everyone for now."
          description="Check back later or adjust your preferences."
          actions={<Button size="md" onClick={() => setDeck(cards)}>Reset demo deck</Button>}
        />
      }
    />
  );
}
