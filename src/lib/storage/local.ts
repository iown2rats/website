/**
 * Development/test storage on local disk. Read URLs are HMAC-signed and served by /api/media, mirroring
 * the signed-URL model of the hosted provider so the rest of the app does not change between the two.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type StorageProvider } from "./provider";

export class LocalDiskStorageProvider implements StorageProvider {
  readonly id = "local";
  constructor(
    private readonly rootDir: string,
    private readonly secret: string,
    private readonly publicBasePath = "/api/media",
  ) {}

  private filePath(key: string): string {
    assertSafeKey(key);
    return path.join(this.rootDir, key);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    // Content type is not recorded on disk; the media route always serves WebP.
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => rm(this.filePath(k), { force: true })));
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.filePath(key)));
    } catch {
      return null;
    }
  }

  sign(key: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${key}|${exp}`).digest("base64url");
  }

  verify(key: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < now) return false;
    const expected = Buffer.from(this.sign(key, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.publicBasePath}/${encoded}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }
}
