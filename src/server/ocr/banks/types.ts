import type { BankCode, ParsedReceipt } from "../types";

/**
 * One bank's receipt parser. Detection is separate from parsing so the registry can try each bank in turn and fall
 * back to the generic parser; adding a bank is one new file registered in ./index.ts.
 */
export interface BankParser {
  readonly code: BankCode;
  /** e.g. "bml-v1": stored with every result so a future parser change never pretends old readings used it. */
  readonly version: string;
  detect(normalizedText: string): boolean;
  parse(text: string): ParsedReceipt;
}
