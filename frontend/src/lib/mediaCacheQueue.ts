/**
 * mediaCacheQueue — 媒体本地缓存下载队列（串行，防移动端 OOM）
 */

import { getBaseUrl, getToken, api } from "@/lib/api";
import {
  putMediaFile,
  deleteMediaFile,
  deleteMediaFiles,
  clearAllMediaFiles,
  getCachedMediaIdSet,
  type MediaCacheType,
  refreshCachedMediaIdSet,
} from "@/lib/mediaFileCache";
import { toast } from "@/lib/toast";

/** 单文件软上限 1.5GB */
export const MEDIA_CACHE_MAX_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);

export type MediaCacheJobStatus =
  | "queued"
  | "downloading"
  | "done"
  | "error"
  | "cancelled";

export interface MediaCacheJobInput {
  mediaId: string;
  type: MediaCacheType;
  title: string;
  alistPath?: string;
}

export interface MediaCacheJob extends MediaCacheJobInput {
  status: MediaCacheJobStatus;
  progress: number; // 0–1，未知长度时下载中为 -1
  error?: string;
  addedAt: number;
}

type Listener = () => void;

const jobs = new Map<string, MediaCacheJob>();
const queue: string[] = [];
const listeners = new Set<Listener>();
let running = false;
const abortControllers = new Map<string, AbortController>();
/** 单调版本号，供 useSyncExternalStore 快照 */
let queueVersion = 0;

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

export function subscribeMediaCacheQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 稳定快照：版本号变化即触发重渲染 */
export function getMediaCacheQueueVersion(): number {
  return queueVersion;
}

export function getMediaCacheJobs(): MediaCacheJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.addedAt - a.addedAt);
}

export function getMediaCacheJob(mediaId: string): MediaCacheJob | undefined {
  return jobs.get(mediaId);
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$|#)/i.test(url);
}

/**
 * 入队缓存。已在队列/下载中则忽略；已完成可强制重新下载。
 */
export function enqueueMediaCache(
  items: MediaCacheJobInput | MediaCacheJobInput[],
  opts?: { force?: boolean },
): void {
  const list = Array.isArray(items) ? items : [items];
  let added = 0;
  let skippedCached = 0;
  const idSet = getCachedMediaIdSet();
  for (const item of list) {
    if (!item?.mediaId) continue;
    const existing = jobs.get(item.mediaId);
    if (existing && (existing.status === "queued" || existing.status === "downloading")) {
      continue;
    }
    if (existing && existing.status === "done" && !opts?.force) {
      skippedCached += 1;
      continue;
    }
    if (!opts?.force && idSet.has(item.mediaId)) {
      skippedCached += 1;
      continue;
    }
    jobs.set(item.mediaId, {
      ...item,
      status: "queued",
      progress: 0,
      addedAt: Date.now(),
    });
    if (!queue.includes(item.mediaId)) queue.push(item.mediaId);
    added += 1;
  }
  if (added > 0) {
    emit();
    void pump();
    if (added === 1) {
      toast.info(`开始缓存「${list.find((x) => jobs.get(x.mediaId)?.status === "queued")?.title || list[0]?.title || "媒体"}」`);
    } else {
      toast.info(`已加入 ${added} 项到缓存队列`);
    }
  } else if (skippedCached > 0 && list.length > 0) {
    toast.info(list.length === 1 ? "该文件已缓存" : "选中项均已缓存");
  }
}

export function cancelMediaCacheJob(mediaId: string): void {
  const job = jobs.get(mediaId);
  if (!job) return;
  if (job.status === "queued") {
    const idx = queue.indexOf(mediaId);
    if (idx >= 0) queue.splice(idx, 1);
    job.status = "cancelled";
    emit();
    return;
  }
  if (job.status === "downloading") {
    abortControllers.get(mediaId)?.abort();
    job.status = "cancelled";
    emit();
  }
}

export async function removeLocalMediaCache(mediaId: string): Promise<void> {
  cancelMediaCacheJob(mediaId);
  await deleteMediaFile(mediaId);
  jobs.delete(mediaId);
  await refreshCachedMediaIdSet();
  emit();
}

export async function removeLocalMediaCaches(ids: string[]): Promise<void> {
  for (const id of ids) cancelMediaCacheJob(id);
  await deleteMediaFiles(ids);
  for (const id of ids) jobs.delete(id);
  await refreshCachedMediaIdSet();
  emit();
  toast.success(`已删除 ${ids.length} 项本地缓存`);
}

export async function clearLocalMediaCache(): Promise<void> {
  // 取消全部进行中
  for (const id of [...queue]) cancelMediaCacheJob(id);
  for (const [id, job] of jobs) {
    if (job.status === "downloading") cancelMediaCacheJob(id);
  }
  await clearAllMediaFiles();
  jobs.clear();
  queue.length = 0;
  await refreshCachedMediaIdSet();
  emit();
  toast.success("已清空本地媒体缓存");
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const mediaId = queue.shift()!;
      const job = jobs.get(mediaId);
      if (!job || job.status === "cancelled") continue;
      await runOne(job);
    }
  } finally {
    running = false;
    // 泵结束后可能又有入队
    if (queue.length > 0) void pump();
  }
}

