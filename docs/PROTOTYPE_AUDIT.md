# Mellocrush — Prototype Audit (Phase 1)

Status: complete. No prototype files were modified. This document is the reference the production build must be checked against.

## 1. Supplied files

| File | What it is | Verdict |
| --- | --- | --- |
| `Thundi.dc.html` (146 KB) | Claude Design source: one `<x-dc>` template (89 conditional blocks, 50 list renders, all inline styles) plus a `Component extends DCLogic` script holding all state and behaviour. | **Source of truth for UI and behaviour.** |
| `thundi-data.js` (6 KB) | ES module with demo profiles, likes, matches, chats, posts, islands, interests, prompts, report reasons and the "me" user. | **Source of truth for seed data.** |
| `support.js` (69 KB) | Generated dc-runtime (React 18.3.1 renderer for the template language). | Tooling only. Not part of the product. |
| `Thundi-standalone.dc.html` (350 KB) | Self-contained bundle of the two files above with React and Plus Jakarta Sans woff2 embedded. Template and logic are byte-for-byte equivalent to `Thundi.dc.html` after attribute normalisation. | Same revision. Useful offline reference. |
| `Thundi.html` (343 KB) | **Older revision.** Larger spacing (24 px gutters, 40 px hero heading, 30 px step titles), DD/MM/YYYY text inputs for DOB, horizontal "complete your profile" cards, no intro feature, no community empty state, no block-vs-pass distinction. | Superseded. Do not build from it. |
| `uploads/IMG_6916.png`, `uploads/IMG_6917.jpeg` | Phone screenshots (iPhone, claude.ai preview) of the **older** revision: DOB step with text fields, Profile with horizontal suggestion cards circled in red. | Feedback artefacts. The current design already replaced both (selects; vertical list). |
| `uploads/Screenshot 2026-09-17 at 17.54.14.png` | Wide-viewport render of the older DOB step. | Same. |
| `.thumbnail` | WebP thumbnail of the ocean/wave logo. | Brand mark reference. |

The current design is compact by intent: the revision history shows the author deliberately tightened paddings, type sizes and the profile suggestion list. Reproduce the compact revision.

Unmodified copies of the three source files are kept in `prototype/`. Rendered reference sheets (phone 390×844, desktop 1280×820, dark mode) produced from the prototype are in `docs/prototype-reference/`.

## 2. Product shape

- Positioning: "Meet someone closer to home. Dating for the Maldives. Private by design, 18+ only."
- Two routes: `onb` (welcome + 12 steps) and `app` (five tabs). Everything else is an overlay or sheet on top of the app frame.
- Frame: `position:fixed; inset:0`, no page scroll. Each screen scrolls internally.
- Breakpoint: `wide = innerWidth >= 900`. Below it is the phone layout with a floating bottom nav. At or above it is a three-column desktop layout.
- Theme: light and dark via `body[data-theme]`, toggled from the Profile header and the desktop sidebar. Persisted.
- Persistence in the prototype is `localStorage['thundi.v1']` (route, step, onboarding answers, swipes, likes, matches, chats, privacy, premium, filters, photos, prompts, notification prefs, plan, paused, introUsed). This is demo state only; nothing here may become the production source of truth.
- Demo-only props (Claude Design controls, not product features): `matchChance` (random match on like, default 40 %), `blurLikesYou` (default true), `forceWide`.

## 3. Screen inventory

Labels in bold are `data-screen-label` values from the source.

### 3.1 **Onboarding** (route `onb`)

Shared chrome for steps 1–12: back button (44×44, radius 14, bordered surface), 4 px progress bar (`--primary`, width = step/12, 350 ms ease), step label "n / 12" (12 px, 600, `--text2`). Title 24 px/800/−0.025em, subtitle 14 px `--text2`. Content column `max-width:520px`, padding `8px+safe-top 16px 12px+safe-bottom`. Primary CTA fixed at the bottom: 52 px, radius 16, `--primary` bg, `#063B4C` text, 16 px/700, opacity .45 when disabled, `scale(.97)` on press. Step content fades in (`fadeIn .3s`).

