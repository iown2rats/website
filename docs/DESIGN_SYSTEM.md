# Thundi Design System (Phase 4)

Extracted from `prototype/Thundi.dc.html` by re-inspecting the inline styles (counts below are occurrences in the source, so the most common values are the system; outliers are one-off screen decisions). Implemented in `src/styles/tokens.css`, `src/app/globals.css` (Tailwind v4 `@theme`) and `src/components/ui/*`.

Principles: white and neutral space carry the interface; turquoise is an accent for actions and selection; deep ocean is used for dark cards, the match screen, toasts and the Plus treatment; radii are large and consistent; shadows are soft and tinted with ocean, never grey; density is native-app compact on 375–430 px screens.

## 1. Typography

Font: **Plus Jakarta Sans** (confirmed: the prototype loads weights 400/500/600/700/800 from Google Fonts). Self-hosted via `next/font/local` from the variable-font subsets embedded in the standalone build (`src/fonts/*.woff2`, latin / latin-ext / vietnamese / cyrillic-ext, OFL). Fallback `system-ui, sans-serif`. `-webkit-font-smoothing: antialiased`.

Weights used: 600 (62×), 700 (60×), 800 (47×), 500 (1×), 400 (body default). Rule: body text 400, labels/meta/nav 600, buttons/names/list titles 700, headings/display/badges 800.

Scale (px sizes by frequency: 15 ×47, 14 ×40, 13 ×29, 12 ×29, 16 ×25, 11 ×14, 22 ×12):

| Token | Size / weight / tracking / line-height | Prototype use |
| --- | --- | --- |
| `display` | 34 / 800 / −0.03em / 1 | "It's a Match" |
| `hero` | 32 / 800 / −0.03em / 1.08 | Welcome heading |
| `name-lg` | 30 / 800 / −0.025em / 1 | Full-profile name |
| `name` | 28 / 800 / −0.02em / 1 | Deck card name |
| `h1` | 26 / 800 / −0.025em | Tab screen titles (Likes, Chats, Community, Profile) |
| `h2` | 24 / 800 / −0.025em / 1.15 | Onboarding step titles, Plus hero |
| `h3` | 22 / 800 / −0.02em | Sheet titles, wordmark, empty-deck title, profile name |
| `h4` | 20 / 800 / −0.02em | Empty-state titles, plan price |
| `prompt` | 19 / 700 / −0.015em / 1.35 | Prompt answers, intro title, page-overlay title (800) |
| `input-lg` | 18 / 700 | Phone and name inputs |
| `cta-lg` | 17 / 700 | Large CTAs ("Get started", "Apply") |
| `body-lg` | 16 / 400 / 1.5 | Bio, post text, list names (700) |
| `body` | 15 / 400 / 1.5 | Default body, bubbles (1.45), list rows (600) |
| `body-sm` | 14 / 400 / 1.5 | Subtitles, chips (600), buttons secondary (700) |
| `caption` | 13 / 400 / 1.5 | Notes, meta, row meta (600) |
| `caption-sm` | 12.5 / 400 | Card sub-lines, toggle descriptions, interest chips on card (700) |
| `label` | 12 / 700 / +0.08em / uppercase | Section labels ("ABOUT ME", "NEW MATCHES") |
| `micro` | 12 / 600 | Nav labels, step counter, timestamps in lists |
| `tiny` | 11 / 400 | Message timestamps, plan "per month" |
| `tag` | 10–11 / 800 / +0.04–0.06em / uppercase | QUESTION, PREMIUM, PLUS tags; 8.5 px on the intro button badge |
| `placeholder-label` | 11 / 600 / +0.14em / uppercase | "PHOTO" placeholders (dev only) |

Long copy uses line-height 1.5 (24×) or 1.55 (5×); headings use `text-wrap: pretty`.

## 2. Colour tokens

