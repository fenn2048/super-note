/**
 * 工作区闪屏同步：冷/热启动拉 meta + 鉴权下载缓存到本机
 * ---------------------------------------------------------------------------
 * - 仅 native APP 调用（调用方负责 isNativePlatform 判断）
 * - 失败静默，不阻塞启动
 * - 新 imageId 覆盖旧缓存；过期 / 未配置则清本地
 */
import { api, getCurrentWorkspace, getToken, type WorkspaceSplashMeta } from "@/lib/api";
import {
  clearSplashCache,
  getSplashCache,
  putSplashCache,
  purgeExpiredSplash,
} from "@/lib/splashCache";

let syncInFlight: Promise<void> | null = null;
let lastSyncAt = 0;
const MIN_INTERVAL_MS = 3_000;

export async function syncWorkspaceSplash(
  workspaceId?: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (syncInFlight) return syncInFlight;

  const run = async () => {
    const ws =
      workspaceId && workspaceId !== "personal"
        ? workspaceId
        : getCurrentWorkspace();
    if (!ws || ws === "personal") return;
    if (!getToken()) return;

    const now = Date.now();
    if (!opts?.force && now - lastSyncAt < MIN_INTERVAL_MS) return;
    lastSyncAt = now;

    await purgeExpiredSplash(ws);

    let meta: WorkspaceSplashMeta;
    try {
      meta = await api.getWorkspaceSplash(ws);
    } catch (e) {
      console.warn("[splashSync] get meta failed", e);
      return;
    }

    if (!meta.configured || meta.expired) {
      await clearSplashCache(ws);
      return;
    }

    const local = await getSplashCache(ws);
    if (
      local &&
      local.imageId === meta.imageId &&
      local.blob &&
      local.blob.size > 0
    ) {
      // 仅刷新 meta 字段（时长/过期可能被管理员改过）
      if (
        local.displayDurationSec !== meta.displayDurationSec ||
        local.expiresAt !== meta.expiresAt ||
        local.updatedAt !== meta.updatedAt
      ) {
        await putSplashCache({
          ...local,
          displayDurationSec: meta.displayDurationSec,
          expiresAt: meta.expiresAt,
          updatedAt: meta.updatedAt,
          mimeType: meta.mimeType,
        });
      }
      return;
    }

    // imageId 变化或本地无图 → 鉴权下载，自动覆盖旧缓存
    try {
      const blob = await api.downloadWorkspaceSplashImage(ws);
      if (!blob || blob.size === 0) return;
      await putSplashCache({
        workspaceId: ws,
        imageId: meta.imageId,
        blob,
        displayDurationSec: meta.displayDurationSec,
        expiresAt: meta.expiresAt,
        updatedAt: meta.updatedAt,
        mimeType: meta.mimeType,
      });
    } catch (e: any) {
      if (e?.status === 410 || e?.code === "EXPIRED") {
        await clearSplashCache(ws);
      } else {
        console.warn("[splashSync] download failed", e);
      }
    }
  };

  syncInFlight = run().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
