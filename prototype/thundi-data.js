const P = (id, name, age, loc, job, intent, interests, bio, prompt, answer, hues, verified = true, edu = 'Maldives National University', langs = 'Dhivehi, English', height = '') => ({
  id, name, age, loc, job, intent, interests, bio, prompt, answer, hues, verified, edu, langs, height,
  photos: hues.map((h, i) => ({ h, i }))
});
export const profiles = [
  P('p1', 'Aishath', 26, 'Malé', 'Marketing Executive', 'Serious relationship', ['Travel', 'Diving', 'Coffee'], 'Malé born, lagoon raised. I plan trips I never take and take trips I never plan.', 'My perfect weekend...', 'A ferry to a quiet island, a book, and no signal until Sunday evening.', [188, 200, 172], true, 'Villa College', 'Dhivehi, English', '162 cm'),
  P('p2', 'Hassan', 29, 'Hulhumalé', 'Software Engineer', 'Dating', ['Football', 'Photography', 'Cooking'], 'Building things by day, burning garudhiya by night.', 'The quickest way to win me over...', 'Bring good hedhikaa and a strong opinion about football.', [205, 190, 215], true, 'University of Malaysia', 'Dhivehi, English', '178 cm'),
  P('p3', 'Mariyam', 24, 'Addu City', 'Architecture Student', 'Still figuring it out', ['Sketching', 'Cycling', 'Film'], 'Drawing the Addu I want to live in.', 'Something I could talk about for hours...', 'Why every island should have a proper cycling path.', [168, 182, 195], false, 'MNU Faculty of Engineering', 'Dhivehi, English', ''),
  P('p4', 'Ibrahim', 31, 'Fuvahmulah', 'Dive Instructor', 'Marriage', ['Freediving', 'Surfing', 'Tea'], 'Tiger sharks are less scary than first dates.', 'You\'ll usually find me...', 'In the water before sunrise, or at the tea shop after.', [180, 196, 210], true, 'PADI Course Director', 'Dhivehi, English', '181 cm'),
  P('p5', 'Fathimath', 27, 'B. Atoll', 'Resort HR Manager', 'Serious relationship', ['Yoga', 'Reading', 'Baking'], 'Island life, city ambitions. Looking for someone steady.', 'My ideal first date...', 'A long walk on the beach at dusk and a proper conversation.', [195, 178, 165], true, 'Cyryx College', 'Dhivehi, English', '158 cm'),
  P('p6', 'Ahmed', 28, 'Malé', 'Graphic Designer', 'Dating', ['Music', 'Art', 'Coffee'], 'Type nerd. Boduberu on weekends.', 'A random fact about me...', 'I have sketched every mosque dome in Malé.', [210, 185, 170], true, 'Maldives Polytechnic', 'Dhivehi, English', '175 cm'),
  P('p7', 'Nashfa', 25, 'HDh. Atoll', 'Nurse', 'Marriage', ['Gardening', 'Swimming', 'Poetry'], 'Night shifts and morning swims.', 'My perfect weekend...', 'Family lunch, then an afternoon in the garden with the radio on.', [170, 188, 200], true, 'MNU School of Nursing', 'Dhivehi, English', '160 cm'),
  P('p8', 'Yoosuf', 30, 'Vilimalé', 'Teacher', 'Serious relationship', ['Chess', 'Fishing', 'History'], 'Teaching history, still learning patience.', 'Something I could talk about for hours...', 'The maritime history of the Maldives and why it matters.', [198, 176, 190], false, 'University of Delhi', 'Dhivehi, English, Hindi', '172 cm'),
  P('p9', 'Zara', 23, 'Hulhumalé', 'Content Creator', 'Still figuring it out', ['Vlogging', 'Fashion', 'Travel'], 'Making the islands look as good as they feel.', 'The quickest way to win me over...', 'Know a good local spot I haven\'t filmed yet.', [178, 202, 186], true, 'Villa College', 'Dhivehi, English', '165 cm'),
];
export const likesYou = ['p2', 'p5', 'p6', 'p9'];
export const seededMatches = ['p1', 'p4', 'p7'];
export const chats = [
  { id: 'p1', msgs: [['them', 'Hey! Saw you dive too — where\'s your favourite site?', '10:12'], ['me', 'Maaya Thila, no contest. You?', '10:20'], ['them', 'Fish Head! We should compare notes sometime', '10:24'], ['me', 'Coffee this weekend?', '10:31']], time: '10:31', unread: 0 },
  { id: 'p4', msgs: [['them', 'Fuvahmulah has the best tea shops, I\'ll prove it', '9:02'], ['them', 'Free next weekend?', '9:03']], time: '9:03', unread: 2 },
  { id: 'p7', msgs: [['me', 'Loved your answer about the garden', 'Yesterday'], ['them', 'Thank you! Do you garden?', 'Yesterday']], time: 'Yesterday', unread: 1 },
];
export const posts = [
  { id: 'c1', pid: 'p6', time: '2h', text: 'Anyone else think Malé needs more benches facing the sea? Just sat on a pipe for an hour.', likes: 48, comments: 12, kind: 'text' },
  { id: 'c2', pid: 'p3', time: '5h', text: 'Cycled the full Addu link road today. Legs gone, spirits high.', likes: 126, comments: 31, kind: 'photo', hue: 175 },
  { id: 'c3', pid: 'p9', time: '8h', text: 'Question: best breakfast spot in Hulhumalé that opens before 7?', likes: 22, comments: 40, kind: 'question' },
  { id: 'c4', pid: 'p2', time: '1d', text: 'Sunrise from the Hulhumalé bridge never gets old.', likes: 210, comments: 18, kind: 'photo', hue: 25 },
];
export const islands = ['Malé', 'Hulhumalé', 'Vilimalé', 'Addu City', 'Fuvahmulah', 'Kulhudhuffushi', 'Thinadhoo', 'Maafushi', 'Eydhafushi', 'Naifaru', 'Dhidhdhoo', 'Mahibadhoo', 'Funadhoo', 'Ungoofaaru', 'Veymandoo', 'HA. Atoll', 'HDh. Atoll', 'Sh. Atoll', 'N. Atoll', 'R. Atoll', 'B. Atoll', 'Lh. Atoll', 'K. Atoll', 'AA. Atoll', 'ADh. Atoll', 'V. Atoll', 'M. Atoll', 'F. Atoll', 'Dh. Atoll', 'Th. Atoll', 'L. Atoll', 'GA. Atoll', 'GDh. Atoll'];
export const interestsAll = ['Travel', 'Diving', 'Coffee', 'Football', 'Photography', 'Cooking', 'Sketching', 'Cycling', 'Film', 'Freediving', 'Surfing', 'Tea', 'Yoga', 'Reading', 'Baking', 'Music', 'Art', 'Gardening', 'Swimming', 'Poetry', 'Chess', 'Fishing', 'History', 'Fashion', 'Boduberu', 'Gaming'];
export const promptsAll = ['My perfect weekend...', 'The quickest way to win me over...', 'Something I could talk about for hours...', 'My ideal first date...', 'A random fact about me...', 'You\'ll usually find me...'];
export const reportReasons = ['Fake profile', 'Underage user', 'Harassment', 'Inappropriate content', 'Scam or financial request', 'Impersonation', 'Spam', 'Other'];
export const me = { name: 'Ismail', age: 27, loc: 'Malé', job: 'Product Designer', edu: 'Villa College', bio: 'Designing in Malé, dreaming in Baa.', intent: 'Serious relationship', interests: ['Coffee', 'Diving', 'Music'], hues: [192, 206], verified: false };
