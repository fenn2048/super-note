/**
 * bookCacheQueue — 书库本地文件缓存下载队列（串行，移动端离线阅读）
 * ----------------------------------------------------------------------------
 * 与 mediaCacheQueue 同构：进度 / 暂停 / 继续 / 取消。
 * 文件落入 localStore.bookFiles，与 BookReader 离线读路径一致。
 */

import { getServerUrl } from "@/lib/api";
import {
  putBookFile,
  deleteBookFile,
  deleteBookFiles,
  clearAllBookFiles,
  hasBookFile,
  listBookFileMeta,
  getBookFileStats,
  type BookFileMeta,
} from "@/lib/localStore";
import { toast } from "@/lib/toast";
import { formatBytes } from "@/lib/mediaFileCache";

/** 单本软上限 800MB（电子书通常远小于此） */
export const BOOK_CACHE_MAX_BYTES = Math.floor(800 * 1024 * 1024);

export type BookCacheJobStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

export interface BookCacheJobInput {
  bookHash: string;
  attachmentId: string;
  title: string;
  format?: string;
  /** 可选，服务端登记的 size */
  size?: number;
}

export interface BookCacheJob extends BookCacheJobInput {
  status: BookCacheJobStatus;
  progress: number;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
  addedAt: number;
}

type Listener = () => void;

const jobs = new Map<string, BookCacheJob>();
const queue: string[] = [];
const listeners = new Set<Listener>();
let running = false;
let queueGloballyPaused = false;
const abortControllers = new Map<string, AbortController>();
let queueVersion = 0;
let lastProgressEmit = 0;

/** 已缓存 bookHash 集合（内存），与 list 同步 */
let cachedHashSet = new Set<string>();
let cacheSetReady = false;

function emit() {
  queueVersion += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function emitProgress() {
  const now = Date.now();
  if (now - lastProgressEmit < 120) return;
  lastProgressEmit = now;
  emit();
}

export function subscribeBookCacheQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getBookCacheQueueVersion(): number {
  return queueVersion;
}

export function getBookCacheJobs(): BookCacheJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.addedAt - a.addedAt);
}

export function getBookCacheJob(bookHash: string): BookCacheJob | undefined {
  return jobs.get(bookHash);
}

export function getCachedBookHashSet(): Set<string> {
  return cachedHashSet;
}

export async function refreshCachedBookHashSet(): Promise<Set<string>> {
  try {
    const list = await listBookFileMeta();
    cachedHashSet = new Set(list.map((x) => x.bookHash));
    cacheSetReady = true;
  } catch {
    /* ignore */
  }
  emit();
  return cachedHashSet;
}

export function isBookCacheSetReady(): boolean {
  return cacheSetReady;
}

export async function listBookCacheMeta(): Promise<BookFileMeta[]> {
  return listBookFileMeta();
}

export async function getBookCacheStats(): Promise<{ count: number; totalBytes: number }> {
  return getBookFileStats();
}

export { formatBytes };

export function enqueueBookCache(
  items: BookCacheJobInput | BookCacheJobInput[],
  opts?: { force?: boolean },
): void {
  const list = Array.isArray(items) ? items : [items];
  let added = 0;
  let skipped = 0;
  for (const item of list) {
    if (!item?.bookHash || !item?.attachmentId) continue;
    const existing = jobs.get(item.bookHash);
    if (existing && (existing.status === "queued" || existing.status === "downloading")) {
      continue;
    }
    if (existing && existing.status === "paused") {
      resumeBookCacheJob(item.bookHash);
      added += 1;
      continue;
    }
    if (existing && existing.status === "done" && !opts?.force) {
      skipped += 1;
      continue;
    }
    if (!opts?.force && cachedHashSet.has(item.bookHash)) {
      skipped += 1;
      continue;
    }
    jobs.set(item.bookHash, {
      ...item,
      status: "queued",
      progress: 0,
      receivedBytes: 0,
      totalBytes: item.size && item.size > 0 ? item.size : undefined,
      addedAt: Date.now(),
    });
    if (!queue.includes(item.bookHash)) queue.push(item.bookHash);
    added += 1;
  }
  if (added > 0) {
    queueGloballyPaused = false;
    emit();
    void pump();
    if (added === 1) {
      const t =
        list.find((x) => jobs.get(x.bookHash)?.status === "queued")?.title ||
        list[0]?.title ||
        "书籍";
      toast.info(`开始缓存「${t}」`);
    } else {
      toast.info(`已加入 ${added} 本书到缓存队列`);
    }
  } else if (skipped > 0 && list.length > 0) {
    toast.info(list.length === 1 ? "该书已缓存" : "选中项均已缓存");
  }
}

