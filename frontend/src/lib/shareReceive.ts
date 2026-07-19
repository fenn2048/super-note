/**
 * Android 系统分享入站（ShareReceive 插件）
 * ---------------------------------------------------------------------------
 * 原生解析 ACTION_SEND → 前端创建笔记 / URL 导入 / 附图。
 * 未登录时暂存 sessionStorage，登录后再处理。
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { api } from "@/lib/api";
import { isNativePlatform } from "@/hooks/useCapacitor";

export interface ShareFileItem {
  mimeType: string;
  filename: string;
  base64: string;
  size: number;
}

export interface SharePayload {
  type: "text" | "url" | "image" | "images" | "file" | "mixed";
  text?: string;
  url?: string;
  subject?: string;
  images?: ShareFileItem[];
  files?: ShareFileItem[];
}

interface ShareReceivePlugin {
  consumePending(): Promise<{ share: SharePayload | null }>;
  clearPending(): Promise<void>;
  addListener(
    eventName: "shareReceived",
    listener: (payload: SharePayload) => void,
  ): Promise<PluginListenerHandle>;
}

const STORAGE_KEY = "super:pending-share";
const WEIXIN_RE = /^https?:\/\/mp\.weixin\.qq\.com\/s[\/?]/i;

function getPlugin(): ShareReceivePlugin | null {
  if (!isNativePlatform()) return null;
  try {
    return registerPlugin<ShareReceivePlugin>("ShareReceive");
  } catch {
    return null;
  }
}

export function stashSharePayload(payload: SharePayload): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(
    new CustomEvent("super:pending-share-trigger", { detail: payload }),
  );
}

export function peekStashedShare(): SharePayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SharePayload;
  } catch {
    return null;
  }
}

export function clearStashedShare(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function base64ToFile(item: ShareFileItem): File {
  const bin = atob(item.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: item.mimeType || "application/octet-stream" });
  return new File([blob], item.filename || "shared.bin", {
    type: item.mimeType || "application/octet-stream",
  });
}

async function resolveInboxNotebookId(): Promise<string> {
  const nbs = await api.getNotebooks();
  const preferred = nbs.find(
    (n) =>
      n.name === "剪藏笔记" ||
      n.name === "分享" ||
      n.name === "Web 剪藏" ||
      n.name === "系统分享",
  );
  if (preferred?.id) return preferred.id;
  if (nbs[0]?.id) return nbs[0].id;
  const created = await api.createNotebook({ name: "剪藏笔记", icon: "📥" });
  return created.id;
}

function titleFromShare(payload: SharePayload): string {
  if (payload.subject?.trim()) return payload.subject.trim().slice(0, 80);
  if (payload.type === "url" && payload.url) {
    try {
      return new URL(payload.url).hostname + " 分享";
    } catch {
      return "链接分享";
    }
  }
  if (payload.text?.trim()) {
    const line = payload.text.trim().split(/\n/)[0];
    return line.slice(0, 40) || "分享内容";
  }
  if (payload.images?.length) return `分享图片 (${payload.images.length})`;
  if (payload.files?.length) return `分享文件 (${payload.files.length})`;
  return "系统分享";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 处理一份额载入的分享载荷。返回创建的 noteId（若有）。
 */
export async function processSharePayload(
  payload: SharePayload,
): Promise<{ noteId: string; title: string } | null> {
  // 1) 微信文章 → 现有 url-import 管线
  const url = payload.url || (payload.type === "url" ? payload.text : undefined);
  if (url && WEIXIN_RE.test(url.trim())) {
    const result = await api.urlImport(url.trim());
    return { noteId: result.noteId, title: result.title };
  }

  const notebookId = await resolveInboxNotebookId();
  const title = titleFromShare(payload);

  // 2) 纯链接
  if (payload.type === "url" && url) {
    const href = url.trim();
    const body = `<p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>${
      payload.text && payload.text.trim() !== href
        ? `<p>${escapeHtml(payload.text.trim())}</p>`
        : ""
    }<p><em>来自系统分享</em></p>`;
    const note = await api.createNote({
      notebookId,
      title,
      content: body,
    });
    return { noteId: note.id, title: note.title || title };
  }

  // 3) 纯文本
  if (payload.type === "text" && payload.text) {
    const text = payload.text.trim();
    const content = `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p><p><em>来自系统分享</em></p>`;
    const note = await api.createNote({
      notebookId,
      title,
      content,
    });
    return { noteId: note.id, title: note.title || title };
  }

  // 4) 图片 / 文件 / 混合
  const images = payload.images || [];
  const files = payload.files || [];
  if (images.length === 0 && files.length === 0) {
    // 兜底：有 text 就当文本
    if (payload.text?.trim()) {
      return processSharePayload({ ...payload, type: "text" });
    }
    return null;
  }

  let contentParts: string[] = [];
  if (payload.text?.trim()) {
    contentParts.push(
      `<p>${escapeHtml(payload.text.trim()).replace(/\n/g, "<br/>")}</p>`,
    );
  }

  const note = await api.createNote({
    notebookId,
    title,
    content: contentParts.join("") || "<p></p>",
  });

  // 上传图片并嵌入
  for (const item of images) {
    try {
      const file = base64ToFile(item);
      const att = await api.attachments.upload(note.id, file);
      contentParts.push(
        `<p><img src="${att.url}" alt="${escapeHtml(item.filename)}" /></p>`,
      );
    } catch (e) {
      console.warn("[shareReceive] image upload failed", e);
      contentParts.push(`<p>（图片上传失败：${escapeHtml(item.filename)}）</p>`);
    }
  }

  for (const item of files) {
    try {
      const file = base64ToFile(item);
      const att = await api.attachments.upload(note.id, file);
      contentParts.push(
        `<p><a href="${att.url}" download="${escapeHtml(item.filename)}">📎 ${escapeHtml(item.filename)}</a></p>`,
      );
    } catch (e) {
      console.warn("[shareReceive] file upload failed", e);
      contentParts.push(`<p>（文件上传失败：${escapeHtml(item.filename)}）</p>`);
    }
  }

  contentParts.push("<p><em>来自系统分享</em></p>");
  const finalContent = contentParts.join("");
  await api.updateNote(note.id, { content: finalContent, title });
  return { noteId: note.id, title };
}

/**
 * 订阅原生分享 + 冷启动 consume。返回 cleanup。
 * onShare 在任意时刻收到 payload（含冷启动）。
 */
export function subscribeShareReceive(
  onShare: (payload: SharePayload) => void,
): () => void {
  if (!isNativePlatform()) return () => {};

  const plugin = getPlugin();
  if (!plugin) return () => {};

  let cancelled = false;
  let handle: PluginListenerHandle | null = null;

  void plugin.consumePending().then((res) => {
    if (cancelled) return;
    const share = res?.share;
    if (share && typeof share === "object" && (share as SharePayload).type) {
      onShare(share as SharePayload);
    }
  }).catch(() => {});

  void plugin
    .addListener("shareReceived", (payload) => {
      if (cancelled || !payload?.type) return;
      // 事件与 consume 可能重复：由调用方处理去重 / 或 clear 后只走 stash
      onShare(payload);
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
