# Mellocrush Design System (Phase 4)

Extracted from `prototype/Thundi.dc.html` by re-inspecting the inline styles (counts below are occurrences in the source, so the most common values are the system; outliers are one-off screen decisions). Implemented in `src/styles/tokens.css`, `src/app/globals.css` (Tailwind v4 `@theme`) and `src/components/ui/*`.

Principles (warm-white glass identity, 2026-09-18): one warm page colour carries the interface; containers are translucent warm-white glass (16 px blur, soft diffuse shadow) with no outlines, and faint dividers separate rows inside one grouped surface; coral is used only for high-emphasis interaction (primary CTAs, selected chips, active nav, toggles, progress, key accents such as the verified seal); gold is reserved for Mellocrush Plus; the text colour is the only dark surface (toasts, status pills). There are no gradients, no teal and no card outlines; radii are large and consistent; shadows are soft and tinted with ocean, never grey; density is native-app compact on 375–430 px screens.

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

Warm-white glass identity (2026-09-18). Values live in `src/styles/tokens.css` and are exposed as Tailwind colours in `src/app/globals.css`; components never use raw hex. Light is the Mellocrush experience and is what every visitor sees regardless of the phone's system setting; dark mode is black with near-black glass and applies only when chosen from the appearance toggle (stored per viewer).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-background` | `#FFFBF1` | `#000000` | the page, everywhere in the member app |
| `--color-surface` (`--glass-strong`) | `rgba(255,251,241,.86)` | `rgba(24,20,18,.86)` | glass cards, grouped lists, sheets, dialogs, key panels (via the `glass-card` utility: blur 16 px + soft shadow, no outline) |
| `--color-glass` | `rgba(255,251,241,.68)` | `rgba(24,20,18,.72)` | floating bottom nav and glass headers (`glass` utility) |
| `--color-surface-muted` | `rgba(59,47,42,.06)` | `rgba(255,251,241,.07)` | quiet warm tint: unselected chips and segments, inputs, secondary buttons, icon buttons, photo placeholders, their bubbles |
| `--color-text` | `#3B2F2A` | `#FFFBF1` | headings, primary text, icons, focus ring |
| `--color-text-secondary` | `#806C67` | `#C9BDB6` | secondary text (4.7:1 on the page) |
| `--color-border` (divider) | `rgba(59,47,42,.08)` | `rgba(255,251,241,.10)` | faint internal dividers between rows of one glass surface; progress and toggle tracks. Never a card outline |
| `--color-primary` | `#FD7979` | `#FD8585` | coral: primary CTAs, selected chips and segments, active toggles, progress, completion ring, Like, my bubbles, counters |
| `--color-primary-hover` / `-pressed` | `#F26A6A` / `#E85F5F` | `#FA7676` / `#F26A6A` | hover and pressed CTA |
| `--color-on-primary` | `#3B2F2A` | `#1A1412` | text and icons on coral (5.0:1; white would be 2.6:1) |
| `--color-primary-soft` | `rgba(253,121,121,.14)` | `rgba(253,121,121,.18)` | selected option or plan card fill |
| `--color-primary-ink` | `#BF4747` | `#FFB0B0` | coral as text (links, "Selected", prompt labels) at AA |
| `--color-accent` (`--color-aqua`) | `#FD7979` | `#FD8585` | small key accents: verified seal, safety icons, Boost countdown, logo detail (same coral; there is no second hue) |
| `--color-aqua-soft` / `--color-on-aqua-soft` | `rgba(59,47,42,.06)` / `#3B2F2A` | `rgba(255,251,241,.07)` / `#FFFBF1` | historic names for the quiet tint used by callouts, icon discs and their bubbles |
| `--color-success` | `#237A4B` | `#7FD39A` | status words (Approved, Match) |
| `--color-warning` | `#A86D17` | `#E6B85C` | warning callouts and tags |
| `--color-danger` | `#B3393F` | `#EE8A8E` | errors and destructive actions only |
| `--color-sand` / `--color-on-sand` | `#C6A962` / `#3B2F2A` | `#E0C27A` / `#1A1412` | Mellocrush Plus gold: Plus tags, plan badges, Premium labels, the Plus hero disc, the active-Plus card icon. Nothing else is gold |
| `--color-ocean` / `--color-on-ocean` | `#3B2F2A` / `#FFFBF1` | `#2A2422` / `#FFFBF1` | historic name for the dark emphasis surface: toasts, status pills, the Admin marker |
| `--color-scrim` | `rgba(59,47,42,.35)` | `rgba(0,0,0,.6)` | dialog backdrop |
| `--color-on-photo*` | white / 85 % / 16 % | same | text and chips over photographs |

Shadows: `--shadow-sm` is the soft diffuse `0 12px 32px rgba(88,59,45,.10)` carried by every glass card; `--shadow-lg` `0 20px 48px rgba(88,59,45,.16)` for the nav and floating controls; the Like shadow is coral. The `like-gradient` utility keeps its name but is the solid coral; the only remaining gradients are the photo scrim and the demo photo placeholders. Component mapping: `Card`, `ListGroup`, `OceanCard`, sheets and dialogs are `glass-card`; `Button` secondary, destructive and bordered icon buttons are the quiet tint with no border; `Field` inputs are the quiet tint with a coral focus outline; `Chip`, `PillTabs` and segment controls are quiet tint → solid coral when selected; option cards are quiet tint → coral tint when selected; `Switch`, `Progress`, the completion ring, `VerifiedBadge` and `ThundiLogo` are coral; `PlusTag`, `PlusHeroTag` and plan badges are gold with dark text.

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
- Birthday: the year list starts at the current year − 18; a live "You're N. That's what people will see." or "You must be 18 or older to use Mellocrush." line; the CTA stays disabled under 18 and a forged submission is refused by the server with the same sentence and nothing stored.
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
- "Get Mellocrush Plus" on the like-limit dialog shows "Mellocrush Plus plans open soon." until the Plus screen ships in Phase 11; nothing pretends to be a purchase.

## 14. Phase 7 verification (2026-09-17): Chats and messaging

Method: Playwright against the dev server with the seeded demo conversations (Aishath, Ibrahim with two unread, Nashfa with one unread) plus fresh matches created for the run, at 375×812, then list and conversation at 390×844, 430×932 and 1280×820 in light and dark. Incoming messages were inserted directly into the local database to exercise polling.

Results:

- Chats list matches the prototype: 26/800 title, surface-muted search, NEW MATCHES 64 px ringed avatars with names, 52 px avatar rows with 16/700 name + seal, secondary preview with "You:" prefix, 12 px time, 20 px primary unread pill; unread rows use a bolder preview. Loading the list never marks anything read.
- Conversation: glass header with 44 px back (phone only), 40 px avatar, name + seal, island line, ··· options; centred "You matched with {name}. Say hello." pill; bubbles at 78 % max width, primary/ocean for me with a 6 px bottom-right corner, aqua-soft for them, 11 px times; 44 px rounded composer with a multiline textarea that grows to four lines, 44 px primary Send. The prototype's "Add photo" button is omitted (no image messaging yet).
- Composer: identical on every tier. Matched messaging is unlimited (docs/ARCHITECTURE.md §12.4), so there is no countdown, no timer-driven disabled Send and no upsell under the composer; Send is enabled whenever there is text and the conversation is open. Free and Plus both send several messages in a row.
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
- Membership: Free sees the approved perks, plan cards with "Price TBA" and the honest "Plus isn't on sale yet" note; Plus sees "You're on Mellocrush Plus" with no payment internals. Safety Center accordion cards open with the prototype's guidance and an honest support card (119 kept). Verification shows phone Done, selfie Next and the "coming" note without marking anyone verified. Discovery preferences reuse the Filters sheet and save through the Phase 6 path.
- Dark mode at 430 and 1280 uses the same tokens; every page overlay hides the phone bottom nav and keeps the 640 px column on desktop except Settings and Privacy (900).

## 17. Google-auth migration verification (2026-09-17): sign-in, re-authentication, deleted accounts

