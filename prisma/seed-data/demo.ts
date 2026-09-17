/**
 * DEMO DATA — development only. Ported from prototype/thundi-data.js.
 * Never loaded when NODE_ENV=production (see prisma/seed.ts).
 * Photos are placeholder keys under demo/ with hue hints; the storage layer renders gradients for them.
 */

export interface DemoProfile {
  key: string;
  phone: string; // +960 7xx xxxx, reserved demo range
  name: string;
  gender: "WOMAN" | "MAN";
  interestedIn: "WOMEN" | "MEN" | "EVERYONE";
  age: number;
  location: string; // Location slug
  occupation: string;
  education: string;
  languages: string[];
  heightCm: number | null;
  intent: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT";
  interests: string[];
  bio: string;
  prompt: number; // PROMPTS index
  answer: string;
  hues: number[];
  verified: boolean;
}

const BLURHASHES = ["LKO2?U%2Tw=w]~RBVZRi};RPxuwH", "L6PZfSi_.AyE_3t7t7R**0o#DgR4", "LGF5]+Yk^6#M@-5c,1J5@[or[Q6."];
export const blurhashFor = (hue: number) => BLURHASHES[hue % BLURHASHES.length]!;

export const DEMO_PROFILES: DemoProfile[] = [
  { key: "p1", phone: "+9607000001", name: "Aishath", gender: "WOMAN", interestedIn: "MEN", age: 26, location: "male", occupation: "Marketing Executive", education: "Villa College", languages: ["Dhivehi", "English"], heightCm: 162, intent: "SERIOUS_RELATIONSHIP", interests: ["Travel", "Diving", "Coffee"], bio: "Malé born, lagoon raised. I plan trips I never take and take trips I never plan.", prompt: 0, answer: "A ferry to a quiet island, a book, and no signal until Sunday evening.", hues: [188, 200, 172], verified: true },
  { key: "p2", phone: "+9607000002", name: "Hassan", gender: "MAN", interestedIn: "WOMEN", age: 29, location: "hulhumale", occupation: "Software Engineer", education: "University of Malaysia", languages: ["Dhivehi", "English"], heightCm: 178, intent: "DATING", interests: ["Football", "Photography", "Cooking"], bio: "Building things by day, burning garudhiya by night.", prompt: 1, answer: "Bring good hedhikaa and a strong opinion about football.", hues: [205, 190, 215], verified: true },
  { key: "p3", phone: "+9607000003", name: "Mariyam", gender: "WOMAN", interestedIn: "MEN", age: 24, location: "addu-city", occupation: "Architecture Student", education: "MNU Faculty of Engineering", languages: ["Dhivehi", "English"], heightCm: null, intent: "FIGURING_OUT", interests: ["Sketching", "Cycling", "Film"], bio: "Drawing the Addu I want to live in.", prompt: 2, answer: "Why every island should have a proper cycling path.", hues: [168, 182, 195], verified: false },
  { key: "p4", phone: "+9607000004", name: "Ibrahim", gender: "MAN", interestedIn: "WOMEN", age: 31, location: "fuvahmulah", occupation: "Dive Instructor", education: "PADI Course Director", languages: ["Dhivehi", "English"], heightCm: 181, intent: "MARRIAGE", interests: ["Freediving", "Surfing", "Tea"], bio: "Tiger sharks are less scary than first dates.", prompt: 5, answer: "In the water before sunrise, or at the tea shop after.", hues: [180, 196, 210], verified: true },
  { key: "p5", phone: "+9607000005", name: "Fathimath", gender: "WOMAN", interestedIn: "MEN", age: 27, location: "atoll-b", occupation: "Resort HR Manager", education: "Cyryx College", languages: ["Dhivehi", "English"], heightCm: 158, intent: "SERIOUS_RELATIONSHIP", interests: ["Yoga", "Reading", "Baking"], bio: "Island life, city ambitions. Looking for someone steady.", prompt: 3, answer: "A long walk on the beach at dusk and a proper conversation.", hues: [195, 178, 165], verified: true },
  { key: "p6", phone: "+9607000006", name: "Ahmed", gender: "MAN", interestedIn: "WOMEN", age: 28, location: "male", occupation: "Graphic Designer", education: "Maldives Polytechnic", languages: ["Dhivehi", "English"], heightCm: 175, intent: "DATING", interests: ["Music", "Art", "Coffee"], bio: "Type nerd. Boduberu on weekends.", prompt: 4, answer: "I have sketched every mosque dome in Malé.", hues: [210, 185, 170], verified: true },
  { key: "p7", phone: "+9607000007", name: "Nashfa", gender: "WOMAN", interestedIn: "MEN", age: 25, location: "atoll-hdh", occupation: "Nurse", education: "MNU School of Nursing", languages: ["Dhivehi", "English"], heightCm: 160, intent: "MARRIAGE", interests: ["Gardening", "Swimming", "Poetry"], bio: "Night shifts and morning swims.", prompt: 0, answer: "Family lunch, then an afternoon in the garden with the radio on.", hues: [170, 188, 200], verified: true },
  { key: "p8", phone: "+9607000008", name: "Yoosuf", gender: "MAN", interestedIn: "WOMEN", age: 30, location: "vilimale", occupation: "Teacher", education: "University of Delhi", languages: ["Dhivehi", "English", "Hindi"], heightCm: 172, intent: "SERIOUS_RELATIONSHIP", interests: ["Chess", "Fishing", "History"], bio: "Teaching history, still learning patience.", prompt: 2, answer: "The maritime history of the Maldives and why it matters.", hues: [198, 176, 190], verified: false },
  { key: "p9", phone: "+9607000009", name: "Zara", gender: "WOMAN", interestedIn: "MEN", age: 23, location: "hulhumale", occupation: "Content Creator", education: "Villa College", languages: ["Dhivehi", "English"], heightCm: 165, intent: "FIGURING_OUT", interests: ["Vlogging", "Fashion", "Travel"], bio: "Making the islands look as good as they feel.", prompt: 1, answer: "Know a good local spot I haven't filmed yet.", hues: [178, 202, 186], verified: true },
  // The prototype's "me" user.
  { key: "me", phone: "+9607000010", name: "Ismail", gender: "MAN", interestedIn: "WOMEN", age: 27, location: "male", occupation: "Product Designer", education: "Villa College", languages: ["Dhivehi", "English"], heightCm: null, intent: "SERIOUS_RELATIONSHIP", interests: ["Coffee", "Diving", "Music"], bio: "Designing in Malé, dreaming in Baa.", prompt: 3, answer: "Somewhere with a view of the water and nowhere to be after.", hues: [192, 206], verified: false },
];

