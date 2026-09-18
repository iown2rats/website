/** Display formatting for operational screens. Dates render in Maldives time (UTC+5) so admins read local time. */
const TZ = "Indian/Maldives";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
}

/** "in 3 days" / "2 days ago" for expiry columns. */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const days = Math.round(Math.abs(diff) / 86_400_000);
  if (days === 0) return diff >= 0 ? "today" : "today";
  const unit = days === 1 ? "day" : "days";
  return diff >= 0 ? `in ${days} ${unit}` : `${days} ${unit} ago`;
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
