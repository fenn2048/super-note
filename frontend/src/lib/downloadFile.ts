/**
 * downloadFile —— 通用附件下载工具
 * ---------------------------------------------------------------------------
 *   - 同源：原生 <a download>
 *   - Android：优先原生流式 downloadFromUrl（避免 base64 OOM）
 *   - 跨源 Web：fetch + blob
 */

import { getToken } from "@/lib/api";

declare global {
  interface Window {
    AndroidDownloadBridge?: {
      downloadFile: (base64: string, filename: string, mimeType: string) => void;
      downloadFromUrl?: (
        url: string,
        filename: string,
        mimeType: string,
        token: string,
      ) => void;
      /** 系统浏览器打开外链（更新页 / GitHub 等） */
      openExternalUrl?: (url: string) => void;
      shareText?: (text: string, title: string) => void;
      shareFile?: (base64: string, filename: string, mimeType: string) => void;
    };
  }
}

/** 在系统浏览器中打开 URL（Android 原生桥优先，避免 WebView SPA 吞链） */
export function openExternalUrl(url: string): void {
  if (!url) return;
  const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;
  if (bridge?.openExternalUrl) {
    bridge.openExternalUrl(url);
    return;
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.location.href = url;
  }
}

/** 下载远程 APK/安装包：Android 走原生流式并调起安装；其它端触发浏览器下载 */
export function downloadApkFromUrl(url: string, filename = "super-note.apk"): void {
  const abs = toAbsoluteUrl(url);
  const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;
  if (bridge?.downloadFromUrl) {
    const token = getToken() || "";
    bridge.downloadFromUrl(
      abs,
      filename,
      "application/vnd.android.package-archive",
      token,
    );
    return;
  }
  try {
    const a = document.createElement("a");
    a.href = abs;
    a.download = filename || "super-note.apk";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    openExternalUrl(abs);
  }
}

export async function downloadAttachment(url: string, filename: string): Promise<void> {
  if (!url) throw new Error("缺少下载链接");

  const downloadUrl = withDownloadFlag(url);
  const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;

  // Android：原生 HTTP 流式写入 Downloads
  if (bridge?.downloadFromUrl) {
    const abs = toAbsoluteUrl(downloadUrl);
    const token = getToken() || "";
    bridge.downloadFromUrl(abs, filename || "download.bin", "", token);
    return;
  }

  if (bridge?.downloadFile) {
    const res = await fetch(downloadUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return downloadBlob(blob, filename);
  }

  if (isSameOrigin(downloadUrl)) {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const res = await fetch(downloadUrl, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  await downloadBlob(blob, filename);
}

/**
 * 直接下载内存中的 Blob 对象
 */
export function downloadBlob(blob: Blob, filename: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;
    if (bridge?.downloadFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64data = (reader.result as string).split(",")[1];
          bridge.downloadFile(base64data, filename, blob.type || "application/octet-stream");
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
      return;
    }

    const objUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename || "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    }
  });
}

/** 系统分享文本（Android 原生 chooser；其它端复制到剪贴板） */
export async function shareText(text: string, title = "分享"): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;
  if (bridge?.shareText) {
    bridge.shareText(text, title);
    return;
  }
  if (typeof navigator !== "undefined" && navigator.share) {
    await navigator.share({ title, text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("当前环境不支持分享");
}

/** 分享小文件（base64 经原生 FileProvider） */
export async function shareBlob(blob: Blob, filename: string): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.AndroidDownloadBridge : undefined;
  if (bridge?.shareFile) {
    const base64 = await blobToBase64(blob);
    bridge.shareFile(base64, filename, blob.type || "application/octet-stream");
    return;
  }
  if (typeof navigator !== "undefined" && navigator.share && typeof File !== "undefined") {
    const file = new File([blob], filename, { type: blob.type });
    await navigator.share({ files: [file], title: filename });
    return;
  }
  await downloadBlob(blob, filename);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = reader.result as string;
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function withDownloadFlag(url: string): string {
  if (/[?&]download=1(?:&|$|#)/.test(url)) return url;
  const hashIdx = url.indexOf("#");
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}download=1${hash}`;
}

function isSameOrigin(url: string): boolean {
  try {
    if (url.startsWith("/") && !url.startsWith("//")) return true;
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}
