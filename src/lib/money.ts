/** Minor-unit money formatting. MVR has two decimals (laari); whole-rufiyaa prices print without them. */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const text = Number.isInteger(major) ? major.toString() : major.toFixed(2);
  return `${currency} ${text}`;
}
