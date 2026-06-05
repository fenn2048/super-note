/**
 * syncEngine — 本地缓存与服务端的同步引擎（Phase B 骨架 / Phase E 完善）
 * =========================================================================
 *
 * 职责：
 *   1. **登录后全量 pull**：拉笔记本树 / 列表项 / 标签写入 localStore；
 *   2. **打开某篇笔记时按需 pull 正文**（Phase C/E 接入）；
 *   3. **联机回复时 flush offline queue + 把本地版本与服务端 reconcile**（Phase E）；
 *   4. **登出时 setCurrentUser(null)** —— 不删数据，便于下次重登秒开。
 *
 * 此文件 Phase B 仅落地"骨架 + bootstrap"。Phase C/D/E 会在此基础上扩展。
 *
 * 与 offlineQueue 的分工：
 *   - offlineQueue 处理"写"（POST/PUT/DELETE 失败时入队 → 联网时 flush）；
 *   - syncEngine 处理"读"（pull 服务端最新到本地 + 启动期 bootstrap）；
 *   - 两者通过 localStore 共享状态，但相互独立。
 */

import { api } from "@/lib/api";
import {
  setCurrentUser,
  putNotebooks,
  putNoteListItems,
  putNote,
  putTags,
  setMeta,
  getMeta,
  getAllNotes,
  getAllNotebooks,
  getAllTags,
  deleteNote,
  deleteNotebook,
  deleteTag,
  isReady as localStoreReady,
} from "@/lib/localStore";
import { getQueue as getOfflineQueue } from "@/lib/offlineQueue";
import type { Note, User } from "@/types";

// ─── 状态机 ────────────────────────────────────────────────────────────────────

type SyncState = "idle" | "bootstrapping" | "ready" | "error";
let state: SyncState = "idle";
let lastError: string | null = null;
const stateListeners = new Set<(s: SyncState) => void>();

function setState(s: SyncState, err?: string) {
  state = s;
  lastError = err || null;
  stateListeners.forEach((fn) => {
    try { fn(s); } catch { /* ignore */ }
  });
}

export function getSyncState(): { state: SyncState; lastError: string | null } {
  return { state, lastError };
}

export function subscribeSyncState(fn: (s: SyncState) => void): () => void {
  stateListeners.add(fn);
  return () => { stateListeners.delete(fn); };
}

// ─── Bootstrap：登录后调一次 ───────────────────────────────────────────────────

/**
 * 绑定用户 + 第一次全量 pull。
 *
 * 调用时机：
 *   - AuthGate 拿到 user 之后（无论是 zero-login 还是正常密码登录）；
 *   - 切换账号时也要重新调（先 setCurrentUser(null) 再 setCurrentUser(newId)）。
 *
 * 失败语义：
 *   - 网络失败 → state=error，但 currentUserId 仍设上，离线读能用旧缓存；
 *   - localStore 写入失败 → 静默（safe 包裹），不阻塞主流程。
 */
export async function bootstrap(user: User): Promise<void> {
  setCurrentUser(user.id);

  // 没联网时：直接走"使用本地缓存"路径，不发请求
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState("ready"); // 有缓存就是 ready；无缓存上层自然啥也展示不出来
    return;
  }

  setState("bootstrapping");

  try {
    // 并行拉三类元数据；任一失败时单独捕获 —— 比如标签接口暂时挂了
    // 不应该拖累笔记本/笔记列表的缓存
    const [notebooksRes, notesRes, tagsRes] = await Promise.allSettled([
      api.getNotebooks(),
      api.getNotes(),
      api.getTags(),
    ]);

    if (notebooksRes.status === "fulfilled") {
      // Phase E: 服务端已删除的笔记本 → 从本地清掉
      const localNotebooks = await getAllNotebooks();
      const remoteIds = new Set(notebooksRes.value.map((n) => n.id));
      for (const nb of localNotebooks) {
        if (!remoteIds.has(nb.id)) await deleteNotebook(nb.id);
      }
      await putNotebooks(notebooksRes.value);
    } else {
      console.warn("[syncEngine] pull notebooks failed:", notebooksRes.reason);
    }
    if (notesRes.status === "fulfilled") {
      // 同上：服务端不返回的笔记 → 本地删除。
      // 但要注意：offline queue 里还有 createNote 未 flush 的本地新增笔记，
      //   它们服务端暂不知道，不能误删。为简化逻辑：
      //   只删 "本地有、服务端没、且不在调度队列里" 的。
      const localNotes = await getAllNotes();
      const remoteIds = new Set(notesRes.value.map((n) => n.id));
      const queueIds = await getQueuedNoteIds();
      for (const note of localNotes) {
        if (!remoteIds.has(note.id) && !queueIds.has(note.id)) {
          await deleteNote(note.id);
        }
      }
      await putNoteListItems(notesRes.value);
    } else {
      console.warn("[syncEngine] pull notes list failed:", notesRes.reason);
    }
    if (tagsRes.status === "fulfilled") {
      const localTags = await getAllTags();
      const remoteIds = new Set(tagsRes.value.map((t) => t.id));
      for (const t of localTags) {
        if (!remoteIds.has(t.id)) await deleteTag(t.id);
      }
      await putTags(tagsRes.value);
    } else {
      console.warn("[syncEngine] pull tags failed:", tagsRes.reason);
    }

    await setMeta("lastSyncAt", Date.now());
    setState("ready");
  } catch (e: unknown) {
    console.warn("[syncEngine] bootstrap failed:", e);
    setState("error", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Phase E: 拿到 offline queue 里所有"涉及 noteId"的项，
 * bootstrap 做 diff 时跳过它们以免误删本地新增。
 */
async function getQueuedNoteIds(): Promise<Set<string>> {
  try {
    const q = getOfflineQueue();
    return new Set(q.map((x) => x.noteId));
  } catch {
    return new Set();
  }
}

/**
 * 登出 / 断开服务器时调。
 * 不删本地缓存（用户重登可秒开），仅清当前用户绑定。
 */
export function teardown(): void {
  setCurrentUser(null);
  setState("idle");
}

/**
 * 上次成功同步的时间戳（ms），无则 null。
 */
export async function getLastSyncAt(): Promise<number | null> {
  if (!localStoreReady()) return null;
  const v = await getMeta<number>("lastSyncAt");
  return typeof v === "number" ? v : null;
}

/**
 * Phase C: 在线打开某篇笔记时顺手写入本地缓存，以便后续离线访问。
 * 由 EditorPane / api.getNote 调用；失败静默。
 */
export async function cacheNoteContent(note: Note): Promise<void> {
  if (!localStoreReady()) return;
  if (!note?.id) return;
  try { await putNote(note); }
  catch (e) { console.warn("[syncEngine] cacheNoteContent failed:", e); }
}
