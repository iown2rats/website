/**
 * Sanitised receipt fixtures (docs/ARCHITECTURE.md §12.14). Line for line the layouts of real BML and MIB slips as
 * fixtured in the AVITO codebase — the split BML headline, MIB's unlabelled "MVR 260.00", the account on the line
 * below "To", the "Processed Date" trap — with invented names, accounts and transaction numbers. No real customer
 * receipt and no owner receipt is committed here. `renderReceipt` draws a fixture as a phone-sized PNG for the real
 * engine and for browser verification.
 */
import sharp from "sharp";

export const ORDER_REF = "THU-7K4P2M";
export const BML_ACCOUNT = "7701234567890";
export const MIB_ACCOUNT = "9001234567890";
export const HOLDER = "Mellocrush Pvt Ltd";

export const BML_SUCCESS = `Thank you. Your request has been submitted for processing.
199.00
MVR
Status SUCCESS
Message Thank you. Your request has been submitted for processing.
Reference BLAZ728811340921
Transaction date 18/09/2026 14:26
From AISHATH TEST
To MELLOCRUSH PVT LTD
${BML_ACCOUNT}
Amount MVR 199.00
Remarks ${ORDER_REF}
Bank of Maldives`;

export const BML_WRONG_AMOUNT = BML_SUCCESS.replace(/199\.00/g, "150.00");
export const BML_WRONG_RECIPIENT = BML_SUCCESS.replace(BML_ACCOUNT, "7709876543210").replace("To MELLOCRUSH PVT LTD", "To SOME OTHER SHOP");
export const BML_PENDING = BML_SUCCESS.replace("Status SUCCESS", "Status PENDING");
export const BML_FAILED = BML_SUCCESS.replace("Status SUCCESS", "Status FAILED").replace("Message Thank you. Your request has been submitted for processing.", "Message Insufficient funds");
export const BML_MISSING_REFERENCE = BML_SUCCESS.replace(`Remarks ${ORDER_REF}`, "Remarks N/A");
export const BML_WRONG_REFERENCE = BML_SUCCESS.replace(ORDER_REF, "THU-9XY2QF");
/** The same slip after a noisy scan: dropped punctuation, stray pipes, split label, unicode colon, lower case. */
export const BML_NOISY = `thank you. your request has been submitted for processing
199.00
MVR
Status ： SUCCESS
Message | Thank you. Your request has been submitted for processing.
Reference  BLAZ7288 11340921
Transaction date 18/09/2026  14:26
From  AISHATH TEST
To MELLOCRUSH  PVT LTD
${BML_ACCOUNT}
Amount  MVR199.00
Remarks  THU - 7K4P2M
Bank of Maldives`;

export const MIB_SUCCESS = `Aishath Test
Mellocrush Pvt Ltd
MVR 199.00
Success
Transaction# 91885003
From Aishath Test
To Mellocrush Pvt Ltd
${MIB_ACCOUNT}
Bank Maldives Islamic Bank
Transaction Type Quick Transfer
Transaction Date 2026-09-18 14:26:31
Processed Date 2026-09-18 14:26:31
Remarks ${ORDER_REF}
MALDIVES ISLAMIC BANK`;

/** The same transfer retrieved from MIB's transaction history days later. */
export const MIB_PROCESSED = `Maldives Islamic Bank
Transaction# 123456789
Status Processed
Amount MVR 199.00
From Aishath Test
To Mellocrush Pvt Ltd
${MIB_ACCOUNT}
Date 18 Sep 2026
Remarks ${ORDER_REF}`;

export const MIB_WRONG_AMOUNT = MIB_SUCCESS.replace("MVR 199.00", "MVR 150.00");
export const MIB_WRONG_RECIPIENT = MIB_SUCCESS.replace(MIB_ACCOUNT, "9009999999999").replace("To Mellocrush Pvt Ltd", "To Another Person");
/** A cropped screenshot: amount and status only. */
export const MIB_INCOMPLETE = `Aishath Test
Mellocrush Pvt Ltd
MVR 199.00
Success
MALDIVES ISLAMIC BANK`;
export const MIB_NO_TXN_ID = MIB_SUCCESS.replace("Transaction# 91885003\n", "");
export const MIB_USD = MIB_SUCCESS.replace("MVR 199.00", "USD 199.00");

/** Not a receipt at all. */
export const UNRELATED = `Sunset over the harbour
Dinner at 8?
See you there`;

export function renderReceipt(text: string, options: { width?: number; font?: number; background?: string; colour?: string } = {}): Promise<Buffer> {
  const width = options.width ?? 1170;
  const font = options.font ?? 38;
  const pad = 70;
  const lines = text.split("\n");
  const height = Math.max(600, pad * 2 + Math.round(lines.length * font * 1.9));
  const esc = (l: string) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${options.background ?? "#ffffff"}"/>${lines
    .map((l, i) => `<text x="${pad}" y="${pad + font + Math.round(i * font * 1.9)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${font}" fill="${options.colour ?? "#111111"}">${esc(l)}</text>`)
    .join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A photo that is not a receipt: flat colour with a shape, ≥ 400 px so the image pipeline accepts it. */
export function renderUnrelatedImage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#2a6f97"/><circle cx="450" cy="500" r="220" fill="#f4d35e"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