| Token | Light | Dark | Notes |
| --- | --- | --- | --- |
| `--color-background` | `#FCFDFC` | `#0B1518` | app background |
| `--color-surface` | `#FFFFFF` | `#132329` | cards, sheets, inputs |
| `--color-surface-muted` | `#F5F7F5` | `#101D21` | inset fields, segmented track, keypad, subtle fills |
| `--color-text` | `#101719` | `#F2F7F6` | primary text |
| `--color-text-secondary` | `#667477` | `#8FA3A6` | subtitles, inactive nav, meta |
| `--color-text-muted` | `#667477` @ 70 % | `#8FA3A6` @ 70 % | placeholder text, tertiary meta (new, derived) |
| `--color-border` | `#DFEBE9` | `#1F343B` | 1 px / 1.5 px borders, tracks, toggle off |
| `--color-primary` | `#18C7C8` | same | lagoon turquoise: CTAs, Like, selection, my bubbles |
| `--color-primary-hover` | `#14B8B9` | same | derived (−6 % lightness) |
| `--color-primary-pressed` | `#079A9F` | same | prototype `--primary-dark`; also links and secondary teal text |
| `--color-on-primary` | `#063B4C` | same | text on turquoise (prototype uses ocean, never white) |
| `--color-ocean` | `#063B4C` | same | deep ocean: dark cards, match screen, toasts, FAB, Plus CTA |
| `--color-aqua` | `#8BE3DE` | same | ripple rings, icon accent on ocean, prompt label on ocean |
| `--color-aqua-soft` | `#E6F7F6` | `#12333A` | selected fills, callouts, their bubbles, empty-state discs |
| `--color-on-aqua-soft` | `#063B4C` | `#8BE3DE` | **new**: fixes the prototype's dark-mode contrast bug (ocean text on dark aqua-soft) |
| `--color-success` | `#20B87A` | same | prototype `--green` |
| `--color-warning` | `#D9A441` | same | new; sand-adjacent amber |
| `--color-danger` | `#C0392B` | same | Unmatch, Delete account, under-18 message |
| `--color-sand` | `#D9C7A3` | same | Plus accent, used sparingly: tags, "Unlock" button, CTA text on ocean |
| `--color-glass` | `rgba(255,255,255,.78)` | `rgba(19,35,41,.82)` | bottom nav, chat header (with blur 20 px / 16 px) |
| `--color-scrim` | `rgba(6,59,76,.4)` | same | sheet backdrop (+ blur 4 px) |
| `--color-photo-scrim` | `rgba(6,20,26,.78)` | same | card/hero bottom gradient end (0 → .72–.8) |

Gradients (the only ones allowed): Like button `linear-gradient(160deg, #18C7C8, #079A9F)`; photo scrim `linear-gradient(180deg, rgba(6,20,26,0), rgba(6,20,26,.78))`; welcome lagoon `linear-gradient(180deg, hsl(186 60% 78%), hsl(190 62% 52%) 45%, #063B4C)`; demo photo placeholders `linear-gradient(160deg, hsl(h 45% 74%), hsl(h 55% 42%))`.

## 3. Radius

Occurrences: 50 % ×46, 16 ×38, 24 ×19, 14 ×17, 18 ×11, 999 ×11, 20 ×10, 22 ×8, 12 ×7.

| Token | px | Use |
| --- | --- | --- |
| `--radius-xs` | 8 | tags, small tiles |
| `--radius-sm` | 12 | small icon buttons, inline actions |
| `--radius-md` | 14 | icon buttons 44, segments, keypad, OTP boxes |
| `--radius-lg` | 16 | buttons, inputs, radio cards, nav items |
| `--radius-xl` | 18 | photo tiles, textareas, callouts, search |
| `--radius-2xl` | 20 | list groups, bubbles, prompt cards |
| `--radius-3xl` | 24 | cards, post cards, ocean cards, grid tiles |
| `--radius-card` | 26 | deck card, sheet top corners |
| `--radius-nav` | 32 | bottom nav |
| `--radius-full` | 999 | pills, avatars, round buttons |

## 4. Spacing

Gaps by frequency: 10 ×32, 8 ×28, 14 ×20, 12 ×17, 6 ×16. Paddings: `0 16px` ×16, `0 18px` ×14, `16px 18px` ×8, `14px 18px` ×4, `20px`/`22px` for ocean cards.

- Page gutter 16 px. Card padding 18 px (post cards), 20–22 px (ocean/plan cards), rows `0 18px`.
- Section gap 20 px; card gap 14 px; list gap 10–12 px; chip gap 8 px; icon–text gap 6–8 px; avatar–text gap 12–14 px.
- Tailwind's 4 px scale covers these (`gap-2.5` = 10, `px-4.5` = 18 via `--spacing`).

## 5. Sizing

