import { describe, expect, it } from "vitest";
import { formatLocalPhone, maskPhone, normalizeMaldivianPhone } from "@/server/auth/phone";

describe("Maldivian phone normalisation", () => {
  it("accepts every common way of writing the same number and yields one canonical form", () => {
    const forms = ["7771234", "777 1234", "777-1234", "+960 777 1234", "+9607771234", "9607771234", "00960 7771234", " (777) 1234 "];
    for (const f of forms) {
      const r = normalizeMaldivianPhone(f);
      expect(r.ok, f).toBe(true);
      if (r.ok) expect(r.e164).toBe("+9607771234");
    }
    const nine = normalizeMaldivianPhone("9123456");
    expect(nine.ok && nine.e164).toBe("+9609123456");
  });

  it("rejects invalid or non-Maldivian numbers", () => {
    expect(normalizeMaldivianPhone("").ok).toBe(false);
    expect(normalizeMaldivianPhone("123456").ok).toBe(false); // too short
    expect(normalizeMaldivianPhone("3771234").ok).toBe(false); // landline prefix
    expect(normalizeMaldivianPhone("77712345").ok).toBe(false); // 8 digits
    expect(normalizeMaldivianPhone("+44 7700 900123")).toMatchObject({ ok: false, reason: "NOT_MALDIVES" });
    expect(normalizeMaldivianPhone("+91 98765 43210")).toMatchObject({ ok: false, reason: "NOT_MALDIVES" });
    expect(normalizeMaldivianPhone("abc").ok).toBe(false);
  });

  it("formats for display and masks for settings", () => {
    expect(formatLocalPhone("+9607771234")).toBe("777 1234");
    expect(maskPhone("+9607771234")).toBe("+960 •••• 234");
  });
});
