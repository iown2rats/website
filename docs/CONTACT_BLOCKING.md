# Block My Contacts — design and security assumptions

The prototype promises: "People you block from your contacts won't be shown your dating profile, and you won't see theirs. Numbers are hashed on your device and never stored in plain text." This document defines how the production system honours that promise, what it cannot promise, and what must be true before it is implemented (Phase 10).

## 0. Phone is optional (Google-auth migration)

Sign-in is Google-only, so a user may have no phone number on file (`User.phoneE164` / `phoneHash` are nullable). The hashing and normalisation described below are unaffected and remain the contact-blocking mechanism. Direction "someone hides from me through my number" only works once the user has added their own number (a future optional Settings step); direction "I hide from numbers on my list" always works. Numbers are never verified by sign-in.

## 1. Goal

A user U can prevent people in their phone's address book from seeing U's dating profile, and U will not see theirs, without Mellocrush ever receiving U's address book in the clear.

## 2. What the web can and cannot do

- Browsers have no general address-book API. Chrome on Android exposes the Contact Picker API (`navigator.contacts.select`), which returns only contacts the user explicitly picks in a system dialog, one selection at a time. Safari and desktop browsers have no equivalent.
- Therefore the web app will **not** claim "Allow access to contacts" as a one-tap import. It will offer:
  1. On supporting browsers, the Contact Picker, so a user can select the specific people they want hidden from (explicitly a partial list).
  2. Manual entry of numbers to hide from (typed or pasted), hashed in the browser before submission.
  3. A clear statement that full address-book blocking is available in the Mellocrush mobile apps, which use the same backend.
- The backend, data model and matching query are built now so that native iOS/Android clients can upload full hashed contact lists later with no schema change.

## 3. Data model

```
ContactHash
  id           cuid
  userId       -> User        (owner who wants to hide from these numbers)
  hash         bytea(32)      HMAC-SHA-256(CONTACT_HASH_SALT, normalizedE164)
  source       enum PICKER | MANUAL | NATIVE_IMPORT
  createdAt
  @@unique([userId, hash])
  @@index([hash])

User
  phoneHash    bytea(32)      HMAC-SHA-256(CONTACT_HASH_SALT, own normalizedE164)   -- same keyed function
  @@index([phoneHash])

PrivacySettings.blockContacts  boolean
```

Visibility rule (part of the shared discovery predicate): viewer V does not see U, and U does not see V, if

```
(U.privacy.blockContacts AND EXISTS ContactHash(userId=U, hash=V.phoneHash))
OR
(V.privacy.blockContacts AND EXISTS ContactHash(userId=V, hash=U.phoneHash))
```

Both directions are hidden, matching the prototype copy. Turning the setting off keeps the stored hashes (so re-enabling is instant) but stops applying the rule; "Manage blocked contacts" lets the user delete all hashes.

## 4. Hashing scheme

- Normalisation happens on the device: strip spaces and punctuation, resolve local Maldivian formats (`7xxxxxx`, `9xxxxxx`, `960…`, `+960…`, `00960…`) to E.164 `+960XXXXXXX`; non-Maldivian numbers are normalised with their own country code where recognisable, otherwise dropped.
- Hash function: `HMAC-SHA-256` keyed with a server-provided **public** salt (`CONTACT_HASH_SALT`, delivered to the client at runtime, rotated only with a full re-hash migration). Using a keyed hash rather than plain SHA-256 means a leaked database of hashes cannot be checked against a precomputed rainbow table of the roughly 4 million possible Maldivian numbers **unless the salt is also known**.
- Honest limit: the salt is necessarily known to the client, so it is not a secret from an attacker who can run the app. The keyed hash raises the cost from "free precomputed table" to "one HMAC per candidate per salt", which for a 7-digit national space is trivially brute-forceable by anyone holding both the database and the salt. Hashing is therefore a **privacy** measure (Mellocrush does not store or see plaintext numbers, and a casual database read reveals nothing) and not a cryptographic guarantee against a motivated attacker with full database access. The UI copy will say "hashed on your device and never stored in plain text", which is true, and will not claim the hashes are unrecoverable.
- Mitigations that keep this honest and useful: hashes are stored in a table with no other personal data; the salt lives in the app environment, not in the database, so a database-only leak is insufficient; the same keyed function is used for `User.phoneHash`, so matching is an indexed equality join and no plaintext phone is ever compared.

## 5. Threats considered

| Threat | Position |
| --- | --- |
| Mellocrush staff or a database leak exposing users' contacts | No plaintext is stored. Hashes without the salt are not directly reversible; with the salt they are brute-forceable over the national number space (see 4). Contacts are not linked to names or other fields. |
| Membership inference: an attacker uploads hashes of target numbers to learn who is on Mellocrush | The system never tells the uploader which hashes matched; it only silently filters. Counts shown to the user ("n hidden") would be an oracle and are **not** shown; the prototype's "214 hidden" toast is not reproduced. Rate limits apply to uploads. |
| Reverse inference: a target learns they were blocked by someone specific | Filtering is symmetric and silent; no notification, no list of who blocked whom. |
| A user uploading someone else's contact list to hide them from others | A user can only hide themselves from numbers they upload; they cannot affect visibility between two other users. |
| Salt rotation | Requires all clients to re-hash; rotate only with a versioned `hashVersion` column and a grace period. Column is included from the start. |
| Storage of unnecessary data | Only hashes of numbers the user chose to hide from. Names, emails and non-phone fields from the picker are discarded on the device and never sent. |

## 6. API surface (Phase 10)

- `getContactHashSalt()` — returns the current salt and version to authenticated clients.
- `addContactHashes(actor, hashes[], source)` — validates 32-byte hashes, max 5000 per call and 20000 per user, dedupes, inserts.
- `clearContactHashes(actor)`.
- `setBlockContacts(actor, enabled)`.
- The discovery predicate consumes the table; no endpoint reveals matches.

Native clients will call the same actions with `source = NATIVE_IMPORT` after reading the address book locally.

## 7. What the UI says

Onboarding step 11 (built in Phase 5) keeps the prototype's ocean card, title and body text. Its button, "Turn on contact blocking" / "Contact blocking on ✓", records `PrivacySettings.blockContacts` and nothing else; a second line states plainly: "Full address-book blocking is available in the Mellocrush app. On the web you can add numbers to hide from later in Privacy & Safety." There is no fake permission dialog and no fabricated count. Phase 10 adds the Privacy & Safety screen with "Choose contacts to hide from" on browsers that support the Contact Picker API and "Add numbers to hide from" elsewhere, hashing on the device as described in §4.
