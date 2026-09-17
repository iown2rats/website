import path from "node:path";
import { getEnv } from "@/lib/env";
import { LocalDiskStorageProvider } from "./local";
import type { StorageProvider } from "./provider";
import { SupabaseStorageProvider } from "./supabase";

export type { StorageProvider } from "./provider";
export { PHOTO_URL_TTL_SECONDS } from "./provider";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "supabase") {
    cached = new SupabaseStorageProvider(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, env.SUPABASE_STORAGE_BUCKET_PHOTOS);
  } else {
    cached = new LocalDiskStorageProvider(path.resolve(env.LOCAL_STORAGE_DIR), env.SESSION_SECRET);
  }
  return cached;
}

/** The local provider is the only one that serves bytes itself (via /api/media). */
export function getLocalStorageProvider(): LocalDiskStorageProvider | null {
  const provider = getStorageProvider();
  return provider instanceof LocalDiskStorageProvider ? provider : null;
}
