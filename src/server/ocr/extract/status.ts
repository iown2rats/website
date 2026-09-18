/**
 * Whether the receipt says the money actually moved.
 *
 * MIB shows a finished transfer two ways: the slip saved at the time says "Success"; the same transfer pulled from
 * history later says "Processed". Both are done. The trap is on the same screen: MIB prints a "Processed Date" row,
 * so a naive search for "Processed" calls every MIB slip completed. A status is therefore only believed when a
 * Status label introduces it, or when it stands alone on its own line. "Processed" alone is still NOT payment
 * evidence: amount, currency and recipient are checked separately.
 */
import { normalizeOcrText } from "../text";
import type { TransactionStatus } from "../types";

export interface StatusMatch {
  status: TransactionStatus;
  /** The bank's own word, for display. */
  raw: string;
}

/** Ordered longest-phrase-first so "TRANSFER SUCCESSFUL" is read before "SUCCESS" can match part of it. */
const STATUS_WORDS: Array<{ words: RegExp; status: TransactionStatus }> = [
  { words: /^(TRANSFER |TRANSACTION )?SUCCESSFUL$/, status: "COMPLETED" },
  { words: /^SUCCESS$/, status: "COMPLETED" },
  { words: /^COMPLETED?$/, status: "COMPLETED" },
  // MIB's transaction history: a finished transfer, said differently.
  { words: /^PROCESSED$/, status: "COMPLETED" },
  { words: /^(FAILED|FAILURE|UNSUCCESSFUL|DECLINED|REJECTED|CANCELLED|REVERSED)$/, status: "FAILED" },
  { words: /^(PENDING|PROCESSING|IN PROGRESS|SUBMITTED|AWAITING.*|SCHEDULED)$/, status: "PENDING" },
];

function classify(phrase: string): StatusMatch | undefined {
  const cleaned = phrase.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const found = STATUS_WORDS.find((entry) => entry.words.test(cleaned));
  return found ? { status: found.status, raw: cleaned } : undefined;
}

/** A labelled status wins over a bare one: "Status Processed" is the bank telling us; a lone word could be anything. */
export function extractStatus(text: string): StatusMatch | undefined {
  const lines = normalizeOcrText(text).split("\n");
  let standalone: StatusMatch | undefined;
  for (const line of lines) {
    if (!line) continue;
    const labelled = /^(TRANSACTION |TRANSFER |PAYMENT )?STATUS\b[:\-\s]*(.+)$/.exec(line);
    if (labelled) {
      const found = classify(labelled[2]!);
      if (found) return found;
    }
    if (!standalone) standalone = classify(line);
  }
  return standalone;
}
