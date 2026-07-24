/** 记账模块共享类型 */

export type AccountType = "ASSETS" | "LIABILITIES" | "EQUITY" | "INCOME" | "EXPENSES";

export type ImportChannel =
  | "alipay"
  | "wechat"
  | "jd"
  | "icbc_credit_eml"
  | "cmb_credit_eml"
  | "cgb_credit_eml"
  | "cmb_debit_pdf"
  | "cmb_debit_txt"
  | "bocom_debit_pdf"
  | "ccb_debit_xls"
  | "icbc_debit_pdf"
  | "unknown";

export type ImportRowStatus = "ready" | "needs_review" | "duplicate" | "ignored" | "error";

export interface ImportEntry {
  sourceId: string;
  date: string;
  time?: string;
  payee: string;
  item: string;
  type?: string;
  category?: string;
  method?: string;
  /** 有符号金额（分）：支出为负，收入为正；neutral 可按 0 或正负均有 */
  amountMinor: number;
  direction: "in" | "out" | "neutral";
  isRefund?: boolean;
  /** Unix 秒，可选 */
  timestamp?: number;
  /** 已有标签（导入草稿再匹配 / 试算时传入） */
  tags?: string[];
  rawItems: Record<string, string>;
}

export interface ImportRuleMatch {
  peer?: string;
  type?: string;
  item?: string;
  category?: string;
  method?: string;
  /**
   * 基础匹配：明细标签包含（关键词，可用 separator 分隔多值 OR）。
   * 语义：交易明细 tags 中任一标签包含所填文字 → 命中。
   */
  tags?: string;
  fullMatch?: boolean;
  separator?: string;
  logic?: "AND" | "OR";
  minPrice?: number;
  maxPrice?: number;
  price?: number;
  /** HH:MM-HH:MM */
  timeRange?: string;
  /** ts1-ts2 */
  timestampRange?: string;
  tradeNo?: string;
  orderNo?: string;
  transactionId?: string;
  merchantId?: string;
  transactionCode?: string;
  branchCode?: string;
  asset?: string;
  side?: string;
}

export interface ImportRuleAction {
  ignore?: boolean;
  targetAccountId?: string;
  methodAccountId?: string;
  tags?: string[];
  methodMappings?: Array<{ method: string; accountId: string }>;
  defaultPlusAccountId?: string;
  defaultMinusAccountId?: string;
  pnlAccountId?: string;
  commissionAccountId?: string;
}

export interface ImportRuleRow {
  id: string;
  ledgerId: string;
  name: string;
  priority: number;
  enabled: number;
  matchJson: string;
  actionJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerRow {
  id: string;
  ownerUserId: string;
  workspaceId: string | null;
  title: string;
  operatingCurrency: string;
  startDate: string;
  passwordHash: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRow {
  id: string;
  ledgerId: string;
  name: string;
  type: AccountType;
  currency: string;
  icon: string | null;
  parentId: string | null;
  isOpen: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostingInput {
  accountId: string;
  amountMinor: number;
  currency?: string;
}

export interface CreateTransactionInput {
  date: string;
  time?: string | null;
  payee?: string | null;
  narration?: string | null;
  tags?: string[];
  source?: string | null;
  sourceRef?: string | null;
  importBatchId?: string | null;
  meta?: Record<string, unknown> | null;
  postings: PostingInput[];
}
