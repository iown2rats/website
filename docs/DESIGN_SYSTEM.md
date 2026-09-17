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