Heights by frequency: 44 ×23, 52 ×23, 48 ×18, 40 ×11, 56 ×10, 38 ×6, 54 ×5, 50 ×4.

| Element | Size |
| --- | --- |
| Primary button / input / radio card | 52 |
| Secondary button, keypad key, search field | 48 |
| Icon button, composer input, header controls | 44 (radius 14) |
| Small button, chip | 40 |
| Pill tab, inline action | 38 |
| Small icon button | 36 (radius 12) |
| List row | 54–60 (settings 54, profile 60, suggestions 56) |
| Toggle | 52 × 32, knob 26, inset 3, travel 20; compact 44 × 26 |
| Badge pill | 20 (nav 16), 11 px / 800 |
| Round actions | Pass 56, Like 66, Intro/View 48; full-profile Pass 60, Intro 56 |
| FAB | 54 |
| Avatars | 40, 44, 48, 52, 56 (ringed 2.5 px + 2 px pad), 64 (ringed 2.5 px + 3 px pad); profile ring 104 (r 49, stroke 4) |
| Icons (stroke 2–2.4, round caps) | 14, 16, 18, 20, 22 (nav), 24, 30 (Like/empty state), 36, 40 |
| Screen header | 48 (tab screens), 56 + safe-top (pages, conversation) |
| Bottom nav | 64 tall, radius 32, inset 16 px sides, 10 px + safe-bottom, max-width 480; items 48 × ≥56, radius 16 |
| Sidebar (desktop) | 232 wide, padding 28 px 18 px, rows 48 |
| Right aside (desktop) | 300 wide |
| Content max widths | main 640, deck 500, onboarding 520, sheet 560, settings desktop 900, chat list 360, profile buttons 380 |

## 6. Elevation

- `--shadow-sm` `0 8px 30px rgba(6,59,76,.08)` (dark `0 8px 30px rgba(0,0,0,.35)`): cards, round buttons, next card.
- `--shadow-lg` `0 20px 60px rgba(6,59,76,.16)` (dark `0 20px 60px rgba(0,0,0,.5)`): top card, bottom nav, FAB, toast, match cards.
- `--shadow-like` `0 12px 30px rgba(24,199,200,.4)`: Like button only.
- `--shadow-knob` `0 1px 4px rgba(0,0,0,.2)`: toggle knob.
- Borders do most of the separation work: `1px solid border` on cards and rows, `1.5px` on selectable cards/chips, `2.5px primary` ring on new-match avatars, `3px white` on match cards.

## 7. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out-soft` | `cubic-bezier(.2,.8,.2,1)` | cards, sheets, progress |
| press | `transform .12s` → `scale(.97)` buttons, `scale(.92)` round buttons | all buttons |
| toggle | `background .2s`, `left .2s` | switches |
| hover rows | `background .15s` | list rows |
| `fade-in` | 8 px rise, `.2–.3s ease` | screens, overlays, step content |
| `sheet-in` | 40 px rise with 4 px overshoot, `.45s ease-out-soft` | bottom sheets |
| `pop-in` | scale .85 → 1.03 → 1, `.3–.5s` | toast, match cards |
| `ripple` | scale .6 → 2.2, fade, 2.4–3 s infinite | done step, match screen |
| card drag | no transition while dragging; release `.32s ease-out-soft`; rotate `dx/18deg`; vertical damped ×.5; exit 600 px in 320 ms; next card `scale(.95 → 1)` over 150 px; stamps opacity `dx/90` | deck |
| progress | `width .35s ease-out-soft`; ring `stroke-dasharray .6s` | onboarding, completion |

`prefers-reduced-motion: reduce` disables ripple, shortens all durations to 1 ms, and replaces the card exit with an instant swap.

## 8. Layering

`z-index`: content 1, FAB 5, bottom nav 20, page overlays / full profile 30, filters & compose sheets 35, match 40, intro sheet 45, report sheet 50, toast 60. Dialogs use the top layer (`<dialog>`), toasts sit above them.

## 9. Layout model

- App frame `position: fixed; inset: 0; overflow: hidden`; every screen scrolls internally.
- Breakpoint `desktop` = 900 px (prototype `innerWidth >= 900`). Below: single column, floating bottom nav, content `padding: calc(6px + safe-top) 16px 0`, scroll areas reserve `96–100px` bottom for the nav. At or above: sidebar 232 + main (max 640, centred) + optional aside 300; no bottom nav; conversation becomes two-pane (list 360).
- Safe areas: `env(safe-area-inset-*)` on every fixed edge; `viewport-fit=cover`.

