/**
 * 剪藏上传失败队列（C3 可靠性）
 * ---------------------------------------------------------------------------
 * 抽取/转换成功后若 save 因网络失败，把 SaveClipPayload 落 local，
 * 联网后自动或手动 flush。
 */

import type { SaveClipPayload } from "./api";

export interface QueuedClipItem {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  noteTitle: string;
  pageUrl?: string;
  payload: SaveClipPayload;
}

const KEY = "superClipperUploadQueue";
const MAX_ITEMS = 20;
const MAX_ATTEMPTS = 5;

export async function listQueuedClips(): Promise<QueuedClipItem[]> {
  try {
    const data = await chrome.storage.local.get(KEY);
    const list = data[KEY];
    return Array.isArray(list) ? (list as QueuedClipItem[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: QueuedClipItem[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: items.slice(0, MAX_ITEMS) });
}

export async function enqueueClip(item: {
  noteTitle: string;
  pageUrl?: string;
  payload: SaveClipPayload;
  lastError?: string;
}): Promise<QueuedClipItem> {
  const list = await listQueuedClips();
  const entry: QueuedClipItem = {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    attempts: 0,
    lastError: item.lastError,
    noteTitle: item.noteTitle || "未命名剪藏",
    pageUrl: item.pageUrl,
    payload: item.payload,
  };
  await writeAll([entry, ...list]);
  return entry;
}

export async function removeQueuedClip(id: string): Promise<void> {
  const list = await listQueuedClips();
  await writeAll(list.filter((x) => x.id !== id));
}

export async function updateQueuedClip(
  id: string,
  patch: Partial<Pick<QueuedClipItem, "attempts" | "lastError">>,
): Promise<void> {
  const list = await listQueuedClips();
  const next = list.map((x) => (x.id === id ? { ...x, ...patch } : x));
  await writeAll(next);
}

export function isLikelyNetworkError(msg: string): boolean {
  return /Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT|timeout|AbortError|network|无法连接|ERR_INTERNET|ERR_CONNECTION|Load failed/i.test(
    msg,
  );
}

export { MAX_ATTEMPTS };
