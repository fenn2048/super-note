import type { ImportChannel } from "../types.js";

/**
 * 根据文件名 + 内容嗅探识别账单渠道
 */
export function detectChannel(fileName: string, buffer: Buffer): {
  channel: ImportChannel;
  confidence: number;
} {
  const lower = fileName.toLowerCase();
  const headUtf8 = buffer.slice(0, 4096).toString("utf8");
  let headGbk = "";
  try {
    // lazy: 仅用 latin1 近似看关键字；支付宝会在 alipay parser 再 decode
    headGbk = buffer.slice(0, 8192).toString("binary");
  } catch {
    headGbk = "";
  }

  // 文件名启发式
  if (/alipay|支付宝/.test(lower)) return { channel: "alipay", confidence: 0.9 };
  if (/wechat|微信|wxpay/.test(lower)) return { channel: "wechat", confidence: 0.9 };
  if (/jd_pay|京东/.test(lower)) return { channel: "jd", confidence: 0.9 };
  if (/icbc.*credit|工行.*信用|icbc_credit/.test(lower)) return { channel: "icbc_credit_eml", confidence: 0.9 };
  if (/cmb.*credit|招行.*信用|cmb_credit/.test(lower)) return { channel: "cmb_credit_eml", confidence: 0.9 };
  if (/cgb.*credit|广发/.test(lower)) return { channel: "cgb_credit_eml", confidence: 0.9 };
  if (/cmb.*debit.*txt|cmb_debit.*\.txt/.test(lower)) return { channel: "cmb_debit_txt", confidence: 0.9 };
  if (/cmb.*debit|招行.*储蓄|cmb_debit/.test(lower)) return { channel: "cmb_debit_pdf", confidence: 0.85 };
  if (/bocom|交行|交通银行/.test(lower)) return { channel: "bocom_debit_pdf", confidence: 0.9 };
  if (/ccb|cccb|建设银行|建行/.test(lower)) return { channel: "ccb_debit_xls", confidence: 0.9 };
  if (/icbc.*debit|工行.*储蓄|icbc_debit/.test(lower)) return { channel: "icbc_debit_pdf", confidence: 0.9 };

  // 内容
  if (
    headUtf8.includes("支付宝") ||
    headUtf8.includes("支付宝支付科技") ||
    headGbk.includes("֧����") // 有时乱码不稳，主要靠扩展名
  ) {
    if (lower.endsWith(".csv")) return { channel: "alipay", confidence: 0.85 };
  }
  if (headUtf8.includes("微信支付") || headUtf8.includes("微信昵称") || headUtf8.includes("微信账号")) {
    return { channel: "wechat", confidence: 0.85 };
  }
  if (headUtf8.includes("京东账号") || headUtf8.includes("京东平台商户")) {
    return { channel: "jd", confidence: 0.85 };
  }

  if (lower.endsWith(".eml")) {
    if (/工商银行|ICBC|中国工商银行/.test(headUtf8)) return { channel: "icbc_credit_eml", confidence: 0.8 };
    if (/招商银行|CMB/.test(headUtf8)) return { channel: "cmb_credit_eml", confidence: 0.8 };
    if (/广发银行|CGB/.test(headUtf8)) return { channel: "cgb_credit_eml", confidence: 0.8 };
    return { channel: "icbc_credit_eml", confidence: 0.4 };
  }

  if (lower.endsWith(".pdf")) {
    // PDF 二进制里可能有中文
    if (headUtf8.includes("招商银行") || buffer.includes(Buffer.from("招商银行"))) {
      return { channel: "cmb_debit_pdf", confidence: 0.7 };
    }
    if (headUtf8.includes("交通银行") || buffer.includes(Buffer.from("交通银行"))) {
      return { channel: "bocom_debit_pdf", confidence: 0.7 };
    }
    if (headUtf8.includes("工商银行") || buffer.includes(Buffer.from("工商银行"))) {
      return { channel: "icbc_debit_pdf", confidence: 0.7 };
    }
    return { channel: "cmb_debit_pdf", confidence: 0.3 };
  }

  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
    if (headUtf8.includes("微信") || lower.includes("wechat")) return { channel: "wechat", confidence: 0.75 };
    return { channel: "ccb_debit_xls", confidence: 0.4 };
  }

  if (lower.endsWith(".csv")) {
    if (headUtf8.includes("京东")) return { channel: "jd", confidence: 0.7 };
    return { channel: "alipay", confidence: 0.5 };
  }

  if (lower.endsWith(".txt")) return { channel: "cmb_debit_txt", confidence: 0.5 };

  return { channel: "unknown", confidence: 0 };
}