export function cancelBookCacheJob(bookHash: string): void {
  const job = jobs.get(bookHash);
  if (!job) return;
  if (job.status === "queued" || job.status === "paused") {
    const idx = queue.indexOf(bookHash);
    if (idx >= 0) queue.splice(idx, 1);
    job.status = "cancelled";
    job.progress = 0;
    emit();
    return;
  }
  if (job.status === "downloading") {
    job.status = "cancelled";
    abortControllers.get(bookHash)?.abort();
    emit();
  }
}

export function pauseBookCacheJob(bookHash: string): void {
  const job = jobs.get(bookHash);
  if (!job) return;
  if (job.status === "queued") {
    const idx = queue.indexOf(bookHash);
    if (idx >= 0) queue.splice(idx, 1);
    job.status = "paused";
    emit();
    return;
  }
  if (job.status === "downloading") {
    job.status = "paused";
    abortControllers.get(bookHash)?.abort();
    emit();
  }
}

export function resumeBookCacheJob(bookHash: string): void {
  const job = jobs.get(bookHash);
  if (!job || job.status !== "paused") return;
  job.status = "queued";
  job.error = undefined;
  if (!queue.includes(bookHash)) queue.push(bookHash);
  queueGloballyPaused = false;
  emit();
  void pump();
}

export function isBookCacheQueuePaused(): boolean {
  return queueGloballyPaused;
}

export function pauseAllBookCache(): void {
  queueGloballyPaused = true;
  for (const id of [...queue]) pauseBookCacheJob(id);
  for (const [id, job] of jobs) {
    if (job.status === "downloading") pauseBookCacheJob(id);
  }
  emit();
  toast.info("已暂停书籍缓存");
}

export function resumeAllBookCache(): void {
  queueGloballyPaused = false;
  let n = 0;
  for (const [id, job] of jobs) {
    if (job.status === "paused") {
      resumeBookCacheJob(id);
      n += 1;
    }
  }
  if (n === 0) emit();
  else toast.info(`继续缓存 ${n} 本`);
}

export async function removeLocalBookCache(bookHash: string): Promise<void> {
  cancelBookCacheJob(bookHash);
  await deleteBookFile(bookHash);
  jobs.delete(bookHash);
  cachedHashSet.delete(bookHash);
  emit();
}

export async function removeLocalBookCaches(hashes: string[]): Promise<void> {
  for (const h of hashes) cancelBookCacheJob(h);
  await deleteBookFiles(hashes);
  for (const h of hashes) {
    jobs.delete(h);
    cachedHashSet.delete(h);
  }
  emit();
  toast.success(`已删除 ${hashes.length} 本本地缓存`);
}

export async function clearLocalBookCache(): Promise<void> {
  for (const id of [...queue]) cancelBookCacheJob(id);
  for (const [id, job] of jobs) {
    if (job.status === "downloading") cancelBookCacheJob(id);
  }
  await clearAllBookFiles();
  jobs.clear();
  queue.length = 0;
  cachedHashSet = new Set();
  emit();
  toast.success("已清空本地书籍缓存");
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0 && !queueGloballyPaused) {
      const bookHash = queue.shift()!;
      const job = jobs.get(bookHash);
      if (!job || job.status === "cancelled" || job.status === "paused") continue;
      await runOne(job);
      if (queueGloballyPaused) break;
    }
  } finally {
    running = false;
    if (queue.length > 0 && !queueGloballyPaused) void pump();
  }
}

