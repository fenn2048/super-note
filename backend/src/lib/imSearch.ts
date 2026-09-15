/**
 * 会话内消息搜索的类型 / 日期筛选（与前端 ChatCenter 对齐）。
 * kind 只允许白名单，SQL 片段全部写死，避免拼进用户输入。
 */

export const IM_SEARCH_KINDS = ["text", "link", "card", "video", "image"] as const;
export type ImSearchKind = (typeof IM_SEARCH_KINDS)[number];

const VIDEO_NAME_SUFFIX = [
  "lower(IFNULL(f.filename,'')) LIKE '%.mp4'",
  "lower(IFNULL(f.filename,'')) LIKE '%.mov'",
  "lower(IFNULL(f.filename,'')) LIKE '%.webm'",
  "lower(IFNULL(f.filename,'')) LIKE '%.mkv'",
  "lower(IFNULL(f.filename,'')) LIKE '%.m4v'",
  "lower(IFNULL(f.filename,'')) LIKE '%.avi'",
];

/**
 * JS `getTimezoneOffset()`（本地比 UTC 慢多少分钟，CST = -480）
 * → SQLite `date(utc, modifier)` 用的「UTC 加多少分钟得到本地」。
 */
export function sqliteTzModifier(tzOffsetMinutes: unknown): string {
  const n = Number(tzOffsetMinutes);
  if (!Number.isFinite(n) || Math.abs(n) > 16 * 60) return "+0 minutes";
  const localAhead = -Math.round(n);
  const sign = localAhead >= 0 ? "+" : "-";
  return `${sign}${Math.abs(localAhead)} minutes`;
}

/** 把查询参数转成 SQLite UTC `YYYY-MM-DD HH:MM:SS`（与 datetime('now') 可比较）。 */
export function sqliteUtcFromQuery(raw: string | undefined | null): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function imSearchKindClause(kind: string | undefined | null): string | null {
  const k = (kind || "").trim().toLowerCase();
  switch (k) {
    case "text":
      return "msg.type = 'text'";
    case "link":
      return "msg.type = 'text' AND (instr(lower(IFNULL(msg.body,'')), 'http://') > 0 OR instr(lower(IFNULL(msg.body,'')), 'https://') > 0)";
    case "card":
      return "msg.type = 'card'";
    case "image":
      return "(msg.type = 'image' OR (msg.type = 'file' AND IFNULL(f.mimeType,'') LIKE 'image/%'))";
    case "video":
      return `(msg.type = 'file' AND (IFNULL(f.mimeType,'') LIKE 'video/%' OR ${VIDEO_NAME_SUFFIX.join(" OR ")}))`;
    default:
      return null;
  }
}
