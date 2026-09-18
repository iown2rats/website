/**
 * Supabase Storage provider. Uses the server-only secret key; the browser only ever receives
 * short-lived signed read URLs. Requires a PRIVATE bucket (default `profile-photos`) to exist.
 *
 * Signing is an HTTP call to Supabase, and a screen can need dozens of URLs (every card × every photo, the side
 * panel, chat avatars). Callers already request them concurrently, so `getReadUrl` coalesces every request made in
 * the same tick into ONE `createSignedUrls` call, and remembers each URL for a short slice of its lifetime so the
 * same key asked twice in a warm function is not signed twice. The URLs handed out are always valid for at least
 * three quarters of the requested TTL.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSafeKey, type StorageProvider } from "./provider";

interface SignedUrlResult {
  path: string | null;
  signedUrl: string;
  error: string | null;
}

/** The slice of the storage client this provider uses; tests inject a fake. */
export interface SupabaseBucketClient {
  upload(key: string, data: Uint8Array, options: { contentType: string; upsert: boolean; cacheControl: string }): Promise<{ error: { message: string } | null }>;
  remove(keys: string[]): Promise<{ error: { message: string } | null }>;
  createSignedUrls(keys: string[], ttlSeconds: number): Promise<{ data: SignedUrlResult[] | null; error: { message: string } | null }>;
}

interface PendingSign {
  key: string;
  resolve: (url: string) => void;
  reject: (e: Error) => void;
}

/** Signed URLs are reused for at most this fraction of their TTL. */
const MEMO_FRACTION = 0.25;
const MEMO_MAX_MS = 5 * 60_000;
const MEMO_MAX_ENTRIES = 2_000;

export class SupabaseStorageProvider implements StorageProvider {
  readonly id = "supabase";
  private readonly bucketClient: SupabaseBucketClient;
  private readonly memo = new Map<string, { url: string; expiresAt: number }>();
  private queues = new Map<number, PendingSign[]>();
  private flushScheduled = false;

  constructor(url: string, secretKey: string, private readonly bucket: string, bucketClient?: SupabaseBucketClient) {
    if (bucketClient) {
      this.bucketClient = bucketClient;
    } else {
      const client: SupabaseClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
      this.bucketClient = client.storage.from(bucket) as unknown as SupabaseBucketClient;
    }
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { error } = await this.bucketClient.upload(key, data, { contentType, upsert: false, cacheControl: "private, max-age=3600" });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    keys.forEach(assertSafeKey);
    for (const k of keys) this.memo.delete(`${k}`);
    const { error } = await this.bucketClient.remove(keys);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const now = Date.now();
    const hit = this.memo.get(key);
    if (hit && hit.expiresAt > now) return Promise.resolve(hit.url);
    return new Promise<string>((resolve, reject) => {
      const queue = this.queues.get(ttlSeconds) ?? [];
      queue.push({ key, resolve, reject });
      this.queues.set(ttlSeconds, queue);
      if (!this.flushScheduled) {
        this.flushScheduled = true;
        // One tick later: every getReadUrl started by the same Promise.all has been queued by then.
        setTimeout(() => void this.flush(), 0);
      }
    });
  }

  private async flush(): Promise<void> {
    const batches = this.queues;
    this.queues = new Map();
    this.flushScheduled = false;
    await Promise.all([...batches.entries()].map(([ttl, pending]) => this.signBatch(ttl, pending)));
  }

  private async signBatch(ttlSeconds: number, pending: PendingSign[]): Promise<void> {
    const keys = [...new Set(pending.map((p) => p.key))];
    let byKey: Map<string, string>;
    try {
      const { data, error } = await this.bucketClient.createSignedUrls(keys, ttlSeconds);
      if (error || !data) throw new Error(`Storage sign failed: ${error?.message ?? "unknown"}`);
      byKey = new Map();
      data.forEach((r, i) => {
        // Supabase echoes `path` for successes; fall back to request order for clients that omit it.
        const key = r.path ?? keys[i]!;
        if (!r.error && r.signedUrl) byKey.set(key, r.signedUrl);
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      for (const p of pending) p.reject(err);
      return;
    }
    const memoFor = Math.min(ttlSeconds * 1000 * MEMO_FRACTION, MEMO_MAX_MS);
    const expiresAt = Date.now() + memoFor;
    for (const p of pending) {
      const url = byKey.get(p.key);
      if (!url) {
        p.reject(new Error(`Storage sign failed: no URL for key`));
        continue;
      }
      if (this.memo.size >= MEMO_MAX_ENTRIES) this.memo.clear();
      this.memo.set(p.key, { url, expiresAt });
      p.resolve(url);
    }
  }
}
