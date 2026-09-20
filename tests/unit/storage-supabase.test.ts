/**
 * Supabase storage provider: signed URLs requested in the same tick are coalesced into one createSignedUrls call,
 * duplicates are signed once, results are remembered for a slice of their TTL, and failures reject every waiter.
 */
import { describe, expect, it, vi } from "vitest";
import { SupabaseStorageProvider, type SupabaseBucketClient } from "@/lib/storage/supabase";

function fakeClient(o: { fail?: boolean; omitPath?: boolean } = {}) {
  const calls: { keys: string[]; ttl: number }[] = [];
  const client: SupabaseBucketClient = {
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
    download: async () => ({ data: null, error: null }),
    createSignedUrls: async (keys, ttl) => {
      calls.push({ keys, ttl });
      if (o.fail) return { data: null, error: { message: "boom" } };
      return { data: keys.map((k) => ({ path: o.omitPath ? null : k, signedUrl: `https://x.supabase.co/sign/${k}?token=${ttl}`, error: null })), error: null };
    },
  };
  return { client, calls };
}

describe("SupabaseStorageProvider signed URLs", () => {
  it("coalesces concurrent requests into one batch per TTL, signs duplicate keys once and maps results back by key", async () => {
    const { client, calls } = fakeClient();
    const p = new SupabaseStorageProvider("https://x.supabase.co", "secret", "profile-photos", client);
    const urls = await Promise.all([
      p.getReadUrl("profile-photos/a/1/thumb.webp", 3600),
      p.getReadUrl("profile-photos/b/2/thumb.webp", 3600),
      p.getReadUrl("profile-photos/a/1/thumb.webp", 3600),
      p.getReadUrl("profile-photos/c/3/full.webp", 300),
    ]);
    expect(urls[0]).toBe("https://x.supabase.co/sign/profile-photos/a/1/thumb.webp?token=3600");
    expect(urls[1]).toBe("https://x.supabase.co/sign/profile-photos/b/2/thumb.webp?token=3600");
    expect(urls[2]).toBe(urls[0]);
    expect(urls[3]).toBe("https://x.supabase.co/sign/profile-photos/c/3/full.webp?token=300");
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.ttl === 3600)?.keys).toEqual(["profile-photos/a/1/thumb.webp", "profile-photos/b/2/thumb.webp"]);
    expect(calls.find((c) => c.ttl === 300)?.keys).toEqual(["profile-photos/c/3/full.webp"]);
  });

  it("remembers a signed URL for a quarter of its TTL and re-signs after that", async () => {
    vi.useFakeTimers();
    try {
      const { client, calls } = fakeClient();
      const p = new SupabaseStorageProvider("https://x.supabase.co", "secret", "profile-photos", client);
      const first = p.getReadUrl("profile-photos/a/1/thumb.webp", 3600);
      await vi.advanceTimersByTimeAsync(1);
      await first;
      expect(await p.getReadUrl("profile-photos/a/1/thumb.webp", 3600)).toBe(await first);
      expect(calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
      const again = p.getReadUrl("profile-photos/a/1/thumb.webp", 3600);
      await vi.advanceTimersByTimeAsync(1);
      await again;
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to request order when the client omits paths, rejects every waiter on failure, and refuses unsafe keys", async () => {
    const noPath = fakeClient({ omitPath: true });
    const p1 = new SupabaseStorageProvider("https://x.supabase.co", "secret", "b", noPath.client);
    expect(await Promise.all([p1.getReadUrl("k/1.webp", 60), p1.getReadUrl("k/2.webp", 60)])).toEqual(["https://x.supabase.co/sign/k/1.webp?token=60", "https://x.supabase.co/sign/k/2.webp?token=60"]);
    const failing = fakeClient({ fail: true });
    const p2 = new SupabaseStorageProvider("https://x.supabase.co", "secret", "b", failing.client);
    const results = await Promise.allSettled([p2.getReadUrl("k/1.webp", 60), p2.getReadUrl("k/2.webp", 60)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(failing.calls).toHaveLength(1);
    expect(() => p2.getReadUrl("../etc/passwd", 60)).toThrow(/Invalid storage key/);
  });
});