| Step | Title / subtitle | Content | Can continue when |
| --- | --- | --- | --- |
| 0 Welcome | "Meet someone closer to home." / "Dating for the Maldives. Private by design, 18+ only." | Full-bleed lagoon gradient (`hsl(186 60% 78%) → hsl(190 62% 52%) → #063B4C`), radial highlight, "LAGOON PHOTOGRAPH" placeholder, white wordmark + wave logo, 32 px hero, white "Get started" (52 px, radius 16, ocean text), ghost "I already have an account". | always |
| 1 Phone | "What's your number?" / "We'll text you a code. Maldivian numbers only." | Fixed `🇲🇻 +960` chip + `tel` input (52 px, radius 16, 18 px/700, tracking .04em, placeholder "7XX XXXX"), digits only, max 7. Note: "Your number is never shown on your profile. We use it to keep Mellocrush Maldives-only." | ≥ 7 digits |
| 2 OTP | "Enter the code" / "A 6-digit code was sent by SMS." | Six 52 px boxes (radius 14, 1.5 px border, active box `--primary` border), "Code sent to +960 … Resend" link, on-screen 3×4 keypad (48 px keys, radius 14, `--bg2`, ⌫). | 6 digits (any value in prototype) |
| 3 Name | "What's your name?" / "The name people will see." | Single input, note "Shown on your profile. You can't change it later." | trimmed length > 1 |
| 4 DOB | "When's your birthday?" / "Only your age is shown." | Three native `<select>`s (Day / Month / Year, years from currentYear−18 downward for 83 years), live line "You're N. That's what people will see." (`--primary-dark`) or "You must be 18 or older to use Thundi." (`#C0392B`), info callout (aqua-soft, ocean text): "Mellocrush is 18+ only. Your age is shown, your birthday isn't." | age ≥ 18 |
| 5 Gender | "How do you identify?" | Radio cards 52 px: Woman / Man / Prefer not to say. Selected = `--primary` border, `--aqua-soft` bg, filled dot. | chosen |
| 6 Meet | "Who would you like to meet?" / "You can change this any time." | Women / Men / Everyone. | chosen |
| 7 Intent | "What are you looking for?" / "Helps us show people who want the same thing." | Serious relationship / Dating / Marriage / Still figuring it out. | chosen |
| 8 Location | "Where are you based?" / "Choose your island or atoll — never an exact location." | Search field (56 px, radius 18) + list of first 6 matches (54 px rows, "Selected" in `--primary-dark`), note "Only your island or atoll is ever shown — never a distance. You can hide it entirely later." | island chosen |
| 9 Photos | "Add your photos" / "Up to 6. Drag to reorder later." | 3×2 grid of 3:4 tiles (radius 18, dashed border; first is "Main photo"), note "Add at least 2. Your face should be clearly visible in the first." | always in prototype (product rule: ≥ 2 photos, enforce in build) |
| 10 About | "About you" / "A little about you, and what you enjoy." | Bio textarea (3 rows, radius 18) + INTERESTS label + chip cloud (40 px pills, selected = aqua-soft bg, primary border, ocean text). | always (product rule elsewhere: up to 6 interests) |
| 11 Privacy | "Privacy first" / "Set up how private you want to be before anyone sees you." | Ocean card "Block my contacts" with shield icon and body "…Numbers are hashed on your device and never stored in plain text." + primary button "Allow access to contacts" ↔ "Contacts blocked ✓"; then toggles "Hide my location" (Show nothing instead of your island) and "Hide my age" (Others see only your name). | always |
| 12 Done | "You're ready, {name}." | Rippling teal check (88 px disc, two `ripple` rings), "Your profile is live. Everything you shared is only visible the way you chose." CTA "Start discovering". | always → route `app` |

Keyboard: none specific. Back button decrements the step; step 0 has no back.

### 3.2 **App** frame

- Tabs in order: Discover, Community, Likes, Chats, Profile. Icons are 22 px 2 px-stroke line icons (waves, people, heart, bubble, person).
- Badges: Likes = number of people who like you; Chats = total unread. Teal pill, ocean text, 800 weight.
- Phone: floating bottom nav, `left/right:16px`, `bottom:10px+safe`, 64 px tall, radius 32, glass background (`--glass` + 20 px blur), 1 px border, `--shadow-lg`, `max-width:480px` centred. Item: 48 px tall, min 56 px wide, radius 16, icon + 12 px label; active = `--aqua-soft` bg, `--text` colour, 700 label, ocean icon. Hidden while a conversation is open or any overlay is showing.
- Desktop (≥ 900): left sidebar 232 px (logo, nav rows 48 px radius 16 with trailing badge, "Dark appearance" toggle button pinned to bottom), `main` centred with `max-width:640px`, and on Discover only a right `aside` 300 px with "NEW MATCHES" avatar row (56 px, teal ring) and "ACTIVITY" feed (40 px avatar, bold name + action, time).
- Content padding: `calc(6px + safe-top) 16px 0`; scroll areas reserve `padding-bottom` 96–100 px for the nav.
- Section header: 48 px row, `h1` 26 px/800/−0.025em.

### 3.3 **Discover**

