/**
 * Maldives Islamic Bank. Layout modelled on real MIB (FaisaMobile) receipts as fixtured in the AVITO codebase: sender
 * and recipient names as headings, the amount as an unlabelled "MVR 260.00" line, the status as a bare word
 * ("Success" on the saved slip, "Processed" in transaction history), "Transaction# 91885003", From / To with the account
 * on the line below "To", "Transaction Date" AND a "Processed Date" row that must never be read as a status, Remarks.
 */
import type { ParsedReceipt } from "../types";
import { parseCommon } from "./common";
import type { BankParser } from "./types";

export const MIB_PARSER_VERSION = "mib-v1";

export const mibParser: BankParser = {
  code: "MIB",
  version: MIB_PARSER_VERSION,
  detect(normalized) {
    return /MALDIVES ISLAMIC BANK|(?<![A-Z])MIB(?![A-Z])|FAISA ?MOBILE/.test(normalized);
  },
  parse(text): ParsedReceipt {
    return parseCommon(text, "MIB", MIB_PARSER_VERSION);
  },
};
