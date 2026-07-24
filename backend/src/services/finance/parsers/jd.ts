import type { ImportEntry } from "../types.js";
import { yuanToMinor } from "../amount.js";

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

/** 京东支付 CSV（UTF-8 BOM） */
export function parseJd(buffer: Buffer): ImportEntry[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const entries: ImportEntry[] = [];
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("交易时间") && lines[i].includes("金额")) {
      headerIdx = i;
      headers = parseCsvLine(lines[i]).map((h) => h.trim());
      break;
    }
  }
  if (headerIdx < 0) return entries;

  const col = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iTime = col(["交易时间"]);
  const iPeer = col(["商户名称"]);
  const iItem = col(["交易说明"]);
  const iAmt = col(["金额"]);
  const iMethod = col(["收/付款方式"]);
  const iStatus = col(["交易状态"]);
  const iDir = col(["收/支"]);
  const iCat = col(["交易分类"]);
  const iTrade = col(["交易订单号"]);
  const iOrder = col(["商家订单号"]);
  const iRemark = col(["备注"]);

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line).map((c) => c.trim());
    const dir = iDir >= 0 ? cols[iDir] : "";
    if (dir === "不计收支") continue;

    let amtRaw = iAmt >= 0 ? cols[iAmt] : "0";
    // 金额可能含 "(已全额退款)"
    amtRaw = amtRaw.replace(/\(.*\)/g, "").trim();
    let amountMinor = yuanToMinor(amtRaw);
    let direction: ImportEntry["direction"] = "neutral";
    if (dir === "支出") {
      amountMinor = -Math.abs(amountMinor);
      direction = "out";
    } else if (dir === "收入") {
      amountMinor = Math.abs(amountMinor);
      direction = "in";
    } else {
      continue;
    }
    if (amountMinor === 0) continue;

    const timeFull = iTime >= 0 ? cols[iTime] : "";
    const parts = timeFull.split(/\s+/);
    const date = parts[0];
    const time = parts[1];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const tradeNo = iTrade >= 0 ? cols[iTrade] : `jd_${date}_${i}`;
    const status = iStatus >= 0 ? cols[iStatus] : "";

    entries.push({
      sourceId: tradeNo || `jd_${date}_${i}`,
      date,
      time,
      payee: iPeer >= 0 ? cols[iPeer] : "",
      item: iItem >= 0 ? cols[iItem] : "",
      type: status,
      category: iCat >= 0 ? cols[iCat] : undefined,
      method: iMethod >= 0 ? cols[iMethod] : undefined,
      amountMinor,
      direction,
      isRefund: status.includes("退款") || (iItem >= 0 && cols[iItem].includes("退款")),
      rawItems: {
        交易时间: timeFull,
        商户名称: iPeer >= 0 ? cols[iPeer] : "",
        交易说明: iItem >= 0 ? cols[iItem] : "",
        金额: amtRaw,
        收支: dir,
        交易订单号: tradeNo,
        商家订单号: iOrder >= 0 ? cols[iOrder] : "",
        备注: iRemark >= 0 ? cols[iRemark] : "",
      },
    });
  }

  return entries;
}
