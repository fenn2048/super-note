/**
 * 扩展存储：配置（sync）+ 最近剪藏历史（local）
 */

import type { AIEnhanceMode, AIEnhanceTasks, ClipMode } from "./protocol";

export interface SuperClipperConfig {
  serverUrl: string;
  /** 展示用用户名（Token 模式可为空） */
  username: string;
  /**
   * 鉴权凭证：推荐 API Token（nkn_… 长期有效）；
   * Options「账号登录」拿到的 JWT 也可，但会过期。
   */
  token: string;
  displayName: string;
  /** 默认笔记本名称（后端自动创建） */
  defaultNotebook: string;
  defaultTags: string;
  imageMode: "skip" | "link" | "inline";
  imageLocalization: boolean;
  includeSource: boolean;
  outputFormat: "markdown" | "html";
  quickCapture: boolean;
  quickCaptureMode: ClipMode;
  aiEnhanceEnabled: boolean;
  aiEnhanceTasks: AIEnhanceTasks;
  aiEnhanceMode: AIEnhanceMode;
  aiEnhanceLanguage: "zh-CN" | "en";
  aiCustomInstruction: string;
  aiMaxInputChars: number;
  aiFailureStrategy: "fallback" | "fail";
  /** 上次工作区 id（不再使用 "personal"） */
  lastWorkspaceId?: string;
  lastNotebookId?: string;
  /** token | login — 仅 UI 提示 */
  authMethod?: "token" | "login";
}

export interface ClipHistoryItem {
  id: string;
  title: string;
  noteId?: string;
  ok: boolean;
  at: number;
  error?: string;
}

const DEFAULTS: SuperClipperConfig = {
  serverUrl: "",
  username: "",
  token: "",
  displayName: "",
  defaultNotebook: "剪藏笔记",
  defaultTags: "",
  imageMode: "inline",
  imageLocalization: true,
  includeSource: true,
  outputFormat: "markdown",
  quickCapture: false,
  quickCaptureMode: "article",
  aiEnhanceEnabled: false,
  aiEnhanceTasks: {
    summary: true,
    tags: true,
    outline: false,
    title: false,
    highlight: false,
    translation: false,
  },
  aiEnhanceMode: "prepend",
  aiEnhanceLanguage: "zh-CN",
  aiCustomInstruction: "",
  aiMaxInputChars: 6000,
  aiFailureStrategy: "fallback",
  lastWorkspaceId: "",
  lastNotebookId: "__default__",
  authMethod: "token",
};

const CONFIG_KEY = "superClipperConfig";
const HISTORY_KEY = "superClipperHistory";
const HISTORY_MAX = 8;

function migrateConfig(raw: Partial<SuperClipperConfig>): SuperClipperConfig {
  const merged = { ...DEFAULTS, ...raw } as SuperClipperConfig;
  if (raw.aiEnhanceTasks) {
    merged.aiEnhanceTasks = { ...DEFAULTS.aiEnhanceTasks, ...raw.aiEnhanceTasks };
  }
  // 废弃 personal 个人空间
  if (merged.lastWorkspaceId === "personal" || merged.lastWorkspaceId === "undefined") {
    merged.lastWorkspaceId = "";
  }
  // 旧默认「Web 剪藏」→ 剪藏笔记
  if (merged.defaultNotebook === "Web 剪藏") {
    merged.defaultNotebook = "剪藏笔记";
  }
  if (!merged.authMethod) {
    merged.authMethod = merged.token?.startsWith("nkn_") ? "token" : "login";
  }
  return merged;
}

export async function getConfig(): Promise<SuperClipperConfig> {
  const store = chrome.storage.sync || chrome.storage.local;
  const data = (await store.get(CONFIG_KEY)) as Record<string, unknown>;
  const raw = (data[CONFIG_KEY] || {}) as Partial<SuperClipperConfig>;
  return migrateConfig(raw);
}

export async function setConfig(patch: Partial<SuperClipperConfig>): Promise<SuperClipperConfig> {
  const current = await getConfig();
  const merged = migrateConfig({ ...current, ...patch });
  const store = chrome.storage.sync || chrome.storage.local;
  await store.set({ [CONFIG_KEY]: merged });
  return merged;
}

export function isConfigured(cfg: SuperClipperConfig): boolean {
  return !!cfg.serverUrl?.trim() && !!cfg.token?.trim();
}

export function normalizeBaseUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    cleaned = "http://" + cleaned;
  }
  return cleaned;
}

/** 打开笔记：主站笔记列表（深链 noteId 暂无统一 hash，落到 notes） */
export function noteOpenUrl(serverUrl: string, noteId?: string): string {
  const base = normalizeBaseUrl(serverUrl);
  if (noteId) {
    // 主站以 SPA hash 为主；笔记 id 写入 query 供将来扩展
    return `${base}/#/notes?clipNoteId=${encodeURIComponent(noteId)}`;
  }
  return `${base}/#/notes`;
}

export async function getClipHistory(): Promise<ClipHistoryItem[]> {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const list = data[HISTORY_KEY];
    return Array.isArray(list) ? (list as ClipHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export async function pushClipHistory(
  item: Omit<ClipHistoryItem, "id" | "at"> & { id?: string; at?: number },
): Promise<void> {
  const prev = await getClipHistory();
  const next: ClipHistoryItem = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: item.title || "无标题",
    noteId: item.noteId,
    ok: item.ok,
    error: item.error,
    at: item.at || Date.now(),
  };
  const list = [next, ...prev].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}
