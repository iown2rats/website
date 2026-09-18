/**
 * Reading a receipt: the one call the billing layer makes. Deliberately incapable of failing loudly. An engine that
 * will not start, crashes or times out comes back as `scanned: false` ("we could not look"), which is never held
 * against the customer. A picture the engine DID read and found no text in is `scanned: true` with nothing parsed:
 * that is evidence about the picture (very likely not a receipt), and the verifier words it as such.
 *
 * Nothing here logs the text. The only diagnostics that leave this function are counts and booleans.
 */
import { parseReceiptText } from "./banks";
import { getOcrEngine, type OcrEngine } from "./engine";
import { prepareForOcr } from "./preprocess";
import type { NormalizedTransaction } from "./types";

export const OCR_LOG_PREFIX = "[ocr]";

export async function readReceipt(image: Uint8Array, options: { engine?: OcrEngine } = {}): Promise<NormalizedTransaction> {
  const engine = options.engine ?? getOcrEngine();
  const started = Date.now();
  try {
    const prepared = await prepareForOcr(image);
    const reading = await engine.recognize(prepared);
    const text = reading.text ?? "";
    const parsed = parseReceiptText(text);
    const durationMs = Date.now() - started;
    // Safe diagnostics only: which bank, whether fields parsed, how long. Never the receipt's contents.
    console.info(`${OCR_LOG_PREFIX} completed engine=${engine.name} ms=${durationMs} chars=${text.length} bank=${parsed.bank ?? "none"} status=${parsed.status} amountParsed=${parsed.amountMinor !== null} txnParsed=${parsed.transactionId !== null} accountParsed=${parsed.recipientAccount !== null}`);
    return { ...parsed, scanned: true, ocrConfidence: reading.confidence, engine: engine.name, durationMs };
  } catch (e) {
    const durationMs = Date.now() - started;
    console.warn(`${OCR_LOG_PREFIX} failed engine=${engine.name} ms=${durationMs} reason=${e instanceof Error ? e.name : "unknown"}`);
    return {
      bank: null,
      parserVersion: "none",
      status: "UNKNOWN",
      rawStatus: null,
      amountMinor: null,
      currency: null,
      transactionId: null,
      transactionDateRaw: null,
      transactionAt: null,
      senderName: null,
      recipientName: null,
      recipientAccount: null,
      remarks: null,
      thundiReference: null,
      scanned: false,
      ocrConfidence: null,
      engine: engine.name,
      durationMs,
    };
  }
}