async function runOne(job: BookCacheJob): Promise<void> {
  if (queueGloballyPaused || job.status === "paused" || job.status === "cancelled") {
    return;
  }
  job.status = "downloading";
  job.progress = 0;
  job.error = undefined;
  job.receivedBytes = 0;
  emit();

  const ac = new AbortController();
  abortControllers.set(job.bookHash, ac);

  try {
    if (await hasBookFile(job.bookHash)) {
      cachedHashSet.add(job.bookHash);
      job.status = "done";
      job.progress = 1;
      emit();
      return;
    }

    if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");

    const token = (() => {
      try {
        return localStorage.getItem("super-token") || "";
      } catch {
        return "";
      }
    })();
    const url = `${getServerUrl()}/api/attachments/${encodeURIComponent(job.attachmentId)}?download=1`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ac.signal,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`下载失败 HTTP ${response.status}`);
    }

    const totalHeader = response.headers.get("content-length");
    const total = totalHeader ? parseInt(totalHeader, 10) : NaN;
    if (Number.isFinite(total) && total > BOOK_CACHE_MAX_BYTES) {
      throw new Error(
        `文件过大（${(total / (1024 * 1024)).toFixed(0)} MB），超过书籍缓存上限`,
      );
    }
    if (Number.isFinite(total) && total > 0) job.totalBytes = total;
    else if (job.size && job.size > 0) job.totalBytes = job.size;

    let blob: Blob;
    if (!response.body) {
      blob = await response.blob();
      job.progress = 1;
      job.receivedBytes = blob.size;
      job.totalBytes = blob.size;
      emit();
    } else {
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      const knownTotal = job.totalBytes;
      for (;;) {
        if (ac.signal.aborted) {
          reader.cancel().catch(() => {});
          throw new DOMException("Aborted", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          job.receivedBytes = received;
          if (received > BOOK_CACHE_MAX_BYTES) {
            reader.cancel().catch(() => {});
            throw new Error("文件过大，超过书籍缓存上限");
          }
          if (knownTotal && knownTotal > 0) {
            job.progress = Math.min(0.99, received / knownTotal);
          } else {
            job.progress = -1;
          }
          emitProgress();
        }
      }
      blob = new Blob(chunks);
      job.progress = 1;
      job.receivedBytes = blob.size;
      job.totalBytes = blob.size;
      emit();
    }

    if (blob.size < 64) {
      throw new Error("下载内容异常（文件过小）");
    }

    await putBookFile(job.bookHash, blob, {
      title: job.title,
      format: job.format,
    });
    cachedHashSet.add(job.bookHash);
    job.status = "done";
    job.progress = 1;
    emit();
    toast.success(`「${job.title}」已缓存`);
  } catch (e: any) {
    const current = jobs.get(job.bookHash);
    const aborted =
      e?.name === "AbortError" ||
      ac.signal.aborted ||
      current?.status === "cancelled" ||
      current?.status === "paused";
    if (aborted) {
      if (current?.status === "paused") {
        emit();
        return;
      }
      job.status = "cancelled";
      job.progress = 0;
      job.receivedBytes = 0;
      emit();
      return;
    }
    let msg = e?.message || "缓存失败";
    if (e?.name === "QuotaExceededError" || /quota/i.test(msg) || msg.includes("存储空间")) {
      msg = "存储空间不足，请清理缓存后重试";
    }
    job.status = "error";
    job.error = msg;
    job.progress = 0;
    emit();
    toast.error(msg.includes(job.title) ? msg : `「${job.title}」${msg}`);
  } finally {
    abortControllers.delete(job.bookHash);
  }
}

// 启动时尝试刷新集合（localStore 就绪后）
if (typeof window !== "undefined") {
  void refreshCachedBookHashSet().catch(() => {});
}
