/**
 * Password verifiers for EMAIL identities (docs/ARCHITECTURE.md §4.1b). Plaintext passwords are never stored,
 * logged or returned; only the verifier below is persisted.
 *
 * Algorithm: scrypt (RFC 7914) from Node's own crypto, memory-hard and listed by OWASP for password storage. Each
 * verifier carries its own parameters — `scrypt$N$r$p$<salt base64url>$<hash base64url>` — so the cost can be raised
 * later without invalidating anyone's password: `needsRehash` reports an out-of-date verifier and `verifyPassword`
 * tells the caller to re-hash on the next successful sign-in. A future move to Argon2id adds a second prefix and the
 * same transparent upgrade, so nothing here locks the project in.
 *
 * Cost: N = 2^16, r = 8, p = 1 is 64 MiB and a few hundred milliseconds per attempt — far above bcrypt cost 10 and
 * one notch below OWASP's headline N = 2^17, chosen so a sign-in stays responsive on a serverless function. Raising
 * it is a one-line change to PARAMS.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PASSWORD_RULES } from "@/lib/password-rules";

/** `promisify` picks scrypt's shortest overload, which has no options object, so wrap it explicitly. */
function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
}

export const PARAMS = { N: 2 ** 16, r: 8, p: 1, keyLength: 32, saltBytes: 16 } as const;
/** scrypt needs roughly 128 · N · r bytes; give it headroom so Node does not refuse the allocation. */
const MAX_MEM = 256 * 1024 * 1024;

export { PASSWORD_RULES };

export interface PasswordProblem {
  code: "TOO_SHORT" | "TOO_LONG" | "TOO_SIMPLE" | "COMMON";
  message: string;
}

/**
 * Deliberately modest rules (NIST SP 800-63B): length is what matters, so there is no character-class obstacle
 * course. Rejected: anything under 10 characters, a single repeated character, an obvious sequence, and a short list
 * of passwords that dominate every breach corpus.
 */
const COMMON = new Set([
  "password", "password1", "password123", "12345678910", "1234567890", "qwertyuiop", "qwerty123", "iloveyou",
  "letmein123", "welcome123", "admin123", "abc123456", "passw0rd", "p@ssw0rd", "mellocrush", "mellocrush1",
]);

export function validatePassword(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_RULES.minLength) return { code: "TOO_SHORT", message: `Use at least ${PASSWORD_RULES.minLength} characters.` };
  if (password.length > PASSWORD_RULES.maxLength) return { code: "TOO_LONG", message: `Use at most ${PASSWORD_RULES.maxLength} characters.` };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { code: "COMMON", message: "That password is too easy to guess. Try something only you would think of." };
  if (/^(.)\1+$/.test(password)) return { code: "TOO_SIMPLE", message: "That is one character repeated. Try something only you would think of." };
  if (/^(?:0123456789|1234567890|abcdefghij)/.test(lower)) return { code: "TOO_SIMPLE", message: "That is a keyboard sequence. Try something only you would think of." };
  return null;
}

const b64 = (b: Buffer) => b.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PARAMS.saltBytes);
  const key = await scrypt(password.normalize("NFKC"), salt, PARAMS.keyLength, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(key)}`;
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parse(verifier: string): Parsed | null {
  const parts = verifier.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const parsed = { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt, "base64url"), key: Buffer.from(key, "base64url") };
  if (!Number.isInteger(parsed.N) || !Number.isInteger(parsed.r) || !Number.isInteger(parsed.p)) return null;
  // Refuse absurd parameters from a tampered row rather than letting scrypt allocate against us.
  if (parsed.N < 2 ** 12 || parsed.N > 2 ** 20 || parsed.r < 1 || parsed.r > 32 || parsed.p < 1 || parsed.p > 16) return null;
  if (parsed.salt.length === 0 || parsed.key.length === 0) return null;
  return parsed;
}

export interface VerifyResult {
  ok: boolean;
  /** True when the stored verifier used weaker parameters than PARAMS: re-hash on a successful sign-in. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, verifier: string | null | undefined): Promise<VerifyResult> {
  if (!verifier) return { ok: false, needsRehash: false };
  const parsed = parse(verifier);
  if (!parsed) return { ok: false, needsRehash: false };
  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.key.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: MAX_MEM });
  } catch {
    return { ok: false, needsRehash: false };
  }
  const ok = derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
  return { ok, needsRehash: ok && needsRehash(verifier) };
}

export function needsRehash(verifier: string | null | undefined): boolean {
  const parsed = verifier ? parse(verifier) : null;
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p || parsed.key.length < PARAMS.keyLength;
}