## 10. Component inventory → files

`src/components/ui/`: `button` (Button, IconButton), `field` (Input, Textarea, Select, Field), `choice` (Checkbox, Radio, RadioCard, Switch), `badge` (Badge/Tag, CounterBadge, PlusTag), `avatar` (Avatar, ProfileAvatar, CompletionRing), `surface` (Card, Surface, OceanCard, Divider, ListGroup, ListRow), `progress` (ProgressBar), `skeleton`, `states` (EmptyState, ErrorState, OfflineBanner), `alert` (Callout), `toast` (ToastProvider, useToast), `dialog` (Modal, BottomSheet, ConfirmationDialog, ResponsiveDialog), `tabs` (PillTabs, SegmentedControl), `icons`.

`src/components/layout/`: `app-shell`, `bottom-nav`, `sidebar`, `right-aside`, `screen-header`, `page` (AppPage, ScrollArea, StickyHeader, PageOverlayFrame, SettingsPageFrame, DiscoveryFrame, ModalContent).

`src/components/features/discovery/`: `profile-card`, `swipe-deck`, `swipe-controls`, `photo` (demo gradient placeholder / real image).

Development showcase: `/dev/design-system` (404 in production).

## 11. Phase 4 verification (2026-09-17)

Method: `scripts/screenshots.mjs` against the dev server at 375×812, 390×844, 430×932, 834×1112 and 1280×820 (light and dark), composited side by side with the prototype renders in `docs/prototype-reference/`, plus scripted interaction checks (mouse drag, touch drag via CDP, keyboard, reduced motion, dialogs, focus, touch-target audit).

Results:

- Discover, Likes, Chats, Community, Profile, Welcome and the desktop three-column Discover match the prototype's geometry: header 48 px, card radius 26 with 3 px photo bars, name 28/800 with 20 px seal, 30 px intent pill, 28 px interest chips, controls 56/66/48, bottom nav 64 px glass with 16 px badges, sidebar 232, aside 300, profile ring 104 with the ocean "75% complete" pill, list rows 56/60.
- No horizontal overflow at any width; no unlabelled controls; no interactive target under 40 px (all hit areas are 44 px or larger).
- Drag: `translate(80px, -12px) rotate(4.4deg)` after an 80 px pointer move, LIKE stamp at 0.88 opacity, commit past 110 px, spring-back below it; identical for mouse and touch. Keyboard ← / → / ↑ work when the card is focused. With `prefers-reduced-motion: reduce` the commit is instant.
- Dialogs open in the top layer with focus inside, close on Escape and on backdrop tap; bottom sheets pad `16px + safe-bottom`; the same component renders as a centred modal at ≥ 900 px.
- Dark mode reproduces the prototype palette and fixes its aqua-soft contrast bug through `--on-aqua-soft`.

Defects found and fixed during verification: the deck's top card collapsed because `relative` overrode `absolute` (now a `fill` prop); `IconButton` lost its size when a caller passed `style` (styles now merge); the desktop Discover page lacked the right panel (now provided through `AsideSlot`).

Tooling note: Next 16 blocks dev resources, including the HMR socket, for origins other than the one the dev server is bound to, so pages opened via `127.0.0.1` never hydrate in development. Use `http://localhost:<port>` for browser checks (the production build hydrates on any host).

Intentionally deferred to later phases: real photos (signed URLs), Likes You grids, conversation list and composer, community posts, full-profile overlay, filters sheet content, onboarding steps, Plus screen and plan selection.

## 12. Phase 5 verification (2026-09-17): authentication and onboarding

Method: Playwright against the dev server (`http://localhost:3100`) driving the complete journey at 375×812, then every auth and onboarding screen at 375×812, 390×844, 430×932 and 1280×820 in light and dark, plus scripted checks of the guards and error paths (60 assertions, all passing on the final run). Uploads used generated 1200×1600 JPEGs, a 200×200 PNG and an HTML file renamed `.jpg`.

Results:

- Step chrome matches the prototype: 44 px bordered back button (hidden on the first stage), 4 px progress bar, "n / 12" counter, 24/800 titles, 14 px secondary subtitles, 52 px inputs and radio cards, 52 px primary CTA; the same 520 px column is centred on desktop.
- Phone: fixed 🇲🇻 +960 chip, 7-digit input formatted "7XX XXXX", numeric keyboard, Continue enabled at 7 digits; an invalid number shows "Enter a Maldivian mobile number: 7 digits starting with 7 or 9." and the message clears as soon as the user types again.
- Code: six 52 px boxes mirror one real input (`inputmode=numeric`, `autocomplete=one-time-code`, paste and backspace work, auto-submits at six digits); "Code sent to +960 … Resend in 45s" counts down from server time; the development-only echo banner is aqua-soft. Wrong code → "That code isn't correct. Try again." with the boxes cleared, "2 attempts left" near the limit; expired → "Your code has expired. Request a new one."; locked → "Too many attempts. Request a new code."; both replace the CTA with "Request a new code", which returns to the phone screen with the number prefilled.
- Birthday: the year list starts at the current year − 18; a live "You're N. That's what people will see." or "You must be 18 or older to use Thundi." line; the CTA stays disabled under 18 and a forged submission is refused by the server with the same sentence and nothing stored.
- Photos: 3-column 3:4 tiles, dashed empty tiles ("Main photo" / "Add photo" / +), per-tile progress, error tiles with the server's reason and "Tap to retry", ✕ remove, hover/focus move buttons and drag to reorder, "Add N more photos" CTA until two are present.
- About, Privacy and Done follow the prototype copy; the privacy card tells the truth about the web (see CONTACT_BLOCKING.md §7) and shows Invisible Mode as a Plus item.
- Dark mode uses the same tokens throughout; nothing overflows horizontally at any width.

Defects found and fixed during verification: uploaded tiles were captured before decode (script timing, not a bug); the "Main photo" tag rendered uppercase and collided with the remove button (now the prototype's white sentence-case pill at the bottom-left); a non-image error tile showed a broken preview icon (hidden on error); repeating the same wrong code left the boxes filled because the error text was unchanged (clear on every rejected submission); an expired or locked code bounced to the phone screen because the challenge cookie was cleared (cookie now outlives the challenge and the screen renders the "request a new code" state); the About textarea and the Privacy card/list were squeezed at 375 px because the forms allowed their children to shrink (`min-h-0` removed); the birthday selects blanked after a server rejection while the stale error stayed (manual action dispatch avoids React's form reset; errors dismiss on edit); the hidden back button on the first stage was faintly visible (spacer instead of a disabled button).

Intentional differences from the prototype (documented for the owner):

- The on-screen numeric keypad on the code step is replaced by the device keyboard. The prototype's keypad was a mock; the native keyboard gives autofill, paste and accessibility for free.
- On long steps (About, Privacy) the Continue button scrolls with the content instead of being pinned, so the whole form stays reachable on small screens. Short steps keep it at the bottom.
- The "Main photo" pill sits at the bottom-left of the tile instead of the top-left so it never overlaps the remove button at 375 px.
- The privacy step's free "Only people I like" option is presented as the Plus-only Invisible Mode; the contact-blocking button records the preference and explains what the web can do instead of faking an address-book import.

## 13. Phase 6 verification (2026-09-17): Discover, likes, passes, matching

Method: Playwright against the dev server with the seeded discovery scenarios (21 profiles around the demo viewer, each exercising one rule) at 375×812, then the deck, filters sheet, full profile and match screen at 390×844, 430×932 and 1280×820, light and dark. 44 scripted assertions, all passing on the final run.

Results:

- Deck geometry unchanged from Phase 4 (radius 26 card, 3 px photo bars, LIKE/PASS stamps, 56/66/48 controls); the header gains a 44 px allowance pill ("28 likes left", or "Likes back in 22h 59m" when exhausted) beside the Filters button.
- Drag right past 110 px likes, drag left passes, ← / → / ↑ work from the focused card, taps on the left/right 30 % step through photos, the centre tap and the View profile button open the full profile. The next card is rendered from the 400 px thumb; only the current card loads a full-size image.
- Full profile follows the prototype: hero photo min(70vh, 560px) with white round Back button, 30/800 name + seal, ABOUT ME, aqua "Looking for" pill, prompt card, second photo, info rows, 38 px interest chips, ocean second-prompt card, remaining photos, floating Pass 60 / Like 66. Hidden location and hidden age are simply absent (the payload does not contain them).
- Filters sheet: 22/800 title + Reset, age sliders with "22–34", Show me segments, Location chips (+ island/atoll select for a specific place), Looking for chips, Premium "Advanced filters" group (locked rows with a lock icon for Free; Height/Education controls for Plus), Apply. Applying persists to the database and reloads the deck.
- Match overlay: ocean panel, two ripple rings, two tilted white-bordered photo cards, "It's a Match", "You and Yumna liked each other.", Say hello → conversation shell, Keep swiping → deck.
- Empty states are distinct: "That's everyone for now." (exhausted), "Your filters are hiding everyone." (over-restrictive), "Couldn't load Discover" with Try again (load failure), and "You've used today's 30 likes." with the real countdown (allowance) as a dialog that leaves the deck browsable.
- Plus: Undo control on the far left restores the passed card on top; a second undo is refused with the server's reason; advanced filter controls unlock. Free never sees the Undo control and the server refuses the action anyway.
- Dark mode uses the same tokens throughout.

Intentional differences from the prototype (documented for the owner):

- "Reset demo deck" (a prototype-only control) is replaced by "Check again", which re-queries the server.
- The Send intro control (Plus) is hidden from the deck and the full profile until intros ship in Phase 7; the Report/Block buttons at the foot of the full profile arrive with Safety in Phase 10.
- The prototype's advanced filter list (Education, Occupation, Interests, Height) is reduced to the two the profile actually stores (Height, Education).
- "Get Thundi Plus" on the like-limit dialog shows "Thundi Plus plans open soon." until the Plus screen ships in Phase 11; nothing pretends to be a purchase.

## 14. Phase 7 verification (2026-09-17): Chats and messaging

Method: Playwright against the dev server with the seeded demo conversations (Aishath, Ibrahim with two unread, Nashfa with one unread) plus fresh matches created for the run, at 375×812, then list and conversation at 390×844, 430×932 and 1280×820 in light and dark. Incoming messages were inserted directly into the local database to exercise polling.

Results:

- Chats list matches the prototype: 26/800 title, surface-muted search, NEW MATCHES 64 px ringed avatars with names, 52 px avatar rows with 16/700 name + seal, secondary preview with "You:" prefix, 12 px time, 20 px primary unread pill; unread rows use a bolder preview. Loading the list never marks anything read.
- Conversation: glass header with 44 px back (phone only), 40 px avatar, name + seal, island line, ··· options; centred "You matched with {name}. Say hello." pill; bubbles at 78 % max width, primary/ocean for me with a 6 px bottom-right corner, aqua-soft for them, 11 px times; 44 px rounded composer with a multiline textarea that grows to four lines, 44 px primary Send. The prototype's "Add photo" button is omitted (no image messaging yet).
- Free cooldown: after a send the composer shows "Next free message in 8:5x. Chat anytime with Thundi Plus." with a Get Thundi Plus text button; Send is disabled and a second Enter keeps the draft in the box; no modal opens. Plus users see no cooldown copy and sent three messages in a row.
- Polling delivered an inserted incoming message within one 4 s interval and marked it read because the conversation was on screen; a long multi-line message with `<b>` tags rendered as text.
- Options sheet (Report / Block / Unmatch in red / Cancel) → report reasons (eight approved categories) → "Submit report and block" → "Thanks for looking out"; Block and Unmatch each ask "Block/Unmatch {name}?" first. A closed conversation is read-only with "This conversation has ended." and no composer; another user's conversation URL is a 404.
- Empty states are distinct: "Match with someone to start a conversation." (never matched), the New matches row with "Say hello to a new match." (matches but no messages), "No active chats." with Keep discovering (everything unmatched or blocked), and a retryable error banner for refresh failures.
- Desktop shows the 360 px list beside the conversation with "Select a conversation" when none is open; the phone bottom nav is hidden on the conversation screen. Dark mode uses the same tokens.

## 15. Phase 8 verification (2026-09-17): Community

Method: Playwright against the dev server with the seeded Community scenarios (own post with comments, questions, a long post, a hidden-location author, a PENDING photo, authors blocked in each direction, a suspended author, a deleted post, a reported post, older posts for paging) at 375×812 as the Free demo user, then 390×844 as the Plus user, 430×932 dark, and 1280×900 light and dark. 66 scripted checks passed, including database assertions after every write.