Method: Playwright against the dev server with `AUTH_PROVIDER=dev` (the local stand-in for Google's account chooser; identical start/callback code path) at 375×812, 430×932 dark and 1280×900. 27 scripted checks passed, each sign-in or deletion confirmed in the database.

Results:

- Welcome keeps the lagoon hero and offers a single white "Continue with Google" with the G mark; no phone, SMS or code copy anywhere; `/auth/phone` and `/auth/verify` are gone (404); an anonymous request for the app returns to the welcome screen.
- Start: the authorization request carries a random state, a nonce, an S256 PKCE challenge and the exact callback URI; the pending-auth cookie is HttpOnly and signed. A callback with a forged state lands on `/auth/error` ("That sign-in link expired") without account detail.
- Existing demo account (seeded identity `me@demo.thundi.dev`): signs straight into the app on the same `User.id` with profile and counts intact; one identity row, one new session. Settings → Account shows "Google account · email" and "Phone number · Not added" (phones are optional). Verification shows "Get verified" with selfie and review steps only, states that Google sign-in is not identity verification, and the status is NONE. A signed-in visit to the start endpoint goes to the app, not to Google.
- Delete account: step 1 explains the consequences and offers "Continue with Google to confirm"; the re-authentication request preselects the same account (`login_hint`, `prompt=select_account`). Confirming as a different Google account lands on "That's a different Google account" and marks nothing; confirming as the same account marks this session and reopens the sheet at "Confirm deletion" with "Delete my account". Keeping the account leaves it ACTIVE.
- New person: "Use another account" creates an ONBOARDING account with no phone and verification NONE and lands on onboarding step 2 of 11; signing out and back in maps to the same `User.id`.
- Deleted account (430 dark): after Google confirmation the account is DELETED with no phone, sessions gone, the identity kept with its email scrubbed and `releasedAt` set. The same Google account signing in again is told "Your previous Mellocrush account was deleted" (no session, nothing revived); "Create a new account" creates a new `User.id` in onboarding while the old row stays DELETED and anonymised, with an `account.recreated` audit entry.
- Desktop 1280: welcome, the dev account chooser, Settings with the Google row, and the deletion sheet as a centred modal with the Google step.


## 18. Admin dashboard + Plus purchase verification (2026-09-18)

Method: Playwright against the dev server (`AUTH_PROVIDER=dev`) with three sessions: an admin at 1280×900, the same admin on a 375×812 phone, and a Free customer on a 375×812 phone; then every admin screen at 375, 390 and 430 px. 63 scripted checks passed, each state confirmed in the database. Screenshots in `screenshots/admin/` (gitignored).

Admin visual language (operational, not a dating screen): same tokens and type scale, surfaces with 1 px borders and 16–20 px radii, uppercase 12 px labels, tabular numbers, aqua for the active navigation item, ocean for primary actions, danger outline for suspend/ban/reject. Desktop: 232 px grouped sidebar (Overview, People, Revenue, System) with waiting-count badges, content to 1100 px. Phone: 56 px top bar with section name and a Menu button opening the same navigation as a bottom sheet; lists stack (primary, secondary, badges, timestamp); detail screens use two-column key/value grids that collapse to one column.

Results:

- Non-admin: `/admin` and `/admin/users` return 404 with no admin content for a signed-in Free user.
- Admin: dashboard renders every metric with its definition; plan edit (price 149, "Price approved") makes the plan "for sale"; a bank account added in Payment methods becomes the checkout method; both actions appear in the audit log.
- Customer (375): Membership shows "MVR 149" and "Get Mellocrush Plus"; the order screen shows amount, reference (THU-XXXXXX), account number, holder, bank and instructions, each with a Copy control; "I've made the transfer" opens the receipt sheet; uploading a JPG moves the order to SUBMITTED, stores `payment-receipts/<userId>/<orderId>/receipt.webp` and grants nothing; Membership then shows "Payment under review" and no Plus badge.
- Admin on the phone: the pending queue lists the order; the detail shows the receipt image; Reject opens a reason sheet; Approve opens a confirmation; confirming creates exactly one subscription, one `payment.approved` audit row and one `PAYMENT_APPROVED` notification; the customer's Membership then reads "You're on Mellocrush Plus." with the period end.
- Users: search by id finds the account; detail exposes no phone number or token material; Suspend with a reason sets SUSPENDED, deletes the sessions and audits; Unsuspend restores ACTIVE.
- Subscriptions, Reports, Verifications (empty, with the honest "selfie upload not built yet" note), Audit log and the payment detail all render on desktop.
- 375/390/430: dashboard, users, user detail, payments, payment detail, plans, payment methods, subscriptions, reports, verifications and audit have no horizontal overflow (33 checks); the menu sheet lists every section.

## 19. Receipt OCR verification (2026-09-18)

Method: Playwright against the dev server (`AUTH_PROVIDER=dev`) with the real server-side Tesseract engine reading rendered, sanitised BML/MIB fixture receipts (`tests/fixtures/receipts.ts`): three customers on 375×812 phones, an admin at 1280×900 and the same admin on a phone at 375, 390 and 430 px. 44 scripted checks passed, each state confirmed in the database. Screenshots in `screenshots/ocr/` (gitignored).

Visual language: the check result is a `Callout` whose tone follows the outcome (success for a match, info for partial/unreadable/unrecognised, warning for review, danger for a mismatch) with a fixed title and one summary sentence, then a compact list of checks. Each check is a 20 px round state icon (✓ success, ✕ danger, ⓘ warning for "review", an em dash on muted for "not detected"), the check name in bold, the detected and expected values inline ("Detected MVR 150 · Expected MVR 199") and a one-line explanation in secondary text. Actions live inside the card: ocean "Submit for review" above a muted "Replace slip". While the server reads the receipt the upload sheet shows an aqua-soft "Checking transfer details…" row with the spinner, and the primary button reads "Checking…". The admin panel reuses the same state icon beside a bold label and a state word ("Match", "Review", "Mismatch", "Not detected"), detected/expected in monospace, the admin note in secondary text; the duplicate case adds a warning callout with a link to the other order, and the outcome badge (`StatusPill`) appears in the payments queue as "OCR: match" etc.

Results:

- Customer (375): wrong amount → danger card "Receipt doesn't match this order" naming MVR 150 detected and MVR 199 expected, with Replace slip / Submit for review; an unrelated photo → "This doesn't look like a bank receipt we recognise", still submittable; a cropped MIB slip → "Some transfer details detected" with amount ✓ and recipient not detected; a pending transfer → "needs a closer look", worded as pending, never as failed; the correct BML slip → success card "Transfer details detected" with completed, amount, recipient and payment reference ticks and the reminder that the team still confirms. No transaction number, sender name or raw text appears on any customer screen. Five uploads left five readings and one current file (attempt 5); earlier files were deleted. Membership shows "Receipt attached, not yet submitted" with a "Submit receipt" link; Submit for review moves the order to SUBMITTED and grants nothing.
- Duplicate: a second customer uploading a slip with the same bank transaction number sees "This receipt looks like one that was already submitted. Our team will check." and nothing about the first order.
- Admin (1280): queue badges "OCR: match" / "OCR: review required"; the detail shows the receipt image beside the check panel with bank, status, MVR 199, account, transaction number, date and the Mellocrush reference, attempt 5 with four earlier readings and `bml-v1`; Re-run OCR appended attempt 6, wrote `receipt.reprocessed` and changed nothing; approving a MATCH asks for confirmation only and creates exactly one subscription with `receiptOutcome: MATCH` in the audit row; the duplicate order shows "Possible duplicate transfer" naming the other order and "a different customer", the Approve button opens the reason dialog with the confirm disabled until a reason is typed, and the approval audit row carries `overrideReason` and `receiptOutcome: REVIEW_REQUIRED`.
- 375/390/430: customer order with the mismatch card and the replace-slip sheet, admin queue, admin detail with mismatch indicators and admin detail with the duplicate warning have no horizontal overflow (18 checks).

## 20. Phase 10 verification (2026-09-18): Plus completion and photo verification

Method: Playwright against the dev server (`AUTH_PROVIDER=dev`, local-disk storage) with a Free member, a Plus member, two further members and an admin (1280×900 and a 375×812 phone), then the member and admin screens at 375, 390 and 430 px and desktop 1280. 53 scripted checks passed, each state confirmed in the database. Selfies are rendered fixtures (a drawn face), never a real person. Screenshots in `screenshots/phase10/` (gitignored).

Visual language:

- **Lock state** (`PlusLockSheet`): a bottom sheet (centred modal on desktop) with the feature name as the title, a `PlusTag` "Plus feature", ONE short sentence (a rule, not a guideline — longer copy belongs on Membership, one tap away) and a single primary "Get Mellocrush Plus" link into Membership at the house `lg` height, with a ghost "Not now" beneath it as the dismiss. Counts and prices are never repeated here, so this copy cannot drift from `src/config/product.ts`. The same component is used for Boost, the locked advanced filters, Undo, locked photos and the Likes You teaser; a locked tap always opens it rather than jumping to Membership, and a control that merely opens it is named after the locked feature so two buttons in a row never both read as "upgrade". Enter opens it from a focused control, Escape closes it.
- **Likes You teaser** (Free): the count in the tab ("Likes You (1)"), a grid of blurhash tiles (`BlurhashCanvas`, no photo bytes, no names, no handles in the DOM), then a lock card: lock glyph in an aqua-soft circle, "1 person likes you", "See who likes you", the Plus tag and the upgrade button. Plus sees real `ProfileCard` tiles (name, age, verified badge, location) that open the full profile with Like / Pass; liking back shows the match overlay and the Matches tab lists the conversation with "Say hello".
- **Boost** (Discover header): a bolt `IconButton`; Plus gets a `ConfirmationDialog` "Boost your profile?" with "Boost for 30 minutes" and the weekly allowance; while active the control becomes an ocean pill with the bolt and the minutes left ("27m"), and a toast "Boost on · you're first in Discover for 30 minutes". Free gets the lock sheet.
- **Membership comparison**: a `table` under the section label "Mellocrush Free and Mellocrush Plus", three columns (Feature, Free with a visually hidden "(your plan)", Plus with the `PlusTag`), muted text in the Free column, bold in Plus, em dashes for "not included", derived from `PRODUCT_RULES` so the numbers can never drift from enforcement. When no plan is for sale the plan cards read "Price TBA" and the callout "Plus isn't on sale yet".
- **Verification** (`/settings/verification`): a `VerifiedBadge` glyph in a soft circle, "Get verified", one honest sentence about the team comparing the selfie with the profile photos, a four-row instruction list (check glyphs, bold title, secondary line), an aqua primary "Take a selfie" (camera, `capture="user"`), an outline "Choose from photos", and the privacy line (JPG/PNG/WebP up to 8 MB, private, review team only). After choosing: a 3:4 preview with "Submit for review" and "Choose a different photo". States: "Under review" (info callout with the submission time, the member's own selfie under "Your submitted selfie"), "Not verified this time" (danger callout with the reviewer's reason and the 24-hour retry time, the submit controls hidden until then), and "Photo verified" (success, plus a callout "What the badge means" that says it is about the photos, not identity). Errors are `role=alert`, upload progress `role=status`.
- **Admin** (`/admin/verifications`, `/admin/verifications/[userId]`): the queue lists name, handle, status pill and submission time; the detail puts the decision panel first (Verify in ocean, Reject outline danger, one sentence on what "Photo verified" means), then the selfie beside the profile photos with their moderation state, the submission facts and earlier decisions. Verify opens "Mark as photo verified?"; Reject requires a reason.

Results:

- Free (375): Membership shows the comparison table with 30 vs 90 likes, "Price TBA" on every plan and "Plus isn't on sale yet", no MVR price; Likes You shows the count and the lock card, and the page HTML contains neither the liker's name nor a photo URL; the lock sheet's only action links to Membership; Discover has no Undo control; Boost and the Height filter open the lock sheet.
- Plus (375): Likes You lists the liker by name; liking back creates exactly one ACTIVE match and shows the match screen; Discover shows Undo; the Boost confirmation reads "2 of 2 Boosts"; confirming inserts one Boost row and the header shows the countdown.
- Verification: instructions and both entry points render, with the honest Google line; a PDF is refused with "That file is a PDF, not a photo. Choose a JPEG, PNG or WebP selfie instead."; the preview appears before submitting; submitting stores `verification-selfies/<userId>/<uuid>.webp`, sets UNDER_REVIEW, shows the member their own selfie and grants no Plus. The admin queue lists both submissions; the detail shows the selfie beside the profile photos; Verify asks for confirmation and sets VERIFIED with an audit row and a VERIFICATION_UPDATE notification; Reject with a reason sets REJECTED with an audit row; the queue is then empty. The rejected member sees the reason and the retry time with no submit control; the verified member sees "Photo verified" and the badge (title "Photo verified") on their profile.
- 375/390/430: Membership, Likes, Discover, Verification (instructions and preview with the submit button reachable), admin queue and admin detail have no horizontal overflow (21 checks). Desktop 1280: Membership, Likes, Verification and Discover have no overflow; keyboard Enter opens and Escape closes the lock sheet.
- Fixed during verification: the Discover header wrapped at 375 px while a Boost was active (now a compact minutes pill, no-wrap allowance pill, logo-only wordmark below 390 px during a boost) and toasts no longer truncate (they wrap to two lines).

## 21. Welcome screen redesign (2026-09-18): the night-beach photograph

The unauthenticated welcome screen is now one full-screen photograph — a Maldivian beach at night under the Milky Way, a couple sitting together on the sand — with the wordmark, the single headline "Meet someone closer to home." and Continue with Google. The explanatory paragraphs were removed and not replaced; the photograph does the storytelling. No resort or travel imagery, no tabs, no second headline.

Composition. Phones (`min-height: 100dvh`, safe-area padding top and bottom): wordmark and headline top-left over the dark palm fronds, the Google button at the bottom on the sand, the couple and the Milky Way untouched in between; the photo is `object-fit: cover` at `50% 50%` so the whole frame stays in view on tall phones and only the sides crop. Wide screens (`md+`): everything grouped top-left in a 460 px column at 13 vh / 7 vw with a 44 px headline, the photo positioned at `50% 60%` so the horizon and the couple fill the frame and the Milky Way's tail stays top-right; no extra cards or sections. Scrims are minimal: a 0.5→0 fade over the top 38 % and a 0→0.82 fade over the bottom 30 % on phones, a left-to-right 0.72→0 fade on wide screens; the sky and the water keep their colour.

Button. The existing `ContinueWithGoogle` link, restyled to 56 px tall, 12 px radius, white with the four-colour G mark, full width of the content column; the aqua focus ring is visible on keyboard focus. Nothing else on the screen is interactive.

Delivery (`scripts/render-hero.mjs`, master in `docs/assets/hero/night-beach-master.png`, 941×1672 PNG): static AVIF + WebP at 480, 640, 828 and 941 px wide in `public/hero/`, chosen by the browser with `sizes="100vw"`, preloaded from the server-rendered head with `type="image/avif"` and `fetchpriority="high"`, a 178-byte inline blurred placeholder behind it so nothing shifts. Measured transfers: 375 and 390 px phones at 2× fetch the 828 px AVIF (92.5 KB); 430 px phones and every desktop fetch the 941 px AVIF (110 KB); WebP fallbacks are 59.6 / 96.0 / 136.3 / 162.6 KB. On a 1280 px desktop the 941 px source is scaled up 1.36× by the browser; a wider master would be needed to avoid that.

Verified with Playwright at 375×667, 390×844, 430×932, 768×1024, 1280×800 and 1440×900: no horizontal overflow, page height equals the viewport (no browser-height scroll), the button sits 24 px plus the safe-area inset above the bottom edge, the headline never covers the couple, the Milky Way stays visible, the image renders at its natural aspect ratio (not stretched), the preload tag is present, only one hero request is made per page, and the first Tab lands on Continue with Google with a visible focus ring. Screenshots in `screenshots/welcome/` (gitignored).

## 22. Pastel Rose / Teal identity (2026-09-18)

A visual-system update only: screens, content, navigation and geometry are unchanged. Every colour now comes from the tokens in §2. What changed in components: rose replaces turquoise for CTAs, selection and my bubbles; teal is confined to trust (verified seal, safety icons, privacy card), toggles, progress and the logo detail; gold appears only on Plus; the dark-teal blocks (ocean buttons, pill tabs, the privacy card, the prompt card, the match screen, plan badges, the Plus lock) were replaced with rose, teal-tint or warm surfaces; toasts and status pills are the only dark (plum) surfaces left. Dark mode is black (#000000) with near-black cards (#151113) and the same accents. Verified with Playwright screenshots at 390 px (Discover, Likes, Chats, Community, Profile, Settings, Membership, Privacy & Safety, Verification, Safety Center, full profile, filters, onboarding), 390 px dark (Discover, Profile, Membership, Chats, Privacy) and 1280 px (Discover, Membership, admin dashboard, users, payments). Screenshots in `screenshots/theme/` (gitignored). Contrast: plum on rose 5.1:1, plum on gold 4.95:1, plum on teal 4.7:1, secondary text on surface 4.5:1, rose ink on surface 4.7:1.

## 23. Warm-white glass identity (2026-09-18)

A visual-system update only. Every card, panel, sheet, dialog, bottom nav, filter container, chip, segment and input lost its outline; containers became translucent warm-white glass with a 16 px blur and the soft shadow, controls became the quiet warm tint, and the only lines left are faint dividers between rows inside one grouped surface. Coral replaced rose for CTAs, selection, toggles, progress and small key accents; teal was removed entirely (the verified seal, safety icons and the logo detail are coral); gold stayed on Plus only. Dark mode is black with near-black glass. Verified with Playwright screenshots at 390 px (Discover, Likes, Chats, Community, Profile, Settings, Membership, Privacy & Safety, Verification, Safety Center, full profile, filters sheet, onboarding), 390 px dark and 1280 px (Discover, Membership, admin). Screenshots in `screenshots/theme/` (gitignored). Contrast: text on page 12.6:1, dark text on coral 5.0:1, dark text on gold 5.7:1, secondary text on page 4.7:1, coral ink on page 4.8:1.

## 24. Mellocrush rebrand (2026-09-18)

Branding only: routes, screens, behaviour, styling and data are unchanged. (**The artwork described here is superseded by §34** — the final logo. The naming, metadata and copy decisions below still stand.) The public name is **Mellocrush** (the wordmark is always lowercase `mellocrush`). The canonical artwork lives in `public/brand/`: `mellocrush-logo.png` (the supplied wordmark trimmed to its artwork, 1977×326, cocoa #472B30 lettering, linked coral #E88B86 "oo", gold #C9A04A four-point star), a 480 px rendition for headers, and `mellocrush-mark.png` (the linked "oo" plus star, cut from the same artwork) for icon-only places. `src/components/brand/logo.tsx` renders them: `Wordmark` at a given height with the artwork's own aspect ratio (never recreated with text, never re-kerned) and `BrandMark` for compact slots. The old wave logo component was deleted. Wordmark sites: welcome (on a small warm-white glass tile over the photograph), Discover header (the mark alone below 390 px while a Boost runs), desktop sidebar, admin sidebar, sign-in error and deleted-account pages; the admin phone header uses the mark. Metadata: title "Mellocrush" (template "%s · Mellocrush"), application name, Open Graph and Twitter titles, a web manifest (name and short name Mellocrush, icons on the warm page colour), favicon and Apple touch icon from the mark. Copy: every "Thundi" became "Mellocrush" and "Thundi Plus" became "Mellocrush Plus" in the UI, server messages, tests and docs. Left as they were on purpose because they are identifiers or data, not branding: cookie names, the appearance localStorage key, environment variables, database and bucket names, the hosted Vercel and Supabase project names, demo sign-in addresses, the dev OIDC issuer, and the `THU-` payment reference format.

## 25. Continue with Telegram (2026-09-18)

A second sign-in button under Continue with Google on the welcome screen, and the same button wherever the Google one appeared for a Telegram account (sign-in error, deletion confirmation). Both share one component (`ContinueWith`, `src/components/features/auth/google-button.tsx`): the white sign-in surface, 56 px tall and 12 px radius on the welcome screen, the provider's own mark at 20 px on the left, `text-cta-lg` label. The Telegram mark is the paper plane on Telegram's blue disc (#2AABEE) drawn inline, never a generic icon; the two buttons stack with a 12 px gap and identical width so they read as one choice. The Telegram button renders only when the Telegram client is configured, so the screen is unchanged where it is not. Copy is provider-aware: the error page names the provider that failed and offers its button; the deleted-account page shows "@username (Telegram)" or the name instead of an email; Settings → Account reads "Telegram account · @username"; the delete sheet says "sign in with Telegram again as @username"; admin user detail reads "Signs in with · Telegram · @username". Verified with Playwright at 375, 390, 430 and 1280 px (both buttons 56 px tall, full column width, no horizontal overflow, the Telegram button 24 px plus the safe-area inset above the bottom edge on phones), plus the full dev-stand-in Telegram flow (new account → onboarding step 2, returning sign-in → same account, Google callback with a Telegram pending cookie → "That sign-in link expired", re-authentication round trip from the delete sheet). Screenshots in `screenshots/telegram/` (gitignored).

## 26. Welcome screen: the glass sign-in card (2026-09-18)

Replaces §21's top-left composition with the owner's mockup: the same night-beach photograph, now with no scrims, and
one centred frosted-glass card carrying everything.

Card. Max width 400 px (440 px from `md`), radius 28 px, `background: rgba(255,255,255,0.12)`, a 1 px
`rgba(255,255,255,0.2)` hairline, `backdrop-filter: blur(40px) saturate(1.5)` and a soft 0 24 px 64 px black shadow.
It sits 15 dvh from the top on phones (plus the safe-area inset) and 11 vh on wide screens, so the couple on the sand
is never covered. The photograph keeps its own colour; the card alone provides the contrast for the white type.

Contents, in order: the wordmark in white at 38 px tall (`Wordmark tone="white"`, from
`public/brand/mellocrush-logo-white-480.png`; see §34 for the final artwork, of which white lettering is the supplied
form, and whose proportions are never altered); the tagline "Closer than you think" in 13 px uppercase
with 0.22 em tracking at 70 % white; the two sign-in pills; a rule with "or"; and the legal line linking to
`/legal/terms` and `/legal/privacy`.

Sign-in pills. 58 px tall, fully rounded, full width of the card's content column, 12 px apart. Google keeps the white
surface with the four-colour G (its brand guidelines); Telegram is the Telegram-blue pill `#0AA0F4` with a white paper
plane and white label. The shape is a prop on `ContinueWith` (`shape="pill"`), not a class the caller appends, because
`cn` only joins strings: two radius utilities would otherwise be settled by stylesheet order instead of intent.

Legal pages. `/legal/terms` and `/legal/privacy` are public, statically rendered pages on the warm-white surface. They
state only what the product already enforces and say plainly that the final documents are still being finalised, so the
welcome screen never links to a dead end.

Verified with Playwright at 375, 390, 430 and 1280 px: no horizontal or vertical page scroll, the card is fully visible
above the couple at every width, both pills are 58 px tall with a 999 px radius and the same width, and the white
wordmark renders from the light artwork. Screenshots in `screenshots/welcome2/` (gitignored).

## 27. Email + password on the glass card (2026-09-18)

The welcome card gains a third way in below the "or" rule, and it has two modes in one container:

- **Sign in**: email, password with a show/hide toggle, the coral Continue pill, "Forgot password?", then
  "New to Mellocrush? **Create account**".
- **Create account**: email, create password, confirm password, the length hint, the coral Create account pill, then
  "Already have an account? **Sign in**".

In both, the switch is the coral word at the end of the line — the only other coral on the card besides the primary
pill, so the eye goes to the action. Switching is local state: the same card, the same provider buttons above it, the
same photograph, no navigation and no reload. The rules live in a reducer (`auth-card-state.ts`) rather than in the
component, so they are unit-tested directly: which fields each mode shows, which copy it uses, that switching clears
a failed attempt and any busy state, that switching to the mode already on screen is a no-op so a stray click cannot
wipe an error someone is still reading, and that an accepted registration shows the check-your-email state.

After a successful registration the server action redirects to the existing "Verify your email" screen, which is the
same `AuthShell` card. An address that already has an account stays on the card and shows the identical
check-your-inbox message, because telling the two apart would reveal who has an account.

"Verify your email", "forgot password" and "reset password" are separate screens rendered by the same `AuthShell`, so
the whole flow is one place: the same photograph, the same glass card, the same white wordmark. `/auth/register` is a
deep link into the card's register mode for anyone who arrives there directly.

Every control on the card shares one surface: 52 px tall, fully rounded, the card's content width, a translucent
white surface (10 % white) with a 25 %-white hairline, white text and a 55 %-white placeholder. That includes the two
provider buttons, which no longer carry their own brand colours — a white Google pill beside a Telegram-blue one made
the card read as two brands competing rather than one set of choices. The four-colour Google G stays, because it is
the part people recognise and Google's guidelines allow the mark on a dark surface; Telegram uses the plain white
plane. The coral Continue pill is the only filled control, which is what marks it as the primary action. The focus
ring is the white outline used across the card. The password toggle is a real button with an eye icon and an
`aria-pressed` state, and it names what it does for screen readers.

Type is deliberately quiet, so the card reads as a form rather than a poster: provider labels and the Continue pill
at 15 px, fields at 14 px, the "Create account" / "Forgot password?" row at 12.5 px, the legal line at 11.5 px, the
tagline at 11 px uppercase, and the wordmark 30 px tall. Controls are 48 px, comfortably above the 44 px minimum
touch target. Button height and label size are **props** on `ContinueWith` (`heightClass`, `textClass`), not classes a
caller appends: `cn` only joins strings, so two competing utilities would be settled by stylesheet order rather than
by intent — the same trap that first shipped a 16 px radius where a pill was asked for.

The card is 573 px tall signing in and 631 px creating an account at 375 px, so both clear the viewport at
375 × 812 with the couple visible below; each method is hidden when it cannot complete, which shortens it further.
Verified with Playwright at 375, 390, 430 and 1280 px: no horizontal or vertical page scroll, every control 48 px tall
and the same width within a card, the registration flow reaching "Verify your email", and that screen offering only Resend, Change
email and Sign out. Screenshots in `screenshots/emailauth/` (gitignored).

## 28. Sheets keep their primary action (2026-09-18)

The Filters sheet on an iPhone put "Apply" out of reach: the button sat behind Safari's toolbar and the Advanced
filters rows were cut off mid-row. Three separate faults, all in `src/components/ui/dialog.tsx`, so the fixes apply to
every sheet and modal in the app.

- **Height unit.** The sheet was capped at `88dvh`. The *dynamic* viewport unit tracks the browser's collapsing
  toolbars, so a sheet sized to it can be taller than what is visible while the toolbars are shown, hiding its own
  bottom. It is now `88svh` (`85svh` for the desktop modal) — the *small* viewport, which is the size that is always
  visible. A sheet never has to be scrolled to reach its own edge.
- **Pinned footer.** `DialogBaseProps` gained `footer`. It renders outside the scrolling body, above the safe area,
  with a hairline and a translucent backdrop. The Filters sheet passes its error line and "Apply" there, so the
  primary action stays put however long the content is. Content scrolls; the decision does not move.
- **Why it was not scrolling at all.** The body is a flex column, and flex items shrink by default: the sections were
  being *compressed* to fit rather than overflowing, and the Advanced filters card — which has its own
  `overflow-hidden` for its rounded corners — quietly clipped its contents instead. `scrollHeight` therefore never
  exceeded `clientHeight` and there was nothing to scroll. The body now sets `[&>*]:shrink-0`.

Two related corrections in the same file:

- `showModal()` moves focus to the first focusable descendant, which the global `:focus-visible` rule then outlines.
  In the Filters sheet that was "Reset", which appeared boxed and pressed before anyone had touched it. The dialog
  element takes `tabIndex={-1}` and focus itself on open: the accessible name is still announced, focus is still
  trapped, and no control looks activated.
- Never put a `display` utility on a `<dialog>` at all — see §30, which corrects the first version of this line.

## 29. The desktop tier (2026-09-19)

Above 900 px the app was the tablet layout in a larger window: a 640 px column with the sidebar floating beside it and
the rest of the display empty. Measured before the change, at 1920 the main column was 640 px starting at x = 756 on
Likes, Community and Profile — more than 700 px of nothing on the left and 500 on the right.

Four causes, all in the shell:

1. `AppShell` centred the whole row (`justify-center`), so the sidebar floated in mid-viewport and the dead space was
   split symmetrically either side of the group rather than being usable width.
2. `--content-max: 640px` capped main on every route but Chats and Settings.
3. `--deck-max: 500px` capped the Discover card at phone size.
4. There was one desktop breakpoint (900). Nothing changed between a small laptop and a 1920 display.

`@custom-variant wide (min-width: 1280px)` is now the desktop tier. Everything below it is unchanged: phones keep the
single column and the floating nav, and the tablet composition between 900 and 1279 is exactly what it was. At the
wide tier the row is left-aligned, the sidebar is 248, and main plus any panel form one content group capped at
`--content-wide` (1360) and centred in what remains, with 40 px gutters. Each screen then composes inside that group:

| Screen | Wide composition |
| --- | --- |
| Discover | Header and deck are one 560 px column centred between the sidebar and a 320 px activity panel. Capping the deck alone would leave the likes pill, Boost and Filters against the far edge, pointing at a card hundreds of pixels away. |
| Community | 690 px feed centred in main, with the same new-matches and activity panel at 312 px. The panel is the data the app layout already loads — a composition of existing features, not a new one invented to fill space. |
| Likes | Four cards per row (three on tablet, two on phones). Matches become a three-column card grid. Empty states become a full-width panel instead of a small block adrift in the content area. |
| Chats | 352 px conversation list; the thread takes the rest of the group. The detail pane with nothing selected is a proper empty state, not one grey sentence in an empty half-screen. |
| Profile | Two columns: identity and completion at 400 px on the left, account sections on the right capped at 640. Rows are bounded, because a row dragged across 800 px puts its label and its value at opposite ends of the display. |
| Settings | Still a bounded 900 px column — settings rows do not benefit from width — but centred in the group rather than pinned left beside a void. |
| Filters | The desktop panel is 560 px. Age and "Show me" sit side by side from 900 px instead of each taking a full row, and the two age sliders stack within their half rather than becoming 120 px each. |

Measured after, at 1920: sidebar at x = 0, content group 1280 wide with 196 px margins either side; at 1440 the group
fills the remaining width with its 40 px gutters. No horizontal overflow and no page errors at 1920, 1440, 1280, 1024
or 390; the 1024 and 390 measurements are identical to before.

## 30. Dialogs leave `display` to the user agent (2026-09-19)

§28 said a `<dialog>` needs its display utility guarded by the open variant. That was half right and it is the wrong
advice. The guard is real — an unguarded `flex` beats the user-agent rule that hides a closed dialog, which leaves
every sheet in the page laid out and swallowing taps — but the guarded form has its own cost: Tailwind compiles that
variant to `:is([open], …)` with two further pseudo-classes that Safari gained only recently, so the *layout of an
open sheet* ends up depending on how well the browser parses that selector list. The Filters sheet and the admin menu
are both this component, and both were reported broken on an iPhone.

The fix is to want neither. The flex column moves to a wrapper `<div>` inside the dialog, which is unconditionally
`display: flex`, and the dialog element carries no display utility — so the user agent does what it has always done:
`none` when closed, `block` when open, in every browser that has `<dialog>` at all. The sheet's maximum height moves
to the wrapper with it. Everything §28 added is unaffected: the pinned footer, the small-viewport unit, the
`[&>*]:shrink-0` that makes the body scroll rather than squash, and the dialog taking focus itself on open.

One incidental trap worth knowing: **Tailwind scans prose for class names**, including code comments and these docs.
The first version of this section made Tailwind emit the very rule it was warning about, from the sentence describing
it. Where a utility has to be named in prose, describe it rather than spelling it.

## 31. The notification bell and its dropdown (2026-09-19)

The reference is a dropdown, not a screen: a floating card under the bell, aligned to its right edge, over a page
that stays visible and undimmed. It is deliberately not a bottom sheet on phones — the same card is sized to the
viewport instead (78vw, so 292 px at 375 and 304 at 390; a fixed 400 px from the desktop tier), capped at
`calc(100vw - 1.25rem)` so it can never reach an edge.

Composition: a header row ("Notifications", plus "Mark all as read" in `primary-ink` only while something is
unread), a scrolling list capped at `min(60svh, 420px)`, and a centred accent footer linking to `/notifications`.
Rows are the shared list component, so the dropdown and the page cannot drift: 40 px avatar or a muted circular
line icon, an extra-bold title, an optional secondary line, and the time on the right. Unread is marked twice and
quietly — a 6 px rose dot beside the time and a `primary-soft/35` row wash — with a screen-reader-only "Unread".
Separators are `divide-border`; the card has no outline, as everywhere else in the system.

**The bell is the last trailing control in `TabHeader`, and that ordering is structural.** The card extends
leftwards from the bell, so a screen control rendered after it pushes the bell inwards and hangs the panel off the
left of a phone. That is not hypothetical: with the bell placed first, the Discover header's Boost and Filters
buttons put the panel at x = −166 on a 390 px screen. `TabHeader` now renders `actions` and then the bell, so a
caller cannot place anything to its right. Measured after: fully inside the viewport at 375, 390, 430 and 1440.

Behaviour: the bell toggles; a pointerdown anywhere outside closes it; Escape closes it and returns focus to the
bell. The button carries `aria-haspopup="dialog"`, `aria-expanded` and a label that includes the count
("Notifications, 5 unread"); the card is a `dialog` labelled "Notifications", so Tab moves into it in DOM order
rather than trapping focus in a non-modal popover. The badge is exact to 9 and then "9+", and there is no badge at
zero. Empty is one line — "You're all caught up." — not an illustration.

The page at `/notifications` is the same rows in a `ListGroup` under the standard page overlay, with "Show older"
paging and its own mark-all. Its bottom clearance is a spacer rather than padding, because the page-overlay body
sets `padding-bottom` inline and an inline style beats a class.

## 32. The compact pass: thin type, dense chrome (2026-09-19)

Mellocrush read heavy on a phone. The diagnosis was not the obvious one — the body scale was already right
(15 / 14 / 13 at weight 400). Three other things made it feel bulky, and all three had to go together:

1. **Twelve of the nineteen type steps carried weight 700–800.** Every heading, label and chip.
2. **252 weight utilities sat on top of those steps**, overriding them: 36 extra-bold, 78 bold, 138 semi-bold
   against 13 medium and 3 normal. Retuning the tokens alone would have changed almost nothing.
3. **Controls and padding were built for a prototype, not a phone**: 52 px buttons and inputs, 18–22 px card
   padding, 96 px of nav clearance, a 72 px empty-state disc with a 30 px glyph.

### What changed

**One scale, and every step owns its weight.** Body 14–15/400, secondary and captions 12–13/400, labels and
navigation up to 500, section headings 16–18/500–600, page titles 20–24/600. Nothing in normal chrome is heavier
than 600 and there is no 700+ step at all — emphasis that rare should be deliberate and local. A component never
adds a weight utility beside a type step now; where one shares a class string with a weight-bearing step it is
removed, because it would only ever downgrade it.

**Line heights were left alone.** Reading text stays at 1.5. Density here comes from padding, control heights,
gaps, avatars and glyphs — never from crowding the text, and never from a transform or a browser-zoom trick.

| | Before | After |
| --- | --- | --- |
| Buttons (sm / md / lg) | 40 / 48 / 52 | 38 / 44 / 46 |
| Inputs, select | 52 | 44 |
| List rows | 54 / 56 / 60 | 48 / 50 / 54 |
| Card padding (sm / md / lg) | 16 / 18 / 22 | 12 / 14 / 16 |
| Tab header · page header | 48 · 56 | 44 · 48 |
| Bottom nav bar · items | 64 · 48 | 56 · 44 |
| Nav clearance | 96 | 80 |
| Section gap (Stack lg) | 20 | 14 |
| Empty-state disc · glyph | 72 · 30 | 52 · 22 |
| Default icon · stroke | 20 · 2 | 18 · 1.9 |
| Default avatar | 44 | 40 |

**The floor is 44 px and it did not move.** Icon buttons stay 44. The Switch pill shrank to 46 × 28 but its button
is now a 44 px target with the pill drawn inside it, so the visual got smaller and the thumb target did not. The
chats search field's inner input now fills its container rather than being a clickable text strip. A browser sweep
at every tested width reports nothing interactive under 32 px except the photo-tile corner chips, which are 32.

**The identity is untouched.** Same coral, same warm page, same gold for Plus, same glass with a soft shadow and no
outlines, same radii, same dark mode.

### Arbitrary values

97 one-off `text-[Npx]` values across 37 files bypassed the scale; 96 are gone. The six auth screens — a parallel
white-on-photo glass system — now map onto the shared steps, so they move with it. The one remaining is a 9 px
micro chip, and the development-only identity-provider page keeps its own values because it deliberately imitates
somebody else's chrome.

### Measured (390 × 844)

| Screen | Before | After |
| --- | --- | --- |
| Community feed | 4177 px, 3 posts above the fold | 3337 px, 4 posts (−20 %) |
| Settings | 1844 px | 1628 px |
| Privacy & Safety | 1198 px | 1043 px |
| Chat list rows | 76 px | 60 px |
| Notification rows | 65 px | 57 px |
| Community post | 224 px | 162 px |

Community is a feed and stays a feed — the brief was explicitly not to force a scrolling screen into one viewport.
Discover, Likes, Chats and Notifications each fit their viewport with no page scroll at every tested width.

## 33. The responsive contract (2026-09-19)

The rule, on every route, at every width:

```
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

A user must never drag the page sideways to reach a button, a message or a menu. `scripts/responsive-audit.mjs`
checks it; `npm run test:responsive` runs it.

### The bug this came from, and why it was invisible

Mellocrush was reported as draggable sideways on an iPhone. Screenshots came from a different screen each time, so
it was fixed screen by screen and kept coming back. The instrumentation said the app was clean: 367 route×viewport
checks passed, including with hostile content and the keyboard open.

Both were true. **The document never overflowed. The viewport shrank.**

iOS Safari zooms the page whenever a focused `input`, `textarea` or `select` computes below **16px**, and modern
iOS does not undo the zoom on blur. §32 took every field to 14–15px. So one tap on one field — the sign-in
password box, the chat composer, a search — left the whole app pannable sideways on every screen for the rest of
the session, until the user pinched out. Different screen every time, because the cause was not on any screen.

`scrollWidth <= clientWidth` stays true throughout: the layout viewport is unchanged, the *visual* viewport is
what got smaller. That is why a document-level check could not see it, and why no amount of per-screen fixing
would ever have found it.

### The floor

`--text-field: 16px` is a floor, not a preference. It sits outside the body scale so a density pass moves the
other nineteen steps without touching it. `globals.css` also enforces it **outside `@layer`**, which beats
`@layer utilities` and therefore beats every Tailwind `text-*` class:

```css
input, textarea, select { font-size: max(var(--text-field), var(--field-font-size, 0px)); }
```

A field that wants to be bigger sets `--field-font-size`. Nothing can make one smaller — not a `className`, not a
regex sweep across the repo, which is exactly how §32 introduced this.

Density comes from the 44px control height, the padding and the weight. It never comes from the type size again.

**`maximum-scale=1` and `user-scalable=no` also stop the zoom, and are banned.** They take pinch-to-zoom from
anyone who needs to magnify. `tests/unit/responsive-contract.test.ts` fails the build if either appears.

### Scroller

A chip row or carousel is the one shape that may legitimately scroll sideways, so the exception is declared rather
than improvised. `src/components/ui/scroller.tsx` replaced three hand-written `overflow-x-auto` strips and adds:

- `overscroll-behavior-x: contain` — without it, flicking a carousel past its end chains the scroll to the page on
  iOS and the whole app slides under the thumb. Another horizontal-drag bug invisible to a desktop mouse.
- One number for the bleed. Going edge to edge means cancelling the parent's padding with a negative margin and
  putting it back inside; the two were written separately in all three places (`-mx-4`/`px-4`, `-mx-0.5`/`px-0.5`,
  and one with neither). `bleed` derives both, so they cannot drift.

A standalone `Bleed` was proposed and deliberately not built: every bleed in the app is part of a scroller, so it
would have had no callers and would have been one more way to write the arithmetic.

### What the audit checks

1. The document does not scroll sideways.
2. Nothing escapes the viewport — reporting the **deepest** offending node, including text that spills out of a
   box whose own rect still fits. An earlier version reported the widest ancestor instead, which named a wrapper
   rather than the fix.
3. Every visible editable control computes at 16px or more.

It runs signed-out routes in a signed-out context, and **fails loudly when a navigation lands somewhere else**.
An earlier version probed `/auth/register` while signed in, was bounced to `/discover`, measured Discover, and
reported a pass for eight auth and legal screens it never rendered. `/auth/verify-email` exists only in one
session state, so a flow registers a throwaway account to reach it; flows write, so they refuse to run off
localhost.

### The limitation, stated plainly

**Only Chromium is available in the authoring sandbox.** WebKit cannot be installed. Chromium does not implement
iOS focus-zoom, so the `visualViewport.scale === 1` clause *cannot fail here* and proves nothing about Safari. It
is recorded so a WebKit run checks it, and so clause 3 — which is a real measurement — is never mistaken for it.

Clause 3 is the proxy: it verifies the documented precondition for the zoom, not the zoom. Final confirmation is a
real iPhone.


### Postscript: the same bug wearing a different hat

Safari came back clean and Chrome on iPhone did not — on a few screens, not all. Chrome on iOS is WebKit, the same
engine, so the engine was not the difference.

What was ruled out, in order:

- **Production content.** The longest unbroken run in the whole production database is 17 characters, a bank
  account number. Nothing a member has written is wide enough to overflow a 320px column.
- **Text scaling.** Every route holds at 200% text with no overflow. The px-based scale is robust to it.
- **Desktop-mode layout.** The audit had been running phone widths *without* `isMobile`, so Chromium ignored the
  meta viewport entirely and laid pages out as narrow desktop windows — a rendering mode no user has. Fixed; the
  results are the same either way, but the earlier runs were measuring the wrong thing.

What reproduces it exactly: **page zoom at 110%.** The visual viewport drops to 355px while the layout viewport
stays 390px, giving 35px of sideways pan — with `scrollWidth === clientWidth` throughout.

So it is the same shape of bug as the focus-zoom: a zoom state, not a layout. Chrome on iOS keeps page zoom
**per site** and syncs it; Safari does not. A zoom recorded while the focus-zoom bug was live survives the fix,
because nothing in the page controls it. It shows only on dense screens, because on a sparse one the extra 35px
is empty margin.

There is no code fix, and there should not be one: overriding a zoom the user or their browser chose is the same
mistake as `user-scalable=no`, just later in the stack. The check is per-device — a private tab carries no saved
zoom, so if the app is clean there and not in a normal tab, the saved zoom is the cause.

## 34. The final logo (2026-09-20)

The owner supplied the finished Mellocrush logo as two flattened images, and they replace every brand asset shipped
before: `brand-source/mellocrush-wordmark.png` (lowercase `mellocrush`, white lettering, an interlocking coral
`#EE5358` "oo" and a gold `#FDA748` heart, on the brand navy `#0B1A2B`) and `brand-source/mellocrush-mark.png` (the
interlocking "oo" with the heart, on white). §24's cocoa lettering, pale coral and four-point star are gone, and so
is the star everywhere it was described — the heart replaces it.

Everything in `src/assets/brand/` and the two icon files in `src/app/` are now **derived** from those two images by
`scripts/build-brand-assets.py`, never hand-edited, so a size can never drift from the artwork. Regenerate with
`pip install Pillow numpy && python3 scripts/build-brand-assets.py`.

**Cutting the background out.** Both images arrive flattened onto a solid colour, so the first job is a real alpha
channel. Thresholding leaves a rim of half-background pixels around every curve — a dark halo on the sand page, a
light one on black. The script instead reads each pixel as the composite it is, `C = a·F + (1−a)·B`: coverage `a`
ramps across a narrow distance band from the background colour, and the foreground colour `F` is then solved for and
stored un-premultiplied. The curves are clean over any background, which is the whole point of a transparent logo.

**Two lettering colours, because a raster cannot follow `--text`.** The supplied lettering is white, which is right
over navy or a photograph and invisible on `#FFFBF1`. `mellocrush-logo*.png` recolours *only* the near-neutral
lettering to the artwork's own navy `#0B1A2B`; `mellocrush-logo-white*.png` keeps it white. The coral "oo" and the
gold heart are never touched in either. The recolour is weighted by how neutral a pixel is rather than switched on a
threshold, so the blends where the white letters run into the coral stay smooth instead of showing a seam.

**Picking one.** `<Wordmark>` defaults to `tone="auto"`, which renders both files and lets `.wordmark-ink` /
`.wordmark-white` in `globals.css` choose on `:root[data-theme="dark"]`. It has to be CSS: appearance is a per-viewer
localStorage choice applied to `<html>` by the inline script in `layout.tsx`, so the server cannot know it and
guessing would flash the wrong colour. Those rules sit inside `@layer base` on purpose — the Discover header hides
the wordmark below 390 px with `max-[389px]:hidden`, and an unlayered rule would silently beat that utility. Fixed
tones stay available: the welcome card passes `tone="white"` because it is over a night photograph whatever the
appearance setting says. This also fixes a standing bug: the old cocoa wordmark was rendered unchanged on dark mode's
`#000000` background, where it was very nearly invisible.

**Sizes.** Wordmark 1492×284 (aspect 5.2535, replacing 1977×326), with 480 px renditions of both tones for the app —
every wordmark slot renders 21–38 px tall, so 480 px covers 3× DPR — and a 960 px white rendition for larger use. The
mark is a 512 px transparent square. App icons (`mellocrush-app-icon-{192,512}.png`, `src/app/icon.png`,
`src/app/apple-icon.png`) are the mark flattened onto the warm page colour `#FFFBF1`, opaque rather than transparent
because iOS composites a transparent icon onto black.

**Why `src/assets/brand/` and not `public/brand/`.** The artwork shipped once from `public/`, at fixed URLs, and the
old mark stayed on screen — noticed on the admin portal, where the signed-out card is the only place the mark appears
alone at 40 px, but true anywhere a browser already held a copy. Files under `public/` are served
`cache-control: public, max-age=0, must-revalidate`, which iOS Safari treats as a suggestion, and replacing the bytes
under the same path gives it no reason to think otherwise. Importing them instead makes the bundler hash the contents
into the filename, so `logo.tsx` and `manifest.ts` reference `/_next/static/media/mellocrush-mark.<hash>.png`, served
immutable: new artwork, new URL, no stale copy anywhere and nothing for anyone to clear. `src/app/icon.png` and
`src/app/apple-icon.png` need no help — Next's file-based metadata convention already fingerprints them. Guarded by
`tests/unit/brand-assets.test.ts`, because putting a logo back at a fixed path looks like nothing in a diff and only
shows up on somebody else's phone.

Verified in the browser at 390 px light, 390 px dark and 1440 px: the welcome card, the Discover header, the desktop
sidebar and the app icon, with the navy lettering on sand, the white lettering on black, and no halo on either.

## 35. Membership, rebuilt to the owner's design (2026-09-20)

The screen already had the right numbers; what it did not have was a shape. Three changes carry it.

**The table states only the difference.** It used to carry ten rows, three of which said the same thing in both
columns — *Profile, photos, Discover, matching and chat*, *Messaging your matches*, *Block, report and safety
tools*. Rows that agree with themselves make a comparison a third longer while answering nothing, so they moved
into one **"Always included for everyone"** card beside it and the table is seven rows of actual difference.

**Cells carry meaning, not glyphs.** `ComparisonCell` is `{kind:"text"} | {kind:"included"} | {kind:"excluded"}`,
so the read model says *what is true* and the page decides that "included" draws as the Plus mark and "excluded"
draws as an em dash. Sending "Included" as a string would have put presentation in the read model and forced the
page to compare against that string to lay anything out differently. Each row also carries a stable `key`, which
is what the icon map is keyed on — matching an icon to a display label would break silently the first time
somebody rewords the copy.

**The Plus column is one panel, not seven tints.** A rounded, gold-edged block spans header to last row behind the
cells, so the column reads as a single run of gold rather than a stack of separately tinted cells with seams
between them.

**The Plus glyph is masked, not baked.** `--sand` is `#c6a962` on the page and `#e0c27a` on black; no single PNG
is both. `PlusMark` masks the real mark artwork and fills it with the token, so the glyph is exactly the theme's
gold at any size, from the file the coral mark already uses. A gold PNG would have needed one per theme and would
drift the moment the artwork changed.

**The hero lockup is composed, not a flattened image.** `PlusLockup` sets "mellocrush" in coral and "plus" in the
Plus gold over the coral mark, with the glow as two blurred radial layers behind. Keeping the type as type means
it stays sharp at any density and is not an image of words. It hides below 360 px, where the headline needs the
width more than the lockup does.

Prices, plan names and badges are unchanged and still come from the admin-managed rows — MVR 49 / 149 / 357 over
7 / 30 / 90 days, "Most popular" and "Best value" — as does whether anything is for sale. Nothing on this screen
can grant Plus; the CTA creates an order that an admin confirms.

Verified at 320, 360, 390, 430 and 1280 px in both appearances: no horizontal page scroll at any width, every
feature label on one line from 360 px up, and the gold panel legible on black and on the sand page colour.


## 36. The Welcome Screen cover is admin-managed (2026-09-20)

The sign-in screen's background is now three art-directed images an admin uploads, not one file in `public/`
(docs/ARCHITECTURE.md §26). Everything in front of it is untouched: logo, tagline, glass card, Google, Telegram,
email and password, Continue, Forgot password, Create account, the legal line.

- **Mobile** (under 768px) 1080 × 1920 · **Tablet** (768–1279px) 1536 × 2048 · **Desktop** (1280px and up) 2560 × 1440.
  `<picture>` runs widest-first and takes the first matching `media`, so one file is downloaded, not three.
- `object-fit: cover` everywhere: the image fills the viewport at every size and orientation, keeps its proportions
  and is cropped rather than stretched. Intrinsic width/height on each candidate reserves the box, so the card never
  moves when the photograph lands. A blur or flat average colour sits behind it, so the area is never blank.
- A missing variant falls back to the built-in default **for that device**, never to another variant's artwork.
- **Admin → Settings → Welcome Screen**: name a cover, upload up to three images (each slot shows a thumbnail in its
  own aspect, the real dimensions and weight, and warnings rather than refusals for an odd shape or low resolution),
  preview it, then publish. The preview is real iframes at 390 / 834 / 1180 / 1440px showing the actual Welcome
  Screen, with an optional safe-area guide that exists only in admin.
- Verified at 320, 360, 390, 430, 667×375 (landscape phone), 768, 820, 1024×768 and 1180×820 (landscape tablets),
  1280, 1440 and 1920: each width loads its own variant, the image covers the viewport, and `scrollWidth <=
  clientWidth` holds everywhere.

## 37. The auth screen: recessed controls, no card (2026-09-21)

The shared Sign In / Sign Up screen no longer has a frosted card. The controls sit directly on the admin-managed
cover photograph (docs/ARCHITECTURE.md §26–27), and depth does the work the container used to do.

### The one idea

    the cover photograph
      → the controls read as part of the page
      → Email and Password are PRESSED IN
      → the coral primary is RAISED

That opposition is the design. Four utilities in `globals.css` carry it, every one of them a box-shadow:

| Utility | Used by | Depth |
|---|---|---|
| `auth-scrim` | the page | none — a full-bleed darkening, no radius, no edge |
| `auth-recessed` | Email, Password, Confirm password | shadow inside the top edge, light hairline inside the bottom, **no border** |
| `auth-flat` | Continue with Google / Telegram | a 1px inner hairline and a 1px drop — deliberately much shallower |
| `auth-raised` | the coral primary | a soft outer shadow, the mirror of the fields' inner one |

The provider buttons sit between the two extremes on purpose. If they had the fields' depth the screen would read as
one undifferentiated stack; at almost no depth, the eye sorts the controls into "type into these", "tap one of
these" and "this is the action".

No border on the fields at all. An outline flattens an inset shadow into a drawn rectangle, which is what makes
cheap neumorphism look like a sticker. The invalid state is a coral ring drawn as a shadow, so it stacks with the
recess rather than replacing it.

### Readability over an unknown photograph

A cover is whatever an admin uploaded — it could be a midday lagoon or a white sail. `auth-scrim` is a full-page
treatment, darker at the edges than the middle, so the type carries on a bright cover while the photograph still
survives in the centre. It is explicitly **not** a panel: full bleed, no radius, no border, no shadow. Small white
type gets `auth-legible`, a single soft text-shadow, for the same reason.

The scrim is a fixed gradient rather than something computed per image. A genuinely adaptive version would need the
cover's luminance plumbed into the DTO; this one is tuned to work at both ends instead, which is cheaper and has no
failure mode.

### What did not change

The background system is untouched: `AuthBackdrop`, the `<picture>` art direction, the per-device preloads and the
three admin-managed Mobile / Tablet / Desktop variants all work exactly as before. So does every piece of
authentication — providers, validation, routes, the password toggle, mode switching, the legal links.

Fields are `text-field` (16px) and the structural floor in `globals.css` still applies, so a focused control can
never drop below the threshold that makes iOS Safari zoom and stay zoomed.

The form column is 344px (364px from `md`), centred at every breakpoint. Removing the card removed its padding, so
the column is narrower than the old 380/400px card while the controls inside it are the same width as before.

## 38. Community, made social (2026-09-21)

The brief was "make it feel active, social and engaging" without redesigning it. Nothing on the screen moved: the header and bell, the For You / Following / New pills, the post card, the bottom nav, the coral FAB and the cream surface are all as they were. What was added sits inside that shape.

**The topic row** is under the tabs and is deliberately *not* a second PillTabs. No track, no outline, no fill until a chip is chosen, and the chosen chip is aqua rather than coral — two coral pills stacked one above the other read as one control that has lost track of which row you are in. It scrolls sideways inside `Scroller` (§33's one sanctioned exception: the page never scrolls sideways, a chip row may), and a chip selected from elsewhere — the compose sheet pre-selecting "Polls", the "Busy this week" module — is scrolled into view, deferred one frame because a sheet's `<dialog>` is still `display:none` while its children's effects run.

**"What's happening?"** is a row, not a card: the viewer's avatar, a line of prompt text, four shortcut chips and a hairline. Anything with a `glass-card` behind it would have been the loudest thing on the screen and would have pushed the first real post below the fold at 320 px.

**The FAB opens a menu first.** Five kinds do not fit across a 320 px sheet as pills, and the choice is better made before the form than on it, so the + button opens a compact `BottomSheet` of five 56 px rows (Post, Question, Poll, Photo, Confession — icon, label, one line of hint) and the compose sheet then carries only that kind, titled after it, with "Change type" to go back. `post-kinds.tsx` is the single source for the wording, so the confession's privacy promise cannot say one thing in the menu and another on the form.

**Polls** show their results before and after voting. Hiding them until you vote turns a question into a toll gate and makes people tap an option they do not mean, which corrupts the number they wanted to see. The bar is decoration drawn behind the label; the percentage beside it and the per-option vote count in the accessible name are what is actually announced.

**Anonymous confessions** get a whisper glyph in place of the avatar, "Anonymous" as plain text rather than a button, no verified seal, no island, and no follow control. That is presentation reinforcing a server rule, not implementing it (ARCHITECTURE §14.14).

**Nothing is fabricated.** "12 people joined this conversation", "Popular in Malé", "🔥 Popular today", "people posting lately" and "busy this week" are all counted from rows, and each has a floor below which it is absent rather than padded. A short or empty feed is filled with those modules plus static conversation-starter prompts and a create CTA — never a blank screen ending in "You're all caught up."

**Follow is "Follow / Following" and nothing else.** No counts, anywhere. The brief rules out public follower-count obsession and the product rules out telling someone they are being watched.

Verified at 320 / 360 / 390 / 430 / 768 / 820 / 1024 / 1280 / 1440 / 1920: no horizontal page scroll at any width, nothing overflowing outside a declared scroller, every field at or above the 16 px floor, and the create and poll sheets fitting inside a 320 × 568 viewport with nothing to scroll.

## 39. The auth screen is centred on both axes (2026-09-21)

§37 removed the card and centred the 344/364 px column horizontally, but left it hanging from the top of the screen:
`padding-top: 6dvh` on mobile, `8vh` from `md`, and whatever was left over collected at the bottom. On a 390 × 844
phone that put roughly a third of the screen below the legal line — the stack read as pinned to the top of the
photograph rather than placed on it, and on a desktop viewport the gap was larger still.

The column is now centred **vertically as well as horizontally**, on every auth screen (welcome, register, verify
your email, forgot password, reset password — they all share `AuthShell`). The paddings became symmetric
`4dvh` plus the safe-area inset, and they are now minimum gutters rather than the layout: they only bite once the
screen is full.

### `justify-center-safe`, not `justify-center`

Plain centring has a failure mode that is invisible until it bites someone: when the content is taller than the
viewport, a centred flex container overflows **in both directions**, and the part that goes off the top edge cannot
be scrolled back to. On this screen that is the wordmark and the provider buttons, on a 320 × 568 phone, or on any
phone with the software keyboard up.

`justify-content: safe center` is the fix and it is one word: the browser centres while the content fits and falls
back to start-aligned the moment it does not. Verified at 320 / 360 / 390 / 768 / 1280 and in landscape — the
320 × 568 case start-aligns and scrolls, everything taller centres.

### Everything but the field's own text is on the centre axis

The supporting captions used to be `text-left` while every other line on the screen — wordmark, tagline, the "or"
rule, the button labels, "Already have an account?", the legal line — was centred. The password hint ("At least 10
characters. Length beats punctuation."), the form-level error and the per-field errors are all centred now.

The inputs keep their `text-left` wrapper, because that is what holds the placeholder and the value, and centred
type inside a pill field would be wrong. That wrapper is the only left-aligned thing left in the column.

### What did not change

Nothing about the depth system (§37): `auth-scrim`, `auth-recessed`, `auth-flat` and `auth-raised` are untouched, as
are the cover, the `<picture>` art direction, the per-device preloads, the 16 px field floor and every piece of
authentication behind the screen.

## 40. Replies, edits and reactions (2026-09-22)

The brief asked for Messenger's behaviour without Messenger's noise: "no clutter", "do not add unnecessary modals
or oversized menus", "do not turn the feed into a large row of permanently visible emojis", and above all keep the
existing Chat and Community layouts. Every decision below is that sentence applied.

**Nothing appears until it exists.** `ReactionSummary` renders `null` when there are no reactions. That is the most
important line in `src/components/ui/reactions.tsx`: a conversation nobody has reacted to, and a feed of unreacted
posts, look *precisely* as they did before any of this shipped. A count is drawn beside an emoji only once more
than one person has chosen it, so the common case is a single 13 px glyph in a 26 px pill.

**The picker is a floating row, not a sheet.** Six 44 px round targets, 2 px apart, 6 px padding, on `glass-card`
with `rounded-full`, placed just above the point pressed and clamped 8 px inside the viewport; below the finger
only when there is no room above. Its width is a constant (286 px — six targets, five gaps, two paddings) rather
than measured, because measuring means drawing it somewhere first and then moving it, which is a visible flinch on
the one control that has to feel instant. A sheet was rejected outright: it covers the message you are reacting to.
The backdrop is a transparent tap-catcher, not a scrim — dimming the screen for a six-emoji choice is exactly the
"oversized" that was ruled out, and the message has to stay legible behind the row. The viewer's current reaction
is drawn on `bg-primary-soft`, so "tap it again to remove" is visible rather than implied.

**Chat.** The bubble is unchanged: same 78 % max width, same radii and tails, same `text-body`/1.45, same
`bg-primary`/`text-on-primary` and `bg-aqua-soft`. A reply adds one compact quote inside the bubble above its own
text — a 2 px left rule, the name in `text-micro` medium, the line in `text-caption`, truncated to one line, on a
12 % wash of the bubble's own foreground. One line on purpose: a tall excerpt makes the reply harder to read than
the thing it replies to. Tapping it scrolls to the original and flashes a `ring-2 ring-primary` for 1.2 s; when the
original is gone it reads "Message unavailable" and stops being a button, because there is nowhere to go.

"Edited" sits in the existing `text-tiny` metadata line beside the time and "Seen" — subtle, and reading as part
of the metadata rather than as a badge, because the line was already there.

The composer gains one strip above it, shared by both jobs: a 3 px accent bar (coral for a reply, ocean for an
edit), the label in `text-micro`, the quoted or edited line truncated in `text-caption`, and a 44 px ✕. Escape does
the same thing. The send button becomes a check while editing.

**Community.** The action row keeps its shape entirely — 38 px, heart then comment, same order, same
`text-caption`. The heart *became* the reaction control: a plain tap still hearts the post exactly as before, a
long-press opens the picker, and the button then draws the viewer's chosen glyph at 15 px where the heart icon was,
with the same total count beside it. Grouped pills appear above the row only when **two or more distinct** reactions
exist; until then the button says everything. Comment rows get pills under the body at `mt-1.5` and nothing else.

**Who reacted** is a `BottomSheet` opened from a deliberately quiet `···` at the end of the summary — counts are
free, names cost a tap. Community rows carry a 32 px avatar, chat rows do not (there are only two people in a
conversation).

**Gestures, and the three things they must not break.** `useLongPress` ignores mouse input entirely, so
click-and-hold to select, drag-select across bubbles and clicking links all behave as before; desktop gets the same
menu from a ⋯ that fades in on hover or keyboard focus, which is the better affordance there anyway and adds no
permanent control. It never calls `preventDefault` and never sets `touch-action`: the timer dies on 10 px of
movement and on `pointercancel`, which is what the browser sends when it takes the gesture over to scroll, so the
gesture cannot make a thread feel sticky. `contextmenu` is suppressed only on a press it actually handled.
Text selection is `select-none` below the desktop breakpoint and `select-text` at and above it, so a phone gets the
menu gesture (as every chat app does) while a mouse keeps full selection. Swipe-right-to-reply follows the same
rules and additionally requires the gesture to declare itself horizontal — past 12 px and more than twice as far
across as down — before anything moves; the worst it can do is fail to fire.

Every new control is at least 44 px in its touch dimension (the pills are 26 px tall but sit in a row with 44 px of
clearance and are not the primary path to anything), and every one carries an accessible name that says what will
happen: "React with love", "Remove your laugh reaction", "3 love, including you. Tap to remove yours".

## 41. "Also notify my phone" (2026-09-22)

Push lives **inside** the existing Notifications section of Settings, not on a screen of its own. It is one more block below the five in-app category rows, built from the same `ListGroup` / `ListRow` / `Switch` at the same 48 px height, so it reads as another thing you can switch rather than a feature being sold to you.

One master row, `Also notify my phone`, with the caption *"Notifications on your lock screen when you're not using Mellocrush. They never show what a message says — only that one is waiting."* The second sentence is the promise of §29.2 said in the member's language, and it is on the screen where the promise is made rather than buried in a policy.

Six category rows appear underneath **only once the master switch is on** — Messages, Likes, Matches, Reactions, Community activity, Account and security. Granting the browser permission and enabling the switch are one gesture, and the categories then appear already showing what that gesture turned on, every one individually switchable. Nothing is enabled out of sight.

The block renders `null` — no placeholder, no "not supported on this device" row — when the runtime has no Push API or the deployment has no VAPID keys. Detection is `useSyncExternalStore` over `serviceWorker`/`PushManager`/`Notification`, so the server snapshot is `false` and the block is absent from the HTML: it appears on the client only where it can actually work, with no flash of a control that then vanishes. A user-agent test would have been the assumption §28.5 warns about.

Refusals are stated, never silent. A browser-level block says so (*"Your browser is blocking notifications for Mellocrush"*) rather than flipping the switch back with no explanation, which is the one failure a toggle cannot express on its own.

## 42. Admin → Analytics (2026-09-22)

Built entirely from the existing admin kit — `AdminPage`, `Panel`, `StatCard`, `StatGrid`, `FilterLinks`, `DefinitionList` — so it reads as another admin screen rather than a dashboard product bolted on. No chart library, no client JavaScript: the charts are server-rendered HTML and CSS, on a screen that is read far more often than it is interacted with.

**Two single-series charts, never one with two axes.** Visitors and page views are different measures on different scales. Sharing an axis would make one of them a decoration; giving them separate axes in one frame is the classic way to imply a correlation the data does not contain. Two small multiples over the same x-axis let them be compared honestly, and each needs no legend because its own title names it. Colour carries no meaning here — a single series has nothing to be told apart from — so bars wear the brand accent and every number stays in ordinary text ink.

Empty buckets are drawn as a 2px stub rather than omitted: a chart built only from the buckets that exist compresses a quiet night out of the axis and makes traffic look continuous when it was not. The gaps are part of the answer.

Every chart carries a **View as table** disclosure holding the same numbers. A chart that a screen reader cannot read is half a chart, and the bars themselves are `aria-hidden` rather than announced as a meaningless list of values.

The screen ends with a plain-language **"What is and is not measured"** panel, and every stat carries a `hint` that says what it does *not* mean — that a person on two devices counts twice, that "Direct" includes every suppressed referrer, that conversion is approximate. A number without its caveat is the thing that gets misread in a meeting six weeks later.

## 43. Teaching the swipe, once (2026-09-23)

A dating app's whole interaction is one gesture, and nothing on the Discover screen said what it was. New members
met a photograph and a pair of buttons and had to guess that the card moves at all.

So on a member's first Discover, the **real card** leans a little way right with its LIKE stamp coming up, returns
to centre, leans left with PASS, and returns. Roughly four seconds, 750 ms after the first card is ready. It is not
a modal, an overlay or a coach-mark: it is the card itself, which is the only honest way to demonstrate a gesture.

**It cannot do anything.** `useSwipeGuide` (`src/components/features/discovery/swipe-guide.ts`) emits nothing but
numbers — an x offset and two opacities — and the deck renders them. Every route that can like, pass, spend an
allowance, make a match or advance the deck runs through `swipe()` → `commit()`, which the lesson never calls and
cannot reach. The furthest it leans is 84 px against a 110 px commit threshold, and a unit test holds those two
numbers apart.

**It yields instantly.** Pointer down, a key, or a control button calls `cancel()` before anything else in the
handler; the next render is already reading the member's own drag. The card snaps to the finger rather than
carrying the lean over into the gesture — deliberately, because an inherited 84 px offset would let a 30 px flick
cross the commit threshold, and a tutorial that likes somebody for you is worse than one that jumps.

**Stamps.** LIKE is green and PASS is coral, each carrying the icon its control button uses, so gesture and button
read as the same action. Green is the only second hue in Mellocrush and the exception is scoped: the stamps live on
a photograph, inside the `on-photo` family, for the half-second of a drag. App chrome stays single-hue.

Opacity is `stampOpacity(dx, direction)` — linear in distance over 90 px, clamped, signed so only one can ever show.
The same function serves the lesson and every real drag, so the demo is a true picture of the gesture.

**Reduced motion** gets the lesson without the movement: each stamp simply appears for a beat, then the other. The
card does not move. Screen readers were already told the whole thing by the card's own label ("Right arrow to like,
left arrow to pass"), so both stamps and the hint stay `aria-hidden` rather than narrating a transform.

**Once.** A `thundi.swipeGuideSeen` flag in localStorage, the same mechanism and prefix as the appearance choice.
No migration: a cleared storage or a second device replays a four-second animation, which is a cheaper failure than
a column on the members table. The flag is written when the lesson starts, so an interrupted run still counts.