- Header: wave logo + "thundi" wordmark 22 px/800; right: Filters button 44×44 radius 14.
- Deck area: `max-width:500px`, `inset:0 0 80px` for cards, bottom margin `74px+safe` on phone so the nav never covers the controls.
- Next card: same size, `scale(.95 → 1)` as the top card is dragged (up to 150 px), `--shadow`.
- Top card: radius 26, `--shadow-lg`, `touch-action:none`, `cursor:grab`. Transform `translate(dx, dy) rotate(dx/18 deg)`; no transition while dragging, `transform .32s cubic-bezier(.2,.8,.2,1)` otherwise. Content: photo (placeholder "PHOTO n"), bottom gradient (55 % height, `rgba(6,20,26,0) → .78`), photo progress bars (3 px, 5 px gap, top 12 px), LIKE stamp (top-left, teal border/text, rotate −12°, opacity = dx/90) and PASS stamp (top-right, white, rotate 12°, opacity = −dx/90), name + age 28 px/800 with verified badge 20 px, location · occupation 15 px with pin icon, "Looking for {intent}" glass pill (30 px, `rgba(255,255,255,.16)` + 8 px blur), interest chips (28 px, `rgba(255,255,255,.92)` bg, ocean text 12.5 px/700).
- Gestures: drag right > 110 px → like; left < −110 px → pass; up > 120 px → open profile; otherwise spring back. Tap (movement < 8 px) on left 30 % → previous photo, right 30 % → next photo, centre → open full profile. Vertical drag is damped ×0.5 and −40 px lift on exit. Exit animates 600 px in 320 ms then commits.
- Keyboard: ArrowRight like, ArrowLeft pass, ArrowUp open profile (only on Discover with no overlay).
- Controls row (68 px, centred, 20 px gap): Pass 56 px white circle with X; Like 66 px teal gradient circle (`160deg #18C7C8→#079A9F`, shadow `0 12px 30px rgba(24,199,200,.4)`) with heart; Intro 48 px white circle with chat-plus icon and a "PLUS" tag (ocean bg, sand text 8.5 px); View profile 48 px white circle with person icon. All `scale(.92)` on press.
- Empty deck: dashed-border card with wave icon disc (72 px aqua-soft), "That's everyone for now.", "Check back later or adjust your preferences.", buttons "Adjust filters" (bordered) and "Reset demo deck" (primary; demo only, not a product feature).
- Filters sheet (see 3.10) opens from the header button.
- Behaviour: a like has a random chance to produce a match (demo). If the liked profile had a pending intro conversation, the match unlocks it and appends a demo reply.

### 3.4 **Full profile** overlay (z 30)

- Full-screen `--bg`, `max-width:640px` centred, `fadeIn .25s`.
- Hero: `height:min(70vh,560px)`, photo, bottom gradient, round white Back (top-left) and ⋯ (top-right) buttons 44 px, name + age 30 px/800 with 22 px verified badge, location 15 px.
- Body (padding 20 px 16 px, gap 20): "ABOUT ME" label (12 px/700 uppercase .08em) + bio 16 px; "Looking for {intent}" pill (40 px, aqua-soft, ocean, heart icon); prompt card (surface, radius 24, `--shadow`; prompt 13 px `--text2`, answer 19 px/700); second photo 320 px radius 22; info table (Occupation, Education, Location, Languages, Height, Looking for; rows 15 px, key `--text2`, value 600 right-aligned); "INTERESTS" chips (38 px, bordered); ocean prompt card (label `#8BE3DE`, answer white 19 px/700); third photo 320 px; footer text buttons "Report" and "Block".
- Floating actions (only when the viewed profile is the current top card): Pass 60 px, Intro 56 px, Like 66 px, at `bottom:18px+safe`.
- Opened from: card tap/swipe-up/ArrowUp, View-profile button, Likes grids, Matches grid, chat header, community avatar, Profile → Preview.

### 3.5 **Match** overlay (z 40)

Ocean full-screen, two 132×176 photo cards with 3 px white border rotated ∓8° (`popIn .5s`), two 420 px teal `ripple` rings, "It's a Match" 34 px/800, "You and {name} liked each other.", CTA "Say hello" (primary) → Chats with that conversation, "Keep swiping" (10 % white).

### 3.6 **Likes**

- Segmented control (bg2 track radius 18, 4 px padding; segments 42 px radius 14; active = surface bg + `--shadow`): "Likes You" / "Matches".
- Likes You, free user: ocean banner "{n} people like you / See who with Mellocrush Plus." with sand "Unlock" button (40 px, radius 14, `#D9C7A3`, ocean text); grid of 2 columns, 3:4 tiles radius 24, photo blurred 18 px, title "Someone" + verified badge, subtitle "Likes you"; tapping opens Membership.
- Likes You, Plus user: unblurred tiles with "Name, age" and island; tapping opens the full profile.
- Matches: same grid, unblurred, opens the profile. Empty: heart disc, "Your next match could be one swipe away.", "Start swiping".
- Rule (centralise in build): `blurLikes = !premium && blurLikesYou`.

### 3.7 **Chats** and **Conversation**