async function runOne(job: MediaCacheJob): Promise<void> {
  job.status = "downloading";
  job.progress = 0;
  job.error = undefined;
  emit();

  const ac = new AbortController();
  abortControllers.set(job.mediaId, ac);

  try {
    // 1) 探测是否 HLS
    try {
      const res = await api.request<{ url: string }>(`/media/items/${job.mediaId}/play-url`);
      if (res?.url && isHlsUrl(res.url)) {
        throw new Error("HLS 流媒体暂不支持离线缓存");
      }
    } catch (e: any) {
      // play-url 失败时仍尝试 proxy（可能仅探测失败）
      if (e?.message?.includes("HLS") || e?.message?.includes("流媒体")) throw e;
    }

    if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");

    const token = getToken() || "";
    const proxyUrl = `${getBaseUrl()}/media/items/${encodeURIComponent(job.mediaId)}/proxy`;
    const response = await fetch(proxyUrl, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ac.signal,
      credentials: "include",
    });

    if (!response.ok) {
      let msg = `下载失败 HTTP ${response.status}`;
      try {
        const j = await response.json();
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    const contentType = response.headers.get("content-type") || "";
    // 代理对 m3u8 会 302，fetch follow 后可能拿到 playlist 文本
    if (
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8") ||
      (contentType.includes("application/vnd.apple") && contentType.includes("mpegurl"))
    ) {
      throw new Error("HLS 流媒体暂不支持离线缓存");
    }

    const totalHeader = response.headers.get("content-length");
    const total = totalHeader ? parseInt(totalHeader, 10) : NaN;
    if (Number.isFinite(total) && total > MEDIA_CACHE_MAX_BYTES) {
      throw new Error(
        `文件过大（${(total / (1024 * 1024 * 1024)).toFixed(2)} GB），超过缓存上限`,
      );
    }

    const mimeType =
      contentType && !contentType.includes("application/json")
        ? contentType.split(";")[0].trim()
        : guessMime(job);

    let blob: Blob;
    if (!response.body) {
      blob = await response.blob();
      job.progress = 1;
      emit();
    } else {
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (received > MEDIA_CACHE_MAX_BYTES) {
            reader.cancel().catch(() => {});
            throw new Error("文件过大，超过缓存上限");
          }
          if (Number.isFinite(total) && total > 0) {
            job.progress = Math.min(0.99, received / total);
          } else {
            job.progress = -1;
          }
          emit();
        }
      }
      blob = new Blob(chunks, { type: mimeType || undefined });
      job.progress = 1;
      emit();
    }

    // JSON 错误体误当媒体
    if (blob.type.includes("json") || blob.size < 32) {
      try {
        const text = await blob.slice(0, 200).text();
        if (text.trimStart().startsWith("{")) {
          const j = JSON.parse(text);
          throw new Error(j.error || "服务器返回错误，无法缓存");
        }
      } catch (e: any) {
        if (e?.message && !e.message.includes("JSON")) throw e;
      }
    }

    await putMediaFile({
      mediaId: job.mediaId,
      type: job.type,
      title: job.title,
      alistPath: job.alistPath,
      mimeType: blob.type || mimeType,
      blob,
      size: blob.size,
    });

    await refreshCachedMediaIdSet();
    job.status = "done";
    job.progress = 1;
    emit();
    toast.success(`「${job.title}」已缓存`);
  } catch (e: any) {
    const aborted =
      e?.name === "AbortError" ||
      ac.signal.aborted ||
      (jobs.get(job.mediaId)?.status === "cancelled");
    if (aborted) {
      job.status = "cancelled";
      job.progress = 0;
      emit();
      return;
    }
    let msg = e?.message || "缓存失败";
    if (
      e?.name === "QuotaExceededError" ||
      /quota/i.test(msg) ||
      msg.includes("存储空间")
    ) {
      msg = "存储空间不足，请清理缓存后重试";
    }
    job.status = "error";
    job.error = msg;
    job.progress = 0;
    emit();
    toast.error(msg.includes(job.title) ? msg : `「${job.title}」${msg}`);
  } finally {
    abortControllers.delete(job.mediaId);
  }
}

function guessMime(job: MediaCacheJob): string {
  const path = (job.alistPath || job.title || "").toLowerCase();
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".m4a") || path.endsWith(".aac")) return "audio/mp4";
  if (path.endsWith(".flac")) return "audio/flac";
  if (path.endsWith(".ogg") || path.endsWith(".opus")) return "audio/ogg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  if (path.endsWith(".mov")) return "video/quicktime";
  return job.type === "audio" ? "audio/mpeg" : "video/mp4";
}
