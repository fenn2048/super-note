/**
 * offlineRead — 离线读包装器
 * =========================================================================
 *
 * 给关键 API 调用加一层"网络失败时回退到 localStore"的能力。
 *
 * 用法：
 *   const notebooks = await offlineFallback(
 *     () => api.getNotebooks(),
 *     () => getAllNotebooks(),
 *     { onOffline: () => setOffline(true) }
 *   );
 *
 * 设计：
 *   - 只接管"网络错误 / 超时 / 5xx"；4xx 错误不回退（说明是业务错误，不是网络问题）。
 *   - 命中本地缓存时通知调用方（onOffline），UI 据此展示"离线模式"徽章。
 *   - 不在这里写缓存——写缓存由 syncEngine 在线路径里做，避免重复责任。
 */

import {
  getAllNotebooks,
  getAllNotes,
  getAllTags,
  getNote as localGetNote,
  isReady as localStoreReady,
} from "@/lib/localStore";
import type { Note, NoteListItem, Notebook, Tag } from "@/types";

/** 全局离线状态 —— 任意一次 fallback 命中即标 true，online 事件复位 */
let offlineHit = false;
const offlineListeners = new Set<(v: boolean) => void>();

function setOffline(v: boolean) {
  if (offlineHit === v) return;
  offlineHit = v;
  offlineListeners.forEach((fn) => {
    try { fn(v); } catch { /* ignore */ }
  });
}

if (typeof window !== "undefined") {
  // 网络真的恢复时复位（useNetworkStatus 自己也会 probe，这里只是兜底）
  window.addEventListener("online", () => setOffline(false));
}

export function isCurrentlyOffline(): boolean {
  return offlineHit || (typeof navigator !== "undefined" && !navigator.onLine);
}

export function subscribeOfflineState(fn: (v: boolean) => void): () => void {
  offlineListeners.add(fn);
  return () => { offlineListeners.delete(fn); };
}

// 核心包装：在线尝试 -> 失败兜底
async function withFallback<T>(
  online: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  // navigator.onLine === false 时直接走本地，不浪费一次失败的 fetch
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (localStoreReady()) {
      setOffline(true);
      return fallback();
    }
    // 没缓存又离线 —— 让 online 的报错冒上来，调用方 try/catch 处理
  }

  try {
    const r = await online();
    setOffline(false);
    return r;
  } catch (e: any) {
    // 4xx 业务错（401/403/404/409/422/...）不回退，原样抛
    const status = e?.status as number | undefined;
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw e;
    }
    // 没本地缓存就只能抛
    if (!localStoreReady()) throw e;
    setOffline(true);
    return fallback();
  }
}

// ─── 具体读封装 ────────────────────────────────────────────────────────────────

export function readNotebooks(online: () => Promise<Notebook[]>): Promise<Notebook[]> {
  return withFallback(online, () => getAllNotebooks());
}

export function readNotesList(
  online: () => Promise<NoteListItem[]>,
  filter?: (n: Note) => boolean,
): Promise<NoteListItem[]> {
  return withFallback(online, async () => {
    const all = await getAllNotes();
    const matched = filter ? all.filter(filter) : all;
    // 按 updatedAt 降序，与服务端默认排序一致
    matched.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    // Note → NoteListItem：丢掉重字段
    return matched.map(({ content, ...rest }) => rest as unknown as NoteListItem);
  });
}

export function readTags(online: () => Promise<Tag[]>): Promise<Tag[]> {
  return withFallback(online, () => getAllTags());
}

export function readNote(id: string, online: () => Promise<Note>): Promise<Note> {
  return withFallback(online, async () => {
    const n = await localGetNote(id);
    if (!n) throw new Error("笔记不在本地缓存中");
    if (!n.content) throw new Error("该笔记的正文未缓存，离线时无法打开");
    return n;
  });
}