/** People who have liked "me" (Likes You tab). */
export const DEMO_LIKES_YOU = ["p2", "p5", "p6", "p9"];
/** Mutual matches with "me" and their conversations. */
export const DEMO_MATCHES = ["p1", "p4", "p7"];

export type DemoMessage = [who: "me" | "them", text: string, minutesAgo: number];
export const DEMO_CHATS: Record<string, DemoMessage[]> = {
  p1: [
    ["them", "Hey! Saw you dive too — where's your favourite site?", 300],
    ["me", "Maaya Thila, no contest. You?", 292],
    ["them", "Fish Head! We should compare notes sometime", 288],
    ["me", "Coffee this weekend?", 281],
  ],
  p4: [
    ["them", "Fuvahmulah has the best tea shops, I'll prove it", 1500],
    ["them", "Free next weekend?", 1499],
  ],
  p7: [
    ["me", "Loved your answer about the garden", 2000],
    ["them", "Thank you! Do you garden?", 1950],
  ],
};

/**
 * Community scenarios (Phase 8), keyed so the seed is idempotent. Authors are demo profile keys or discovery
 * scenario keys (prisma/seed-data/discovery-scenarios.ts). `state` exercises one feed rule each.
 */
export interface DemoCommunityPost {
  key: string;
  author: string;
  hoursAgo: number;
  kind: "TEXT" | "PHOTO" | "QUESTION";
  body: string;
  hue?: number;
  /** Photo moderation for PHOTO posts (default APPROVED). */
  photoModeration?: "PENDING" | "APPROVED" | "REJECTED";
  deleted?: boolean;
  comments?: { author: string; body: string; minutesAfter: number }[];
  /** Demo profile keys who liked the post ("me" included where relevant). */
  likedBy?: string[];
  /** "me" reported this post (evidence preserved, no block). */
  reportedByMe?: "SPAM" | "INAPPROPRIATE_CONTENT";
}

