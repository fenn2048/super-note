import iconv from "iconv-lite";
import type { ImportEntry } from "../types.js";
import { yuanToMinor } from "../amount.js";

function trim(s: string) {
  return (s || "").replace(/^\uFEFF/, "").trim();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/**
 * 支付宝导出 CSV（GBK 或 UTF-8）
 * 手机版常见列：时间,分类,对方,商品说明/详情,收/支,金额,支付方式,状态,流水号,商户单号,备注
 * 浏览器版列更多
 */
export function parseAlipay(buffer: Buffer): ImportEntry[] {
  let text: string;
  // 尝试 UTF-8，若乱码关键则用 GBK
  const asUtf8 = buffer.toString("utf8");
  if (asUtf8.includes("支付宝") || asUtf8.includes("交易时间") || asUtf8.includes("收/支")) {
    text = asUtf8;
  } else {
    text = iconv.decode(buffer, "gbk");
  }

  const lines = text.split(/\r?\n/);
  const entries: ImportEntry[] = [];
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes("交易时间") &&
      (line.includes("交易对方") || line.includes("对方") || line.includes("收/支"))
    ) {
      headerIdx = i;
      headers = parseCsvLine(line).map(trim);
      break;
    }
  }
  if (headerIdx < 0) return entries;

  const col = (name: string | string[]) => {
    const names = Array.isArray(name) ? name : [name];
    for (const n of names) {
      const idx = headers.findIndex((h) => h === n || h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const iTime = col(["交易时间", "时间"]);
  const iCat = col(["交易分类", "分类"]);
  const iPeer = col(["交易对方", "对方"]);
  const iItem = col(["商品说明", "商品名称", "商品", "商品详情"]);
  const iDir = col(["收/支"]);
  const iAmt = col(["金额"]);
  const iMethod = col(["收/付款方式", "支付方式"]);
  const iStatus = col(["交易状态", "状态"]);
  const iTrade = col(["交易订单号", "交易号", "流水号"]);
  const iOrder = col(["商家订单号", "商户单号"]);
  const iRemark = col(["备注"]);

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith("-") || line.includes("支付宝")) continue;
    const cols = parseCsvLine(line).map(trim);
    if (cols.length < 5) continue;

    const status = iStatus >= 0 ? cols[iStatus] : "";
    if (status === "交易关闭") continue;

    const directionRaw = iDir >= 0 ? cols[iDir] : "";
    if (directionRaw === "不计收支") continue;

    const amtStr = iAmt >= 0 ? cols[iAmt] : "0";
    let amountMinor = yuanToMinor(amtStr);
    let direction: ImportEntry["direction"] = "neutral";
    if (directionRaw === "支出" || directionRaw === "已支出") {
      amountMinor = -Math.abs(amountMinor);
      direction = "out";
    } else if (directionRaw === "收入" || directionRaw === "已收入") {
      amountMinor = Math.abs(amountMinor);
      direction = "in";
    } else if (status.includes("退款")) {
      // 退款常标不计收支已过滤；若到这里按收入处理
      amountMinor = Math.abs(amountMinor);
      direction = "in";
    }

    if (amountMinor === 0) continue;

    const timeFull = iTime >= 0 ? cols[iTime] : "";
    const parts = timeFull.split(/\s+/);
    const date = parts[0] || "";
    const time = parts[1] || undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const tradeNo = iTrade >= 0 ? cols[iTrade] : `${date}_${i}`;
    const payee = iPeer >= 0 ? cols[iPeer] : "";
    const item = iItem >= 0 ? cols[iItem] : "";

    entries.push({
      sourceId: tradeNo || `alipay_${date}_${i}`,
      date,
      time,
      payee,
      item,
      type: status,
      category: iCat >= 0 ? cols[iCat] : undefined,
      method: iMethod >= 0 ? cols[iMethod] : undefined,
      amountMinor,
      direction,
      isRefund: status.includes("退款"),
      rawItems: {
        交易时间: timeFull,
        交易对方: payee,
        商品: item,
        金额: amtStr,
        收支: directionRaw,
        状态: status,
        流水号: tradeNo,
        商家订单号: iOrder >= 0 ? cols[iOrder] : "",
        备注: iRemark >= 0 ? cols[iRemark] : "",
      },
    });
  }

  return entries;
}
