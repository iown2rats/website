export type ClassValue = string | number | null | false | undefined | ClassValue[] | Record<string, boolean | null | undefined>;

/** Minimal class-name combiner (clsx-compatible subset). */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string" || typeof input === "number") out.push(String(input));
    else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    } else for (const [k, v] of Object.entries(input)) if (v) out.push(k);
  }
  return out.join(" ");
}
