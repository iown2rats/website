/**
 * Bank of Maldives. Layout modelled on real BML app receipts (as fixtured in the AVITO codebase): a headline amount
 * split over two lines ("150.00" / "MVR"), then labelled rows — Status, Message, Reference, Transaction date, From, To
 * (name, account on the next line), Amount, Remarks — and the bank name at the foot.
 *
 * Two BML specifics: the "Message" row says "Your request has been submitted for processing" even on a SUCCESS
 * receipt, so the Status row is the only word believed; and BML's "Reference" is the bank's transaction number, not
 * the customer's remark.
 */
import type { ParsedReceipt } from "../types";
import { parseCommon } from "./common";
import type { BankParser } from "./types";

export const BML_PARSER_VERSION = "bml-v1";

export const bmlParser: BankParser = {
  code: "BML",
  version: BML_PARSER_VERSION,
  detect(normalized) {
    return /BANK OF MALDIVES|(?<![A-Z])BML(?![A-Z])/.test(normalized);
  },
  parse(text): ParsedReceipt {
    const parsed = parseCommon(text, "BML", BML_PARSER_VERSION);
    // BML prints rufiyaa as MVR on the Amount row; a headline "150.00 / MVR" split over two lines leaves the amount
    // without a currency on its own line, so an MVR anywhere on the receipt settles it when nothing else did.
    if (parsed.amountMinor !== null && parsed.currency === null && /(?<![A-Z])MVR(?![A-Z])/.test(text.toUpperCase())) parsed.currency = "MVR";
    return parsed;
  },
};
