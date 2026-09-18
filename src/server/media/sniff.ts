/**
 * Formats we recognise but do not accept, so the customer gets an accurate message instead of an unexplained failure.
 * sharp sniffs the real type of everything else; the browser's MIME type is never trusted.
 */
export type UnsupportedKind = "pdf" | "heic" | null;

export function sniffUnsupported(bytes: Uint8Array): UnsupportedKind {
  if (bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes.byteLength >= 12) {
    const box = String.fromCharCode(...bytes.subarray(4, 12));
    if (box.startsWith("ftyp")) {
      const brand = box.slice(4);
      if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return "heic";
    }
  }
  return null;
}

export const UNSUPPORTED_MESSAGES: Record<Exclude<UnsupportedKind, null>, string> = {
  pdf: "PDF receipts aren't supported. Take a screenshot of the receipt in your bank app and upload that instead.",
  heic: "HEIC photos aren't supported yet. Take a screenshot of the receipt, or share the photo as a JPEG, then try again.",
};
