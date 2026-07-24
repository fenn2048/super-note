/** 导入 UI 文案 / 渠道标签（纯函数，无 React） */

export type FilterKey =
  | "all"
  | "needs_review"
  | "ready"
  | "duplicate"
  | "ignored"
  | "committed";

export function yuan(minor: number | undefined | null) {
  if (minor == null) return "0.00";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

export function batchStatusLabel(status: string) {
  switch (status) {
    case "preview":
      return "预览";
    case "partial":
      return "部分导入";
    case "committed":
      return "已完成";
    case "discarded":
      return "已丢弃";
    default:
      return status || "未知";
  }
}

export function rowStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return "就绪";
    case "needs_review":
      return "待确认";
    case "duplicate":
      return "重复";
    case "ignored":
      return "忽略";
    case "committed":
      return "已导入";
    default:
      return status;
  }
}

export const CHANNEL_LABEL: Record<string, string> = {
  alipay: "支付宝",
  wechat: "微信",
  jd: "京东",
  icbc_credit_eml: "工行信用卡邮件",
  cmb_credit_eml: "招行信用卡邮件",
  cgb_credit_eml: "广发信用卡邮件",
  cmb_debit_pdf: "招行储蓄卡 PDF",
  cmb_debit_txt: "招行储蓄卡 TXT",
  bocom_debit_pdf: "交行储蓄卡 PDF",
  ccb_debit_xls: "建行储蓄卡 XLS",
  icbc_debit_pdf: "工行储蓄卡 PDF",
};

export function channelLabel(c: string) {
  return CHANNEL_LABEL[c] || c || "未知";
}

export function filterChipLabel(f: FilterKey, counts: Record<string, number>) {
  switch (f) {
    case "all":
      return `全部 (${counts.all ?? 0})`;
    case "needs_review":
      return `待确认 (${counts.needs_review ?? 0})`;
    case "ready":
      return `就绪 (${counts.ready ?? 0})`;
    case "duplicate":
      return `重复 (${counts.duplicate ?? 0})`;
    case "ignored":
      return `忽略 (${counts.ignored ?? 0})`;
    case "committed":
      return `已导入 (${counts.committed ?? 0})`;
  }
}
