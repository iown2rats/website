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

/** What the bytes were meant to be; the message tells the person what to do instead in that context. */
export type UploadContext = "receipt" | "photo" | "selfie" | "cover";

const HEIC_FIX = "In Photos, share the picture as a JPEG (or set Camera → Formats → Most Compatible), then try again.";

export const UNSUPPORTED_MESSAGES: Record<UploadContext, Record<Exclude<UnsupportedKind, null>, string>> = {
  receipt: {
    pdf: "PDF receipts aren't supported. Take a screenshot of the receipt in your bank app and upload that instead.",
    heic: `HEIC photos aren't supported yet. ${HEIC_FIX}`,
  },
  photo: {
    pdf: "That file is a PDF, not a photo. Choose a JPEG, PNG or WebP picture instead.",
    heic: `HEIC photos aren't supported yet. ${HEIC_FIX}`,
  },
  selfie: {
    pdf: "That file is a PDF, not a photo. Choose a JPEG, PNG or WebP selfie instead.",
    heic: "HEIC photos aren't supported yet. Take the selfie with the camera button here, or share it as a JPEG, then try again.",
  },
  cover: {
    pdf: "That file is a PDF, not an image. Choose a JPG, PNG or WebP cover instead.",
    heic: `HEIC images aren't supported yet. ${HEIC_FIX}`,
  },
};

export function unsupportedMessage(kind: Exclude<UnsupportedKind, null>, context: UploadContext): string {
  return UNSUPPORTED_MESSAGES[context][kind];
}
