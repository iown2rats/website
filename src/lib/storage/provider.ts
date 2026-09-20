/**
 * Object storage abstraction (docs/ARCHITECTURE.md §6). Keys are user-scoped paths chosen by the server,
 * e.g. `profile-photos/<userId>/<photoId>/full.webp`, so one user can never address another's objects.
 */
export interface StorageProvider {
  readonly id: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /**
   * The bytes themselves, for the one case a signed URL cannot serve: the Welcome Screen cover, which is public,
   * cached immutably by its id and must not hand a stranger a credentialled URL. Null when the object is gone.
   */
  read(key: string): Promise<Uint8Array | null>;
  /** Short-lived URL a browser can load. Never a management URL, never a credential. */
  getReadUrl(key: string, ttlSeconds: number): Promise<string>;
}

export const PHOTO_URL_TTL_SECONDS = 3600;

export function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,255}$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Invalid storage key");
  }
}