Results:

- Feed matches the prototype: 26/800 title, 38 px pill tabs (ocean when active), radius-24 cards with 44 px avatar, 15/700 name + seal, 12.5 px "Malé · 2h" meta (time only when the author hides their island), 36 px ··· button, QUESTION tag, 16 px body at 1.5 (long posts render in full), 240 px radius-18 photo, 38 px heart and comment controls with counts. The prototype's Share button is not rendered.
- Paging: first page of 12, then Load more (also triggered by scrolling) completes the feed and ends with "You're all caught up."; New shows the last 24 hours; Following shows "Nothing to follow yet." with the explanation.
- Reactions: the heart toggles optimistically with `aria-pressed`, the count follows, and the database row and counter agree after unlike → like.
- Thread `/community/[postId]`: back header, the card, "n COMMENTS" label, 40 px avatar comment rows with name + seal + time, a 44 px rounded composer pinned to the bottom (bottom nav hidden, like a conversation). A comment appears immediately (dimmed until confirmed), the counter updates, and the author can delete it from ··· → Delete comment.
- Author avatar opens the read-only full profile (no Like/Pass/Message); a hidden-location author shows no Location row; blocked or unavailable profiles read "This profile isn't available."
- ··· on another user's post: Report post / Block {name} / Cancel. Report → eight approved reasons → Submit report → "Thanks for looking out" stating the author has not been blocked, with "Also block {name}" as a separate button. Block asks "Block {name}?" and removes all of their posts at once; after reload they stay hidden and their comments leave threads. Own content shows Delete only, with confirmation.
- Compose: "New post" sheet (modal on desktop) with Text / Photo / Question pills, kind-specific placeholder, "Posting as Malé · Community posts don't create matches", Post disabled until valid; Photo requires a JPEG/PNG/WebP under 8 MB (wrong types rejected before upload), shows a preview and an upload progress bar, and stores a re-encoded WebP marked PENDING. "Posted to Community" toast; the new post appears first with "now".
- States are distinct: "Nothing here yet. / Be the first to post something." (no posts), "Nothing new in the last 24 hours." (New), the Following explanation, "Community couldn't load" with Try again (a failed request; retry recovers), "This post isn't available." with Back to Community (deleted or blocked post URL), inline "Couldn't load more" with retry.
- Desktop: the 640 px main column with no right panel (no empty aside), FAB 24 px from the bottom, compose as a centred modal, the thread and profile overlay inside the column. Dark mode uses the same tokens throughout.

## 16. Phase 9 verification (2026-09-17): Profile, Settings, Privacy & Safety

Method: Playwright against the dev server with the seeded demo user (Free), the Plus demo user and a throwaway account created for the deletion flow, at 375×812, then 390×844 (Plus), 430×932 dark (deletion flow), and 1280×900 light and dark. 57 scripted checks passed, each write confirmed in the database; the demo state touched by the run is restored at the end.

Results:

