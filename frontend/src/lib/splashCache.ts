/**
 * APP 启动闪屏本地缓存（鉴权下载后落 IndexedDB）
 * ---------------------------------------------------------------------------
 * 冷启动展示只读此处：已下载 + 未过期 → 展示；否则品牌默认。
 * 与云端同步见 splashSync.ts。休息屏保仍走 splashStorage.ts。
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "fuyou-splash-cache";
const DB_VERSION = 1;
const STORE = "workspace-splash";

export type SplashCacheRecord = {
  workspaceId: string;
  imageId: string;
  blob: Blob;
  displayDurationSec: number;
  expiresAt: string | null;
  updatedAt: string;
  mimeType?: string;
};

export type ReadySplash = {
  workspaceId: string;
  imageId: string;
  dataUrl: string;
  displayDurationSec: number;
  expiresAt: string | null;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "workspaceId" });
        }
      },
    });
  }
  return dbPromise;
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return Date.now() >= t;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function getSplashCache(
  workspaceId: string,
): Promise<SplashCacheRecord | null> {
  if (!workspaceId) return null;
  try {
    const db = await getDb();
    const row = (await db.get(STORE, workspaceId)) as SplashCacheRecord | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * 冷启动展示用：有 blob、未过期才返回 data URL。
 * 过期则顺带清缓存。
 */
export async function getReadySplashForDisplay(
  workspaceId: string,
): Promise<ReadySplash | null> {
  if (!workspaceId || workspaceId === "personal") return null;
  const row = await getSplashCache(workspaceId);
  if (!row?.blob) return null;
  if (isExpired(row.expiresAt)) {
    await clearSplashCache(workspaceId);
    return null;
  }
  try {
    const dataUrl = await blobToDataUrl(row.blob);
    return {
      workspaceId: row.workspaceId,
      imageId: row.imageId,
      dataUrl,
      displayDurationSec: Math.min(30, Math.max(1, row.displayDurationSec || 5)),
      expiresAt: row.expiresAt,
    };
  } catch {
    return null;
  }
}

/** 写入缓存；imageId 变化时覆盖同一 workspace 键（旧 blob 自动被替换） */
export async function putSplashCache(record: SplashCacheRecord): Promise<void> {
  if (!record.workspaceId) return;
  const db = await getDb();
  await db.put(STORE, {
    ...record,
    displayDurationSec: Math.min(30, Math.max(1, record.displayDurationSec || 5)),
  });
}

export async function clearSplashCache(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  try {
    const db = await getDb();
    await db.delete(STORE, workspaceId);
  } catch {
    /* ignore */
  }
}

export async function purgeExpiredSplash(workspaceId?: string): Promise<void> {
  try {
    const db = await getDb();
    if (workspaceId) {
      const row = (await db.get(STORE, workspaceId)) as SplashCacheRecord | undefined;
      if (row && isExpired(row.expiresAt)) await db.delete(STORE, workspaceId);
      return;
    }
    const all = (await db.getAll(STORE)) as SplashCacheRecord[];
    for (const row of all) {
      if (isExpired(row.expiresAt)) await db.delete(STORE, row.workspaceId);
    }
  } catch {
    /* ignore */
  }
}
