/**
 * Supabase Storage provider. Uses the server-only secret key; the browser only ever receives
 * short-lived signed read URLs. Requires a PRIVATE bucket (default `profile-photos`) to exist.
 *
 * Hosted setup still pending owner approval (Phase 5 §14/§27): create the private bucket, set
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, STORAGE_PROVIDER=supabase.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSafeKey, type StorageProvider } from "./provider";

export class SupabaseStorageProvider implements StorageProvider {
  readonly id = "supabase";
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string, private readonly bucket: string) {
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: false, cacheControl: "private, max-age=3600" });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    keys.forEach(assertSafeKey);
    const { error } = await this.client.storage.from(this.bucket).remove(keys);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  async getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, ttlSeconds);
    if (error || !data) throw new Error(`Storage sign failed: ${error?.message ?? "unknown"}`);
    return data.signedUrl;
  }
}
