/**
 * downloadFile —— 通用附件下载工具
 * ---------------------------------------------------------------------------
 * 解决"第一次点击不下载、第二次才下载"的问题。
 *
 * 根因：以前所有场景都走 fetch → blob → a.click()，但 fetch 是异步的；
 * 等 fetch 完成后再 click() 时，浏览器的"用户手势"上下文已经超时，
 * 第一次点击会被静默拦截；第二次点击因为命中缓存 fetch 几乎瞬时，才能下载。
 *
 * 修复策略：
 *   - 同源：走原生 <a download>，同步触发，永远不丢失用户手势。
 *   - 跨源（桌面客户端连远端服务器场景）：仍然走 fetch+blob，
 *     因为跨源下 <a download> 的 filename 属性会被忽略，体验更糟。
 *   - Android 混合 App 环境：通过 AndroidDownloadBridge 传递 Base64 数据并保存。
 *
 * 同源判断只看 origin，不依赖具体协议/端口 of window.location。
 */

export async function downloadAttachment(url: string, filename: string): Promise<void> {
  if (!url) throw new Error("缺少下载链接");

  const downloadUrl = withDownloadFlag(url);

  // Android WebView 环境：调用 Java 注入的原生桥接接口
  if ((window as any).AndroidDownloadBridge) {
    const res = await fetch(downloadUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64data = (reader.result as string).split(",")[1];
          (window as any).AndroidDownloadBridge.downloadFile(base64data, filename, blob.type);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  if (isSameOrigin(downloadUrl)) {
    // 同源——原生 <a download>，同步触发，零手势丢失风险
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  // 跨源——fetch 成 blob 再触发，保留 download 属性
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
    // Android WebView 环境：调用 Java 注入的原生桥接接口
    if ((window as any).AndroidDownloadBridge) {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64data = (reader.result as string).split(",")[1];
          (window as any).AndroidDownloadBridge.downloadFile(base64data, filename, blob.type);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
      return;
    }

    // 浏览器/标准 WebView 环境
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
      // 下一帧再 revoke，避免部分浏览器还没启动下载就被回收
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    }
  });
}

// 给 URL 追加 download=1 query。已有就保留，不重复追加。
function withDownloadFlag(url: string): string {
  if (/[?&]download=1(?:&|$|#)/.test(url)) return url;
  const hashIdx = url.indexOf("#");
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}download=1${hash}`;
}

// 内部判断同源——只看 origin，不依赖具体协议/端口的硬编码
function isSameOrigin(url: string): boolean {
  try {
    if (url.startsWith("/") && !url.startsWith("//")) return true;
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}
