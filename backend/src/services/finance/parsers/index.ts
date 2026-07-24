import type { ImportChannel, ImportEntry } from "../types.js";
import { detectChannel } from "./detect.js";
import { parseAlipay } from "./alipay.js";
import { parseWechat } from "./wechat.js";
import { parseJd } from "./jd.js";
import {
  parseIcbcCreditEml,
  parseCmbCreditEml,
  parseCgbCreditEml,
  parseCmbDebitPdf,
  parseCmbDebitTxt,
  parseBocomDebitPdf,
  parseIcbcDebitPdf,
  parseCcbDebitXls,
} from "./bank.js";

export { detectChannel };

export async function parseBill(
  buffer: Buffer,
  fileName: string,
  channelOverride?: ImportChannel | null,
): Promise<{ channel: ImportChannel; detectConfidence: number; entries: ImportEntry[] }> {
  let channel = channelOverride || "unknown";
  let detectConfidence = 1;
  if (!channelOverride || channelOverride === "unknown") {
    const d = detectChannel(fileName, buffer);
    channel = d.channel;
    detectConfidence = d.confidence;
  }

  if (channel === "unknown") {
    return { channel, detectConfidence: 0, entries: [] };
  }

  let entries: ImportEntry[] = [];
  switch (channel) {
    case "alipay":
      entries = parseAlipay(buffer);
      break;
    case "wechat":
      entries = parseWechat(buffer, fileName);
      break;
    case "jd":
      entries = parseJd(buffer);
      break;
    case "icbc_credit_eml":
      entries = parseIcbcCreditEml(buffer);
      break;
    case "cmb_credit_eml":
      entries = parseCmbCreditEml(buffer);
      break;
    case "cgb_credit_eml":
      entries = parseCgbCreditEml(buffer);
      break;
    case "cmb_debit_pdf":
      entries = await parseCmbDebitPdf(buffer);
      break;
    case "cmb_debit_txt":
      entries = parseCmbDebitTxt(buffer);
      break;
    case "bocom_debit_pdf":
      entries = await parseBocomDebitPdf(buffer);
      break;
    case "icbc_debit_pdf":
      entries = await parseIcbcDebitPdf(buffer);
      break;
    case "ccb_debit_xls":
      entries = parseCcbDebitXls(buffer);
      break;
    default:
      entries = [];
  }

  return { channel, detectConfidence, entries };
}
