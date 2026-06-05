/**
 * 本地草稿存储（Local Draft Storage）
 * =========================================================================
 *
 * 作用：在用户每次输入触发 debounce 之前 / 期间，**同步**地把当前编辑器内容
 * 写一份到 localStorage。即使：
 *   - 浏览器/WebView 被系统杀掉
 *   - 用户在 debounce 还没 fire 时刷新或切到后台
 *   - 网络长时间不可用且离线队列也丢失
 * 这一份草稿仍然能在下次打开同一笔记时被恢复出来，避免"几十秒输入一夜消失"。
 *
 * 与离线队列（offlineQueue.ts）的区别：
 *   - 离线队列是"已经决定要发的请求"暂存，flush 时直接 PUT 到服务端
 *   - 本地草稿是"任何键入都立即落盘"的更上游一层，不依赖 PUT 是否被构造过
 *
 * 与服务端冲突的处理：
 *   - 草稿带 `savedAt`（本地时间戳） 与 `baseVersion`（编辑时基于的 server version）
 *   - 打开笔记时如果草稿 savedAt > server.updatedAt 且 baseVersion <= server.version
 *     → 提示用户"恢复未保存的修改"
 *   - 一旦保存成功（saveInflight 收到 200 + 新 version）立即清掉对应草稿
 *
 * 存储 key: "nowen-draft-{noteId}"
 */

const DRAFT_KEY_PREFIX = "nowen-draft-";
const DRAFT_INDEX_KEY = "nowen-draft-index"; // 记录所有 draft noteId，便于全局清理
/** 单条草稿最大存活时间：30 天（超出按"用户已经放弃"处理） */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface NoteDraft {
  noteId: string;
  /** 编辑器模式："tiptap" | "md"，恢复时用来判定 content 字符串怎么解读 */
  editorMode: "tiptap" | "md";
  /** 完整 content（Tiptap JSON 字符串 或 markdown 文本） */
  content: string;
  /** 纯文本（用于列表预览 / 全文搜索） */
  contentText: string;
  /** 标题 */
  title: string;
  /** 写入时基于的 server version；恢复时用于和当前 server.version 比较 */
  baseVersion: number;
  /** 写入时间戳（ms） */
  savedAt: number;
}

// ─── 索引管理 ─────────────────────────────────────────────────────────────────

function getIndex(): string[] {
  try {
    const raw = localStorage.getItem(DRAFT_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setIndex(noteIds: string[]): void {
  try {
    if (noteIds.length === 0) {
      localStorage.removeItem(DRAFT_INDEX_KEY);
    } else {
      localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(noteIds));
    }
  } catch {
    /* quota exceeded 等 */
  }
}

function addToIndex(noteId: string): void {
  const idx = getIndex();
  if (!idx.includes(noteId)) {
    idx.push(noteId);
    setIndex(idx);
  }
}

function removeFromIndex(noteId: string): void {
  const idx = getIndex().filter((id) => id !== noteId);
  setIndex(idx);
}

// ─── 读写 API ─────────────────────────────────────────────────────────────────

function keyOf(noteId: string): string {
  return `${DRAFT_KEY_PREFIX}${noteId}`;
}

/**
 * 写入草稿。**同步**操作，调用方应在每次 onUpdate / debounce fire 时直接调用。
 *
 * 失败保护：localStorage quota 满 / 浏览器隐私模式禁用 storage 时静默失败，
 * 不抛异常打断主流程。
 */
export function saveDraft(draft: NoteDraft): void {
  if (!draft.noteId || draft.noteId.startsWith("local-")) {
    // 离线创建的临时笔记由 offlineQueue 兜底，这里不重复存
    return;
  }
  try {
    localStorage.setItem(keyOf(draft.noteId), JSON.stringify(draft));
    addToIndex(draft.noteId);
  } catch (e) {
    // quota 满 → 尝试清理一次最旧的草稿后重试一次
    try {
      pruneOldest();
      localStorage.setItem(keyOf(draft.noteId), JSON.stringify(draft));
      addToIndex(draft.noteId);
    } catch {
      // 仍然失败：放弃，但不影响主流程
      // eslint-disable-next-line no-console
      console.warn("[draftStorage] saveDraft failed:", e);
    }
  }
}

/** 读取草稿；不存在或已过期返回 null */
export function loadDraft(noteId: string): NoteDraft | null {
  if (!noteId) return null;
  try {
    const raw = localStorage.getItem(keyOf(noteId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as NoteDraft;
    // 过期清理
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      clearDraft(noteId);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/** 清掉指定笔记的草稿（保存成功后调用） */
export function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(keyOf(noteId));
    removeFromIndex(noteId);
  } catch {
    /* ignore */
  }
}

/** 清理最旧的一条草稿，用于 quota 满时腾空间 */
function pruneOldest(): void {
  const idx = getIndex();
  if (idx.length === 0) return;
  let oldestId = idx[0];
  let oldestAt = Number.MAX_SAFE_INTEGER;
  for (const id of idx) {
    const d = loadDraft(id);
    if (d && d.savedAt < oldestAt) {
      oldestAt = d.savedAt;
      oldestId = id;
    }
  }
  clearDraft(oldestId);
}

/**
 * 判断草稿是否值得提示恢复。
 *
 * 规则：
 *   - 草稿存在
 *   - 草稿是基于当前 server.version 或更早的 version 写的（不是别人编辑过后的旧草稿）
 *   - 草稿 savedAt > server.updatedAt （本地有更新的内容）
 *   - 草稿 content 不等于 server.content（避免空 diff 也提示）
 */
export function shouldOfferRestore(
  draft: NoteDraft,
  serverVersion: number,
  serverUpdatedAt: string | undefined,
  serverContent: string | undefined,
): boolean {
  if (!draft) return false;
  // 别人改过、且 server 已经超过本地 baseVersion 太多 → 不提示，避免覆盖他人编辑
  // （baseVersion <= serverVersion 总是成立，关键看 serverUpdatedAt 是否更新）
  if (draft.baseVersion > serverVersion) return false;
  if (serverUpdatedAt) {
    const serverTs = new Date(serverUpdatedAt).getTime();
    if (!Number.isNaN(serverTs) && serverTs >= draft.savedAt) {
      // 服务端版本比草稿还新（说明草稿已经被同步上去 / 或被覆盖）
      return false;
    }
  }
  if (typeof serverContent === "string" && serverContent === draft.content) {
    return false;
  }
  return true;
}

/** 获取所有草稿（用于设置页"未同步草稿"列表） */
export function listDrafts(): NoteDraft[] {
  const idx = getIndex();
  const out: NoteDraft[] = [];
  for (const id of idx) {
    const d = loadDraft(id);
    if (d) out.push(d);
  }
  return out;
}

/** 清空全部草稿（仅在用户主动"清除本地数据"时调用） */
export function clearAllDrafts(): void {
  const idx = getIndex();
  for (const id of idx) {
    try { localStorage.removeItem(keyOf(id)); } catch { /* ignore */ }
  }
  setIndex([]);
}