- List: header "Chats", search field (48 px, bg2, radius 16, "Search matches"; non-functional in prototype), "NEW MATCHES" horizontal row (64 px avatar with 2.5 px teal ring + 3 px padding, 12 px name) for matches without a conversation, then conversation rows (52 px avatar, name 16 px/700 + badge, last message 14 px with "You: " prefix and "Intro sent · " prefix when pending, time 12 px, unread pill). Unread rows show the preview in `--text` at 600. Row hover `--bg2`, radius 20.
- Empty: bubble disc, "Match with someone to start a conversation."
- Desktop: list column `max-width:360px` with right border, conversation fills the rest; placeholder "Select a conversation" when none is chosen.
- Conversation: glass header (56 px + safe-top, blur 16) with back (phone only), 40 px avatar, name + badge, island, ⋯ button (opens Report/Block/Unmatch sheet). System note pill centred ("You matched with {name}. Say hello." or "Your intro is waiting for {name}. They'll see it with your like."). Bubbles: max-width 78 %, padding 11 px 15 px, 15 px text, radius 20 with 6 px on the tail corner; mine = `--primary` bg + ocean text, theirs = `--aqua-soft` + `--text`; timestamp 11 px below. Composer: 44 px round "Add photo" button (bg2), 44 px input radius 22, 44 px teal send circle with up-arrow. Enter sends. Opening a conversation zeroes its unread count.
- Pending intro state: composer replaced by a locked footer "Intro sent. Chat unlocks when {name} likes you back." (note: this footer's inline flex wraps badly at 390 px in the prototype; fix in build while keeping the copy).
- Bottom nav is hidden while a conversation is open on phone.

### 3.8 **Send intro** sheet (z 45)

Header: 48 px avatar, "Send {name} an intro" 19 px/800, "Delivered with your like. They can reply once they like you back.", PLUS tag. Allowed state: their prompt + answer in a bg2 card, textarea (3 rows, max 140), quota line ("Your 1 free intro this week" / "Unlimited intros with Plus") and counter "n/140", CTA "Like & send intro" (opacity .45 until text). Locked state: ocean card "You've used your free intro this week / Free members get one intro a week. Mellocrush Plus includes unlimited intros — and yours are seen first.", "See Mellocrush Plus" (ocean/sand), "Just like instead" (bg2). Sending creates a pending conversation with the intro as the first message, consumes the weekly free intro for non-Plus users, then performs the like.

### 3.9 **Community**

- Header "Community", pill tabs For You / Following / New (38 px, active = ocean bg white text; the tabs do not filter in the prototype).
- Post card: radius 24, bordered surface, padding 18. Author row (44 px avatar button → profile, name 15 px/700 + badge, "{island} · {time}" 12.5 px, ⋯ → report sheet for the author). Optional "QUESTION" tag (24 px, aqua-soft, ocean, 11 px uppercase). Text 16 px. Optional photo 240 px radius 18. Action row: like (heart, count, toggles fill to `#18C7C8`), comments (count; no comment view in prototype), share (right-aligned; no-op).
- Empty: people disc, "Nothing here yet.", "Be the first to post something."
- FAB: 54 px ocean circle with plus at `right:20px; bottom:88px+safe`, `--shadow-lg`.
- New post sheet (z 35): "New post", kind toggle Text / Photo / Question (44 px), textarea in bg2 with kind-specific placeholder, footer "Posting as {island} · Community posts don't create matches", ocean "Post" button. Posting only toasts in the prototype.
- Blocked authors' posts disappear from the feed.

### 3.10 **Filters** sheet (z 35)

Bottom sheet, `max-width:560px`, radius 26 top, `max-height:88%`, `sheetIn .45s`, backdrop `rgba(6,59,76,.4)` + 4 px blur, drag handle 40×4. "Filters" 22 px/800 + "Reset" text button. Age range (two native range inputs 18–60, teal accent, label "22–34"); Show me: Women / Men / Everyone (44 px equal-width chips); Location: Anywhere in Maldives / Greater Malé / My atoll / Addu City; Looking for: Any / Serious relationship / Dating / Marriage / Still figuring it out; "PREMIUM · ADVANCED FILTERS" group (Education, Occupation, Interests, Height) with lock icons → Membership; CTA "Apply" (17 px). Defaults: 22–34, Women, Anywhere, Any. Filters are stored but not applied to the demo deck.

### 3.11 **Report** sheet (z 50)

Step 0 menu: Report / Block / Unmatch (red `#C0392B`, only when the target is a match) + "Cancel". Step 1: "Why are you reporting?", "Reports are anonymous. We'll review within 24 hours.", radio list of the eight reasons (Fake profile, Underage user, Harassment, Inappropriate content, Scam or financial request, Impersonation, Spam, Other), ocean "Submit report". Step 2: check disc, "Thanks for looking out", "They've been blocked and won't see your profile. Our team will review the report.", "Done". Closing after step 2 blocks the target. Block removes the user from deck, matches, chats and community; toast "Blocked. They can no longer see or contact you." Unmatch toast "Unmatched." Report-and-block toast "Report sent and profile blocked." Target = viewed profile, or the open conversation partner.

### 3.12 **Profile** tab

- Header "Profile" + appearance toggle (moon icon, 44 px).
- Completion ring 104 px (r 49, 4 px stroke, teal arc, 600 ms), avatar inside, ocean pill "{n}% complete". Name + age 22 px/800 with badge when verified, "Malé · Product Designer" 14 px.
- Buttons "Edit profile" (primary) and "Preview" (bordered), `max-width:380px`.
- "COMPLETE YOUR PROFILE" list (rows 56 px: aqua-soft point tile "+10/+15/+5", label, chevron): Answer a profile prompt (+10), Verify your profile (+15), Add interests (+10, when < 3), Add another photo (+5, always). Section hidden when no suggestions.
- Rows (60 px, radius 24 group): My Likes (count) → Likes You tab, My Matches (count) → Matches tab, Saved Posts → Community, Membership (Free/Plus) → Membership, Privacy & Safety, Verification (Unverified/Pending/Verified), Settings, Help & Support → Safety Center.
- "Replay onboarding" ghost link (demo).
- Completion formula in prototype: 55 + 10 (≥ 3 interests) + 10 (bio) + 15 (verified) + 10 (any prompt) — hardcoded base; production must compute from real fields.

### 3.13 Page overlays (z 30, `fadeIn .22s`)

Shared chrome: header 56 px + safe-top with back (44 px), title 19 px/800, optional "Save" (40 px primary). Body `max-width:640px` (900 px for Settings and Privacy on desktop). Settings on desktop gets a 220 px left section nav (Account, Notifications, Privacy, App, Support, Account management) and shows one group at a time.

**Edit profile** — pill tabs Photos / Info / About / Interests / Prompts (38 px, active ocean).
- Photos: "Up to 6 photos. Drag to reorder — the first is your main photo." 3-column grid; first tile spans 2×2 with "Main photo" badge; filled tiles have a remove ✕ (28 px dark circle); next empty tile reads "Add photo"; HTML5 drag-and-drop reorder.
- Info: rows Name (read-only), Date of birth (read-only), Gender, Location, Home island (Optional), Occupation, Education, Height (Optional). Note: "Name and date of birth can't be changed after verification. Home island is optional and never shown unless you allow it."
- About: bio textarea + Relationship intention radios.
- Interests: "Pick up to 6. n selected." chips.
- Prompts: "Choose up to 3 prompts and answer them in your own words." Accordion cards (54 px header; state "Answered"/"Add"; expands to a bg2 textarea). Max 3.
- Save closes and toasts "Profile saved".

**Privacy & Safety** — ocean notice ("You control exactly who sees you. Your phone number, email and exact location are never shown to anyone."); PROFILE VISIBILITY radios: Everyone ("Standard — shown to people who match your preferences"), Only people I like ("You're invisible until you like someone first"), Hidden ("Paused from Discover, chats still work"); toggles: Hide my location, Incognito mode ("Only people you like can see you"), Hide age, Hide active status ("No 'active now' indicator"), Read receipts (default on), Profile sharing (default on); "Block my contacts" card with ON/OFF badge and button ("Block my contacts" ↔ "Manage blocked contacts"), toast in demo "Contacts hashed on device · 214 hidden" (fake number, do not reproduce); links Blocked profiles (count), Verification, Safety Center; footnote "Screenshots can't be prevented on the web. Only share what you'd be comfortable seeing elsewhere."

**Settings** — groups and rows:
- Account: Personal information → Edit/Info; Phone number "+960 •••• 234" (masked, last 3); Email "Hidden from others"; Verification (status).
- Notifications toggles: Matches (on), Likes (on), Messages (on), Community (off), Marketing (off).
- Privacy: Profile visibility, Location visibility ("Island only"/"Hidden"), Blocked users (count), Blocked contacts (On/Off), Active status (Shown/Hidden) → all open Privacy.
- App: Language "English"; Appearance Light/Dark (toggles theme).
- Support: Help Center, Contact Support → Safety Center; Report a Problem, Terms, Privacy Policy (no-ops).
- Account management: Pause Dating (toast "Dating paused — you're hidden from Discover"), Log out (→ welcome), Delete Account (red; toast "Account deletion requires confirmation by SMS").
- Footer "Mellocrush 1.0 · Made in the Maldives".

**Membership (Mellocrush Plus)** — ocean hero with sand "MELLOCRUSH PLUS" tag, "More of what matters. Nothing you don't need.", "Dating on Mellocrush stays free. Plus adds a few quiet advantages." Perk list (36 px check tile): See who liked you, Unlimited likes ("No daily cap"), Rewind, Advanced filters, Incognito mode, Profile boost ("One boost a week"), Unlimited intros, Priority likes. Plans (3 cards, default 3 months selected): 1 month MVR 149/mo, 3 months MVR 119/mo, 12 months MVR 79/mo. CTA ocean/sand "Continue with Plus" ↔ "You're on Plus · Manage" (demo toggles premium instantly). Footer "Billed in MVR. Cancel any time. No upgrade prompts elsewhere in the app."

**Safety Center** — five accordion cards (numbered aqua tile, chevron rotates): Dating safely, Meeting someone, Protecting your privacy, Reporting someone, Community guidelines (copy in source); "Contact support" card ("Replies within 24 hours. In an emergency, call 119.", "Message support").

**Verification** — four states (`verify` 0–3): Get verified / Verify your phone / Take a selfie / You're verified, each with title, subtitle and 84 px badge disc (grey until verified, then aqua-soft with teal badge). Steps list: Verify phone number, Verify selfie ("A quick pose check, never shown publicly"), Profile review ("Our team checks your photos within 24 h"); each step shows ✓/number and Done/Next. State 1 shows a 3:4 dashed "Camera preview" with a dashed teal face oval. CTA: Start verification / Take selfie / Submit for review / Done. Demo advances instantly and toasts "Verified — badge added to your profile"; production must not fake this.

### 3.14 Toast

Ocean pill 44 px, radius 22, white 14 px/600, `--shadow-lg`, `popIn .3s`, centred at `bottom:90px+safe`, auto-dismiss 1.8 s, `role=status`. Messages used: Profile saved, Posted to Community, Blocked…, Unmatched., Report sent and profile blocked., Intro sent to {name}, Welcome to Mellocrush Plus / Plus cancelled, Dating paused… / Dating resumed, Contacts hashed…, Verified…, Account deletion requires confirmation by SMS.

## 4. Design system extracted from the source

### 4.1 Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#FCFDFC` | `#0B1518` | app background |
| `--bg2` | `#F5F7F5` | `#101D21` | inset fields, segmented track, keypad, subtle fills |
| `--surface` | `#FFFFFF` | `#132329` | cards, sheets, inputs |
| `--text` | `#101719` | `#F2F7F6` | primary text |
| `--text2` | `#667477` | `#8FA3A6` | muted text, inactive nav |
| `--border` | `#DFEBE9` | `#1F343B` | 1–1.5 px borders, progress track, toggle off |
| `--primary` | `#18C7C8` | same | lagoon turquoise: CTAs, like, active states, bubbles (mine) |
| `--primary-dark` | `#079A9F` | same | links, gradient end, secondary teal text |
| `--ocean` | `#063B4C` | same | deep ocean: text on teal, dark cards, match screen, toasts, FAB |
| `--aqua` | `#8BE3DE` | same | ripple rings, icon accent on ocean |
| `--aqua-soft` | `#E6F7F6` | `#12333A` | selected fills, callouts, bubbles (theirs), empty-state discs |
| `--green` | `#20B87A` | same | declared, unused (success) |
| `--sand` | `#D9C7A3` | same | Plus accents: tags, Unlock button, CTA text on ocean |
| `--glass` | `rgba(255,255,255,.78)` | `rgba(19,35,41,.82)` | bottom nav, chat header |
| `--shadow` | `0 8px 30px rgba(6,59,76,.08)` | `0 8px 30px rgba(0,0,0,.35)` | cards |
| `--shadow-lg` | `0 20px 60px rgba(6,59,76,.16)` | `0 20px 60px rgba(0,0,0,.5)` | top card, nav, FAB, toast |
| destructive (literal) | `#C0392B` | same | Unmatch, Delete Account, under-18 message |
| like glow (literal) | `0 12px 30px rgba(24,199,200,.4)` | | Like button |
| photo scrim | `rgba(6,20,26,0) → rgba(6,20,26,.72–.8)` | | card/hero gradients |
| overlay backdrop | `rgba(6,59,76,.4)` + `blur(4px)` | | sheets |

Add for production: `--destructive: #C0392B`, `--warning` (not present; propose sand-adjacent amber), `--success` = `--green`, `--on-primary: #063B4C`, `--callout-text` (see dark-mode issue below).

### 4.2 Typography

Plus Jakarta Sans, weights 400 (body), 500, 600 (labels, chips, buttons secondary), 700 (buttons, names, titles), 800 (display, headings, badges). System fallback `system-ui, sans-serif`. Antialiased.

| Role | Size / weight / tracking |
| --- | --- |
| Match display | 34 px / 800 / −0.03em / lh 1 |
| Welcome hero | 32 px / 800 / −0.03em / lh 1.08 |
| Full-profile name | 30 px / 800 / −0.025em |
| Card name | 28 px / 800 / −0.02em |
| Tab h1 | 26 px / 800 / −0.025em |
| Onboarding step title, Plus hero | 24 px / 800 / −0.025em / lh 1.15 |
| Sheet / page titles, wordmark, deck empty title, profile name, LIKE/PASS stamps | 22 px / 800 |
| Empty-state titles, plan price, OTP digit | 20 px / 800 |
| Prompt answers, intro title, page-overlay title | 19 px / 700–800 |
| Phone/name input | 18 px / 700 |
| Primary CTA large, match CTA | 17 px / 700 |
| Body, list names, bubbles(15), chips(14), meta(12.5–13), labels(12 uppercase .08em 700), timestamps 11 px, PLUS tag 8.5–10 px | — |

Line heights: 1.5 body, 1.55 long notes, 1.35 prompt answers, 1.4–1.45 bubbles. `text-wrap:pretty` on headings and post text.

### 4.3 Radius scale

2 (progress), 5–8 (tags), 10–12 (small tiles/icon buttons), 14 (icon buttons, segments, keypad, OTP), 16 (buttons, inputs, radio cards, nav items), 18 (photo tiles, textareas, callouts, search), 20 (list groups, bubbles, prompt cards), 22 (photo blocks, toast, likes banner), 24 (cards, post cards, ocean cards), 26 (deck card, sheet top corners), 32 (bottom nav), 999/50 % (pills, avatars, round buttons).

### 4.4 Spacing and sizing

- Gutter 16 px (phone content), 18–22 px card padding, 20–22 px section gaps, 8–10 px chip gaps, 12 px grid gaps, 14 px list-row gaps.
- Control heights: 52 px primary buttons/inputs/radio cards; 48–50 px secondary; 44 px icon buttons and composer; 40 px chips and small buttons; 38 px pill tabs; 36–38 px inline action buttons; 32×52 toggles (26 px knob, 3 px inset, travel 23 px); 20 px badge pills.
- Avatars: 40, 44, 48, 52, 56, 64 px; profile ring 104 px.
- Content max-widths: 520 (onboarding), 500 (deck), 480 (bottom nav), 560 (sheets), 640 (main/pages), 900 (settings/privacy desktop), 360 (desktop chat list), 380 (profile buttons), 232 sidebar, 300 aside, 220 settings side-nav.
- Safe areas: every fixed edge uses `env(safe-area-inset-*)`.

### 4.5 Motion

- `fadeIn` 8 px rise, 200–300 ms (screens, overlays, step content).
- `sheetIn` 40 px rise with 4 px overshoot, 450 ms `cubic-bezier(.2,.8,.2,1)` (bottom sheets).
- `popIn` scale .85→1.03→1, 300–500 ms (toast, match cards).
- `ripple` scale .6→2.2 fade, 2.4–3 s infinite (done step, match).
- Card: drag follows pointer with no transition; release/exit 320 ms `cubic-bezier(.2,.8,.2,1)`; next card scales .95→1 over the first 150 px.
- Press feedback `scale(.92–.97)` over 100–120 ms; toggles 200 ms; progress bar 350 ms; completion ring 600 ms; hover rows `--bg2` 150 ms.
- Reduced motion is not handled in the prototype; production must gate the ripples and card exit under `prefers-reduced-motion`.

### 4.6 Iconography

Inline SVG, 24-grid, 2–2.4 px round-capped strokes, 18–24 px rendered. Verified badge = 12-point teal seal with ocean check. Logo = wave path + small ellipse (island), `#18C7C8` / white.

## 5. Component inventory for the design system

Buttons: primary (teal/ocean text), ocean (ocean/white or ocean/sand for Plus), white-on-photo, bordered secondary, ghost, text link, icon button (bordered square 14, round white-on-photo, round bg2), round action buttons (56/60/66/48), FAB, keypad key, segmented control, pill tab, chip (selectable), radio card (with dot), toggle switch (52×32 and 44×26 variants), list row (with meta + chevron), list group, info callout, ocean card, notice card, empty state, badge pill, PLUS/PREMIUM/QUESTION tags, avatar (plain, ringed), completion ring, progress bar, OTP boxes, text field (52 px), search field, textarea, select (custom chevron), range slider, bottom sheet, page overlay with header, full-screen overlay, toast, profile card (deck), grid tile (3:4), post card, message bubble, composer, conversation row, new-match avatar, prompt card (light and ocean), info table, accordion card, plan card, perk row, verification step row, photo tile (3:4, dashed / filled / main).

## 6. Data model implied by the demo data

- Profile: id, name, age (derive from DOB), location (island/city/atoll string from the islands list), job, education, languages, optional height, bio, relationship intent (4 values), interests (3 shown; up to 6), one prompt + answer shown on card/profile (up to 3 prompts), verified flag, 1–3 photos (hue placeholders — real photos needed).
- Me: same plus 2 photos, unverified, completion suggestions.
- Likes-you list (4 ids), seeded matches (3 ids), conversations keyed by profile id with `[who, text, time]` messages, unread count, optional `pending` (intro).
- Community posts: author id, relative time, text, likes, comments, kind (text / photo / question), optional hue.
- Locations (33): Malé, Hulhumalé, Vilimalé, Addu City, Fuvahmulah, Kulhudhuffushi, Thinadhoo, Maafushi, Eydhafushi, Naifaru, Dhidhdhoo, Mahibadhoo, Funadhoo, Ungoofaaru, Veymandoo, and 18 atoll codes (HA, HDh, Sh, N, R, B, Lh, K, AA, ADh, V, M, F, Dh, Th, L, GA, GDh). Note: Gn. (Fuvahmulah) and S. (Addu) atolls are represented by their cities; the production location table should model atoll → island with the city rows above so "My atoll" and "Greater Malé" filters work.
- Interests (26), prompts (6), report reasons (8), gender options (3), meet options (3), intent options (4), visibility options (3), notification categories (5), plans (3), perks (8).

## 7. Behavioural rules captured from the logic

1. Under-18 blocks step 4 client-side with an explicit red message. Year list starts at currentYear − 18.
2. Phone: 7 digits after +960, digits only.
3. Like/pass remove the profile from the deck; `swiped` also records `block`. Blocked users vanish from deck, likes-you, matches, chats and community.
4. Match → match overlay → "Say hello" opens the conversation; new matches without messages appear in the "New matches" strip.
5. Intro: free users get one per week (`introUsed` flag), Plus unlimited; intro creates a pending conversation visible to the sender; chat unlocks on mutual like.
6. Likes You is blurred and anonymised for free users; tapping a blurred tile upsells.
7. Advanced filters are Plus-only; base filters are free.
8. Unmatch is only offered for current matches; Report ends with a block.
9. Profile completion suggestions drive the Edit sections and Verification.
10. Verification is a three-step state machine (phone → selfie → review) with a pending state visible in Profile and Settings.
11. Pause Dating hides the user from Discover but keeps chats; "Hidden" visibility does the same.
12. Theme persists; desktop toggle in sidebar, phone toggle in Profile header, also in Settings → App → Appearance.

## 8. Defects and gaps in the prototype to correct (without changing the design intent)

- **Dark-mode contrast bug:** callouts and pills that pair `--aqua-soft` background with `--ocean` text (DOB info callout, "Looking for" pill on the full profile, QUESTION tag, suggestion point tiles) become unreadable in dark mode because `--aqua-soft` turns near-black while `--ocean` stays dark. Fix with a `--on-aqua-soft` token that flips to `--aqua` in dark mode.
- Intro-locked chat footer wraps oddly at 390 px (inline text split across flex children). Keep the copy, render as one text node.
- Photos step and About step have no validation; the copy says "Add at least 2". Enforce ≥ 2 photos (and allow skipping bio/interests) server-side.
- Preview opens a demo profile (`p1`) instead of the user's own profile; production must render the user's real profile in the full-profile view.
- Report ⋯ on the conversation header targets the partner; on the full profile it targets the viewed profile. On the community post it sets `viewId` to the author, which leaks into other overlays; production should carry an explicit report target (user, post, or message).
- Chat search, community Following/New tabs, comments, share, Saved Posts, Add photo in chat, Terms/Privacy/Report a Problem rows, and Message support are non-functional placeholders. Community comments must become real per the brief; the others are out of Phase 1 scope but must not be silently removed (keep the entries, wire what is feasible, mark the rest "coming soon" server-side).
- No loading or error states exist anywhere (demo data is synchronous). Production adds skeletons in the same geometry (card 26 radius, row 52 avatars, grid 3:4 tiles) and error/offline states using the empty-state pattern.
- No `prefers-reduced-motion` handling; no focus-visible styles beyond browser defaults; toggles in Privacy use `role=switch` but onboarding toggles and Settings toggles do not; selects rely on native controls (fine).
- Age filter uses two independent range inputs; production should use an accessible dual-range component with the same look.
- All photos are hue gradients. The card design assumes portrait photos filling the card with a bottom scrim; the build must produce the same treatment with real images.
- Match is random; premium is a boolean toggle; verification advances on tap; "214 hidden" contacts count is invented. None of this may be reproduced as behaviour.

## 9. Responsive behaviour summary

| Width | Layout |
| --- | --- |
| < 900 px (375/390/430 targets) | Single column, floating bottom nav (hidden in conversation and overlays), deck `max-width:500px`, sheets full-width up to 560, full-profile up to 640, onboarding up to 520 centred. |
| ≥ 900 px | Sidebar 232 + main 640 (centred) + aside 300 on Discover. Chats become two-pane (360 + rest). Settings/Privacy widen to 900 with a 220 px section nav on Settings. Sheets stay bottom-anchored and centred (560). Onboarding stays 520 centred on the wide page. |

Tablet (768–899) uses the phone layout in the prototype; the build should keep that behaviour but may widen the deck column to the 500 px max and centre the nav.

## 10. Accessibility notes present in the prototype

`aria-label` on icon buttons (Back, Filters, Pass, Like, Send intro, View profile, Add photo, Send, Conversation options, Post options, Create post, Share, Remove photo, Toggle appearance, Hide my location/age), `role=group` on the card, `role=switch`/`aria-checked` on privacy toggles, `role=status` on the toast, `aria-hidden` on the next card, `<nav aria-label="Primary">`, semantic `header/main/section/article/aside/h1/h2`. Keyboard swipe alternatives exist (buttons + arrow keys). Production keeps all of these and adds focus rings, escape-to-close on sheets, and focus trapping.
