/**
 * 用户自定义本机图片（启动闪屏 / 休息屏保）
 * ---------------------------------------------------------------------------
 * 存 IndexedDB（Web / Capacitor WebView 通用）；展示侧走 data URL。
 * 不上云；原生 Capacitor SplashScreen 资源仍用品牌默认图（打包写死）。
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "fuyou-splash";
const STORE = "images";
const KEY_SPLASH = "custom-splash";
const KEY_SCREENSAVER = "custom-screensaver";
/** @deprecated 兼容旧调用 */
const KEY = KEY_SPLASH;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 1920;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

async function getImageDataUrl(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const blob = (await db.get(STORE, key)) as Blob | undefined;
    if (!blob) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

async function clearImage(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, key);
}

async function saveImageFromFile(key: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > MAX_BYTES * 2) {
    throw new Error("图片过大，请选择 5MB 以内的图片");
  }
  const dataUrl = await readAndCompress(file);
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size > MAX_BYTES) {
    throw new Error("压缩后仍超过 5MB，请换更小的图片");
  }
  const db = await getDb();
  await db.put(STORE, blob, key);
  return dataUrl;
}

export async function hasCustomSplash(): Promise<boolean> {
  try {
    const db = await getDb();
    const v = await db.get(STORE, KEY_SPLASH);
    return !!v;
  } catch {
    return false;
  }
}

export async function getCustomSplashDataUrl(): Promise<string | null> {
  return getImageDataUrl(KEY_SPLASH);
}

export async function clearCustomSplash(): Promise<void> {
  await clearImage(KEY_SPLASH);
}

/**
 * 压缩并保存用户选择的启动闪屏图（本机，不上云）。
 * @returns data URL 预览
 */
export async function saveCustomSplashFromFile(file: File): Promise<string> {
  return saveImageFromFile(KEY_SPLASH, file);
}

/** 本机休息屏保图 */
export async function getCustomScreensaverDataUrl(): Promise<string | null> {
  return getImageDataUrl(KEY_SCREENSAVER);
}

export async function clearCustomScreensaver(): Promise<void> {
  await clearImage(KEY_SCREENSAVER);
}

export async function saveCustomScreensaverFromFile(file: File): Promise<string> {
  return saveImageFromFile(KEY_SCREENSAVER, file);
}

export async function hasCustomScreensaver(): Promise<boolean> {
  try {
    const db = await getDb();
    return !!(await db.get(STORE, KEY_SCREENSAVER));
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function readAndCompress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法处理图片"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const out = canvas.toDataURL("image/jpeg", 0.88);
        URL.revokeObjectURL(url);
        resolve(out);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}
