/**
 * 扩展存储工具：封装 chrome.storage.local / chrome.storage.sync 的类型安全读写。
 *
 * 约定：
 *   - 所有"配置"（serverUrl / 默认笔记本等）统一放 sync 存储，跨设备同步
 *   - 临时状态（最近剪藏历史）放 local，不上传到云
 */

import type { AIEnhanceMode, AIEnhanceTasks, ClipMode } from "./protocol";

export interface SuperClipperConfig {
  /** 后端地址，例如 https://note.example.com 或 http://localhost:3001 */
  serverUrl: string;
  /** 登录用户名 */
  username: string;
  /** 登录后获取的 JWT（由 POST /api/auth/login 返回） */
  token: string;
  /** 登录用户的显示名 / 角色等（仅用于 UI 展示） */
  displayName: string;
  /** 默认剪藏到的笔记本名称（不存在则自动创建）；为空时进"Web 剪藏"默认 */
  defaultNotebook: string;
  /** 剪藏时默认附加的 tag，逗号分隔 */
  defaultTags: string;
  /** 图片处理模式：skip=不处理，link=保留原始 URL，inline=下载为 base64 内联 */
  imageMode: "skip" | "link" | "inline";
  /** 图片本地化开关：是否自动上传至服务器并替换外链 */
  imageLocalization: boolean;
  /** 是否自动在正文末尾插入"来源 URL"行 */
  includeSource: boolean;
  /** 输出格式：markdown（默认，体积小）|  html（保留更多样式） */
  outputFormat: "markdown" | "html";
  /** 快速捕捉模式：点击扩展图标直接用默认设置剪藏，不弹 popup */
  quickCapture: boolean;
  /** 快速捕捉的默认模式 */
  quickCaptureMode: ClipMode;

  // ========== AI 优化（剪藏后通过 LLM 增强再保存） ==========

  /** 是否默认启用 AI 优化（在 popup 里可临时反向覆盖） */
  aiEnhanceEnabled: boolean;
  /** 默认的 AI 任务勾选 */
  aiEnhanceTasks: AIEnhanceTasks;
  /** AI 产物如何拼回笔记（默认 prepend：摘要置顶 + 原文） */
  aiEnhanceMode: AIEnhanceMode;
  /** AI 优化的输出语言（影响后端 prompt） */
  aiEnhanceLanguage: "zh-CN" | "en";
  /** 用户可自定义补充指令（拼到 system prompt 末尾），留空则不用 */
  aiCustomInstruction: string;
  /** 正文截断字数上限（超出取头+尾） */
  aiMaxInputChars: number;
  /** AI 失败时的策略：fallback=降级保存原文（默认），fail=整体失败 */
  aiFailureStrategy: "fallback" | "fail";
  lastWorkspaceId?: string;
  lastNotebookId?: string;
}

const DEFAULTS: SuperClipperConfig = {
  serverUrl: "",
  username: "",
  token: "",
  displayName: "",
  defaultNotebook: "Web 剪藏",
  defaultTags: "",
  imageMode: "inline",
  imageLocalization: true,
  includeSource: true,
  outputFormat: "markdown",
  quickCapture: false,
  quickCaptureMode: "article",

  // AI 默认行为：默认关闭，主动开启；开启后默认做"摘要 + 标签"两项最稳的
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
  lastWorkspaceId: "personal",
  lastNotebookId: "__default__",
};

const CONFIG_KEY = "superClipperConfig";

/** 读取配置，未设置时返回默认值 */
export async function getConfig(): Promise<SuperClipperConfig> {
  const store = chrome.storage.sync || chrome.storage.local;
  const data = (await store.get(CONFIG_KEY)) as Record<string, unknown>;
  const raw = (data[CONFIG_KEY] || {}) as Partial<SuperClipperConfig>;
  const merged = { ...DEFAULTS, ...raw } as SuperClipperConfig;
  // aiEnhanceTasks 是嵌套对象，浅合并会丢字段——单独深合并
  if (raw.aiEnhanceTasks) {
    merged.aiEnhanceTasks = { ...DEFAULTS.aiEnhanceTasks, ...raw.aiEnhanceTasks };
  }
  return merged;
}

/** 写入配置（浅合并，传入 null 会覆盖为默认） */
export async function setConfig(patch: Partial<SuperClipperConfig>): Promise<SuperClipperConfig> {
  const current = await getConfig();
  const merged = { ...current, ...patch } as SuperClipperConfig;
  const store = chrome.storage.sync || chrome.storage.local;
  await store.set({ [CONFIG_KEY]: merged });
  return merged;
}

/** 简单判断是否"已配置好可用"（至少有 server + token） */
export function isConfigured(cfg: SuperClipperConfig): boolean {
  return !!cfg.serverUrl && !!cfg.token;
}

/** 规范化 baseUrl：去掉末尾斜杠 */
export function normalizeBaseUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    cleaned = "http://" + cleaned;
  }
  return cleaned;
}
