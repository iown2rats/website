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

export const DEMO_POSTS = [
  { author: "p6", hoursAgo: 2, kind: "TEXT" as const, body: "Anyone else think Malé needs more benches facing the sea? Just sat on a pipe for an hour.", likes: 48, comments: 12 },
  { author: "p3", hoursAgo: 5, kind: "PHOTO" as const, body: "Cycled the full Addu link road today. Legs gone, spirits high.", likes: 126, comments: 31, hue: 175 },
  { author: "p9", hoursAgo: 8, kind: "QUESTION" as const, body: "Question: best breakfast spot in Hulhumalé that opens before 7?", likes: 22, comments: 40 },
  { author: "p2", hoursAgo: 24, kind: "PHOTO" as const, body: "Sunrise from the Hulhumalé bridge never gets old.", likes: 210, comments: 18, hue: 25 },
];
