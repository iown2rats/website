/** Chat timestamps in the prototype's language: "10:12" today, "Yesterday", weekday within a week, else "12 Mar". */
export function chatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Under a bubble: time today, otherwise date + time. */
export function bubbleTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${chatTime(iso, now)} · ${hm}`;
}