export const DEMO_COMMUNITY_POSTS: DemoCommunityPost[] = [
  { key: "cm-own", author: "me", hoursAgo: 1, kind: "TEXT", body: "Finally tried the new coffee place near Rasfannu. Flat white passes the test.", comments: [{ author: "p6", body: "The one with the blue chairs? Their croissants are the real win.", minutesAfter: 12 }, { author: "p1", body: "Adding to the weekend list ☕", minutesAfter: 40 }], likedBy: ["p1", "p6", "p9"] },
  { key: "cm-q1", author: "p1", hoursAgo: 3, kind: "QUESTION", body: "Question: is the 6:15 Villingili ferry still running on Fridays? Timetable online says one thing, the jetty says another.", comments: [{ author: "p8", body: "It runs, but it left at 6:25 last Friday.", minutesAfter: 30 }, { author: "me", body: "Left at 6:20 the week before. Aim for 6:10.", minutesAfter: 55 }], likedBy: ["me", "p8"] },
  { key: "cm-long", author: "p8", hoursAgo: 6, kind: "TEXT", body: "Long read for a Friday: I spent the week going through the old Malé maps in the national archive and it changes how you see the city. The eastern harbour used to be a lagoon you could wade across, the mosque at the centre was the only stone building for a century, and half the street names still point at families who moved to the atolls generations ago. If anyone wants to walk it one evening, I'll bring the photocopies and the tea. No experience needed, just comfortable sandals and patience for a history teacher who talks too much.", comments: [{ author: "p5", body: "Yes please. Sunday evening?", minutesAfter: 90 }], likedBy: ["me", "p1", "p5", "p9"] },
  { key: "cm-photo-nuha", author: "s-hidden-loc", hoursAgo: 9, kind: "PHOTO", body: "Lunch break view. Not saying where.", hue: 200, likedBy: ["p2"] },
  { key: "cm-pending-photo", author: "p5", hoursAgo: 11, kind: "PHOTO", body: "Baa Atoll from the seaplane this morning.", hue: 190, photoModeration: "PENDING", likedBy: ["p1"] },
  { key: "cm-blocked-author", author: "s-i-blocked", hoursAgo: 12, kind: "TEXT", body: "You should never see this post: its author is blocked by the demo viewer." },
  { key: "cm-blocked-me", author: "s-blocked-me", hoursAgo: 13, kind: "TEXT", body: "You should never see this post: its author blocked the demo viewer." },
  { key: "cm-suspended", author: "s-suspended", hoursAgo: 14, kind: "TEXT", body: "You should never see this post: its author is suspended." },
  { key: "cm-deleted", author: "p4", hoursAgo: 15, kind: "TEXT", body: "You should never see this post: it was deleted by its author.", deleted: true },
  { key: "cm-reported", author: "p9", hoursAgo: 16, kind: "TEXT", body: "Follow my other account for daily giveaways!! Link in bio.", reportedByMe: "SPAM" },
  { key: "cm-q2", author: "p6", hoursAgo: 20, kind: "QUESTION", body: "Question: anyone know a printer in Hulhumalé that does A2 posters same day?", comments: [{ author: "p9", body: "Novelty Printers, near the bus stop. Ask for Shafeeu.", minutesAfter: 25 }] },
  { key: "cm-old-1", author: "p3", hoursAgo: 30, kind: "TEXT", body: "Addu link road at golden hour is still the best cycling in the country. Change my mind.", likedBy: ["me"] },
  { key: "cm-old-2", author: "p2", hoursAgo: 40, kind: "TEXT", body: "Bridge sunrise crowd this morning was bigger than the sunrise." },
  { key: "cm-old-3", author: "p7", hoursAgo: 52, kind: "TEXT", body: "Night shift tip: the tea shop behind IGMH opens at 4am and the roshi is fresh." },
  { key: "cm-old-4", author: "p5", hoursAgo: 60, kind: "QUESTION", body: "Question: does anyone in B. Atoll run a book swap? Happy to start one on Eydhafushi." },
  { key: "cm-old-5", author: "p8", hoursAgo: 75, kind: "TEXT", body: "Marking exams with the sound of the boduberu practice next door. Not complaining." },
  { key: "cm-old-6", author: "p1", hoursAgo: 90, kind: "PHOTO", body: "Maaya Thila, 7am. Zero current, a hundred fish.", hue: 185, likedBy: ["me", "p4"] },
  // The four Phase 4 fixture posts, now persisted with real reactions and comments (counters are derived from rows).
  { key: "cm-bench", author: "p6", hoursAgo: 2, kind: "TEXT", body: "Anyone else think Malé needs more benches facing the sea? Just sat on a pipe for an hour.", likedBy: ["p1", "p2", "p3", "p5", "p7", "p8"], comments: [{ author: "p3", body: "The stretch by Rasfannu had some, until the last storm.", minutesAfter: 20 }, { author: "p7", body: "Pipe gang.", minutesAfter: 35 }] },
  { key: "cm-addu-ride", author: "p3", hoursAgo: 5, kind: "PHOTO", body: "Cycled the full Addu link road today. Legs gone, spirits high.", hue: 175, likedBy: ["me", "p1", "p2", "p6", "p8", "p9"], comments: [{ author: "p2", body: "Which direction? Hithadhoo to Gan is the one with the wind.", minutesAfter: 15 }] },
  { key: "cm-breakfast-q", author: "p9", hoursAgo: 8, kind: "QUESTION", body: "Question: best breakfast spot in Hulhumalé that opens before 7?", likedBy: ["p5", "p6"], comments: [{ author: "p6", body: "The tea shop opposite the ferry terminal. Mas huni by 6.", minutesAfter: 10 }, { author: "p5", body: "Second the ferry terminal one.", minutesAfter: 42 }, { author: "p1", body: "Nothing in the flats side opens before 7, sadly.", minutesAfter: 80 }] },
  { key: "cm-bridge-photo", author: "p2", hoursAgo: 24, kind: "PHOTO", body: "Sunrise from the Hulhumalé bridge never gets old.", hue: 25, likedBy: ["me", "p1", "p3", "p6", "p7", "p8", "p9"], comments: [{ author: "p8", body: "Was up there too, the 5:50 crowd.", minutesAfter: 30 }] },
];
