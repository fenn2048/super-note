import * as XLSX from "xlsx";
import type { ImportEntry } from "../types.js";
import { yuanToMinor } from "../amount.js";

/**
 * 微信支付账单：xlsx 或 csv
 */
export function parseWechat(buffer: Buffer, fileName: string): ImportEntry[] {
  const lower = fileName.toLowerCase();
  let rows: string[][] = [];

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }) as string[][];
  } else {
    const text = buffer.toString("utf8");
    rows = text.split(/\r?\n/).map((line) => {
      // 简易 CSV
      return line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    });
  }

  const entries: ImportEntry[] = [];
  let headerRow = -1;
  let headers: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c || "").trim());
    const joined = r.join(",");
    if (
      (joined.includes("交易时间") || joined.includes("交易对方")) &&
      (joined.includes("金额") || joined.includes("收/支"))
    ) {
      headerRow = i;
      headers = r;
      break;
    }
  }
  if (headerRow < 0) return entries;

  const idx = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iTime = idx(["交易时间"]);
  const iPeer = idx(["交易对方"]);
  const iItem = idx(["商品", "交易类型"]);
  const iType = idx(["交易类型"]);
  const iDir = idx(["收/支"]);
  const iAmt = idx(["金额(元)", "金额"]);
  const iMethod = idx(["支付方式"]);
  const iStatus = idx(["当前状态", "交易状态"]);
  const iTrade = idx(["交易单号"]);
  const iMch = idx(["商户单号"]);
  const iRemark = idx(["备注"]);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const cols = rows[i].map((c) => String(c || "").trim());
    if (cols.every((c) => !c)) continue;

    const status = iStatus >= 0 ? cols[iStatus] : "";
    if (status.includes("已全额退款") && false) {
      /* keep */
    }

    const dir = iDir >= 0 ? cols[iDir] : "";
    if (dir === "/" || dir === "不计收支") continue;

    let amountMinor = yuanToMinor((iAmt >= 0 ? cols[iAmt] : "0").replace(/¥|￥/g, ""));
    let direction: ImportEntry["direction"] = "neutral";
    if (dir.includes("支")) {
      amountMinor = -Math.abs(amountMinor);
      direction = "out";
    } else if (dir.includes("收")) {
      amountMinor = Math.abs(amountMinor);
      direction = "in";
    } else {
      continue;
    }
    if (amountMinor === 0) continue;

    const timeFull = iTime >= 0 ? cols[iTime] : "";
    // Excel 日期可能已是字符串
    const parts = timeFull.split(/\s+/);
    let date = parts[0] || "";
    if (date.includes("/")) date = date.replace(/\//g, "-");
    // 2024/1/2 → pad
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
      const [y, m, d] = date.split("-");
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const time = parts[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const tradeNo = iTrade >= 0 ? cols[iTrade] : `wx_${date}_${i}`;

    entries.push({
      sourceId: tradeNo || `wechat_${date}_${i}`,
      date,
      time,
      payee: iPeer >= 0 ? cols[iPeer] : "",
      item: iItem >= 0 ? cols[iItem] : "",
      type: status || (iType >= 0 ? cols[iType] : undefined),
      method: iMethod >= 0 ? cols[iMethod] : undefined,
      amountMinor,
      direction,
      isRefund: status.includes("退款"),
      rawItems: {
        交易时间: timeFull,
        交易对方: iPeer >= 0 ? cols[iPeer] : "",
        金额: iAmt >= 0 ? cols[iAmt] : "",
        收支: dir,
        交易单号: tradeNo,
        商户单号: iMch >= 0 ? cols[iMch] : "",
        备注: iRemark >= 0 ? cols[iRemark] : "",
      },
    });
  }

  return entries;
}
