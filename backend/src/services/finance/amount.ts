/**
 * 金额工具：全程使用整数分（minor units），避免浮点误差。
 */

/** 元（number 或 string）→ 分（整数，四舍五入到分） */
export function yuanToMinor(yuan: number | string): number {
  const n = typeof yuan === "string" ? parseFloat(yuan.replace(/,/g, "").trim()) : yuan;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 分 → 展示用元字符串（两位小数） */
export function minorToYuanString(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${yuan}.${cents.toString().padStart(2, "0")}`;
}

/** 分 → 元 number（仅用于图表；业务逻辑请用 minor） */
export function minorToYuan(minor: number): number {
  return minor / 100;
}

/** 校验分录平衡：总和必须为 0 */
export function assertBalanced(amounts: number[]): void {
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== 0) {
    throw new Error(`分录不平衡：合计 ${minorToYuanString(sum)} 元（应为 0）`);
  }
}

/** 解析账单中的金额字符串（可含 ¥ , ￥ 等） */
export function parseAmountString(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[¥￥,\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  return yuanToMinor(cleaned);
}