- Profile tab: 104 px completion ring with the "n% complete" pill, "Ismail, 27" + seal, "Malé · Product Designer", Edit profile / Preview, COMPLETE YOUR PROFILE suggestions linking into the matching Edit section, 60 px rows with live metadata (My Likes and My Matches counts, Membership Free/Plus, Verification status). Log out moved to Settings as in the prototype.
- Edit profile: pill tabs Photos / Info / About / Interests / Prompts, Save in the header ("Profile saved"). Photos: featured 2×2 main tile, upload with progress through the Phase 5 pipeline (stored PENDING, labelled "Under review" for the owner), Make main, remove, and the minimum rule refusing the removal that would leave fewer than 2 photos ("Keep at least 2 photos…"). Info: read-only Name and Date of birth rows (owner-only value), Gender select, Location and Home island pickers, Occupation, Education, Height; an invalid height is refused by the server with the message inline and nothing stored. About/Interests/Prompts save through the onboarding schemas (markup in the bio refused; interests capped at 6).
- Preview renders the owner through the same safe DTO as Discover, with the "This is how others see you" banner and no Like/Pass controls; with Hide age and Hide my location on, the preview drops both while the owner's own Profile still shows them.
- Privacy & Safety: ocean notice, PROFILE VISIBILITY radios (Everyone / Only people I like with Plus tag / Hidden), toggle card (Hide my location, Hide age, Hide active status), Block my contacts card with ON/OFF badge, links (Blocked profiles, Verification, Safety Center), screenshots note. A Free user choosing "Only people I like" gets the Plus explanation with the Community disclosure and nothing is stored; the Plus user enables it, sees the disclosure ("Invisible Mode hides you from Discover. Your Community posts and comments can still be visible to other Community members."), still has the Community composer, and turns it off again. "Hidden" pauses dating: Discover shows "Dating is paused." with a link back to Privacy; "Everyone" resumes. Contact blocking turns on as a setting only; the sheet states the browser cannot read an address book, and two typed numbers were hashed on the device into digests identical to the server's keyed hash.
- Blocked users lists the blocked person with avatar, name and seal and a dated row; Unblock asks first and removes only the Block row.
- Settings: six prototype groups with masked phone (+960 •••• 010), five 44×26 notification toggles (persisted and reverted), Appearance row toggling the Phase 4 theme, Support rows without destinations shown as "Not yet available", Pause dating behind a confirmation (then "Resume dating"), Log out (revokes exactly the current session), Delete account in red. Desktop: 900 px column with the 220 px section nav showing one group at a time and no right aside.
- Delete account: consequences sheet → "Send code" → 6-digit code with the development echo → a wrong code is refused with attempts remaining → the right code anonymises the account, ends the session and returns to the welcome screen; the deleted account can no longer open the app.
- Membership: Free sees the approved perks, plan cards with "Price TBA" and the honest "Plus isn't on sale yet" note; Plus sees "You're on Thundi Plus" with no payment internals. Safety Center accordion cards open with the prototype's guidance and an honest support card (119 kept). Verification shows phone Done, selfie Next and the "coming" note without marking anyone verified. Discovery preferences reuse the Filters sheet and save through the Phase 6 path.
- Dark mode at 430 and 1280 uses the same tokens; every page overlay hides the phone bottom nav and keeps the 640 px column on desktop except Settings and Privacy (900).

## 17. Google-auth migration verification (2026-09-17): sign-in, re-authentication, deleted accounts

Method: Playwright against the dev server with `AUTH_PROVIDER=dev` (the local stand-in for Google's account chooser; identical start/callback code path) at 375×812, 430×932 dark and 1280×900. 27 scripted checks passed, each sign-in or deletion confirmed in the database.

Results:

- Welcome keeps the lagoon hero and offers a single white "Continue with Google" with the G mark; no phone, SMS or code copy anywhere; `/auth/phone` and `/auth/verify` are gone (404); an anonymous request for the app returns to the welcome screen.
- Start: the authorization request carries a random state, a nonce, an S256 PKCE challenge and the exact callback URI; the pending-auth cookie is HttpOnly and signed. A callback with a forged state lands on `/auth/error` ("That sign-in link expired") without account detail.
- Existing demo account (seeded identity `me@demo.thundi.dev`): signs straight into the app on the same `User.id` with profile and counts intact; one identity row, one new session. Settings → Account shows "Google account · email" and "Phone number · Not added" (phones are optional). Verification shows "Get verified" with selfie and review steps only, states that Google sign-in is not identity verification, and the status is NONE. A signed-in visit to the start endpoint goes to the app, not to Google.
- Delete account: step 1 explains the consequences and offers "Continue with Google to confirm"; the re-authentication request preselects the same account (`login_hint`, `prompt=select_account`). Confirming as a different Google account lands on "That's a different Google account" and marks nothing; confirming as the same account marks this session and reopens the sheet at "Confirm deletion" with "Delete my account". Keeping the account leaves it ACTIVE.
- New person: "Use another account" creates an ONBOARDING account with no phone and verification NONE and lands on onboarding step 2 of 11; signing out and back in maps to the same `User.id`.
- Deleted account (430 dark): after Google confirmation the account is DELETED with no phone, sessions gone, the identity kept with its email scrubbed and `releasedAt` set. The same Google account signing in again is told "Your previous Thundi account was deleted" (no session, nothing revived); "Create a new account" creates a new `User.id` in onboarding while the old row stays DELETED and anonymised, with an `account.recreated` audit entry.
- Desktop 1280: welcome, the dev account chooser, Settings with the Google row, and the deletion sheet as a centred modal with the Google step.

