/**
 * 与 super-note 后端的 HTTP 交互。
 *
 * 认证方式（推荐顺序）：
 *   1) API Token（nkn_…，设置 → 访问令牌）— 插件首选，长期有效
 *   2) 账号登录 JWT — Options「高级」路径，会过期
 * 请求头统一：Authorization: Bearer <token>
 */
import { normalizeBaseUrl, type SuperClipperConfig } from "./storage";

export interface ImportNotePayload {
  title: string;
  /** HTML 字符串。若 outputFormat=markdown，服务端不解析图片 data URI——所以我们走"HTML 里嵌 data:image" 的老路 */
  content: string;
  contentText: string;
  /** 可选：按路径归属到某笔记本（从根到叶） */
  notebookPath?: string[];
  /** 单层向后兼容 */
  notebookName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportResponse {
  success: boolean;
  count: number;
  notebookId: string;
  notebookIds: string[];
  notes: { id: string; title: string; notebookId: string }[];
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    avatarUrl: string | null;
    displayName: string | null;
    role: string;
    createdAt: string;
    mustChangePassword?: boolean;
  };
  /** 若用户开启了 2FA，返回此字段而非 token */
  requires2FA?: boolean;
  ticket?: string;
}

export class SuperApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "SuperApiError";
  }
}

function authHeaders(cfg: SuperClipperConfig): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  };
}

async function parseErr(res: Response): Promise<SuperApiError> {
  let code: string | undefined;
  let message = res.statusText;
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    code = data.code;
    if (data.error) message = data.error;
  } catch {
    try {
      message = (await res.text()) || message;
    } catch {
      /* ignore */
    }
  }
  return new SuperApiError(res.status, code, `[${res.status}] ${message}`);
}

/**
 * 登录：POST /api/auth/login
 * 返回 JWT token 和用户信息。
 * 注意：如果用户开启了 2FA，返回 requires2FA=true + ticket，需要额外处理。
 */
export async function login(
  serverUrl: string,
  username: string,
  password: string,
): Promise<LoginResponse> {
  const base = normalizeBaseUrl(serverUrl);
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as LoginResponse;
}

/**
 * 2FA 验证：POST /api/auth/2fa/verify
 * 登录第二步：凭 ticket + TOTP 码换取真正的 login token。
 */
export async function verify2FA(
  serverUrl: string,
  ticket: string,
  code: string,
): Promise<LoginResponse> {
  const base = normalizeBaseUrl(serverUrl);
  const res = await fetch(`${base}/api/auth/2fa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, code }),
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as LoginResponse;
}

/** 探活 + token 校验：GET /api/me 成功即代表 token 有效 */
export async function ping(cfg: SuperClipperConfig): Promise<{ username: string; role: string }> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const res = await fetch(`${base}/api/me`, {
    method: "GET",
    headers: authHeaders(cfg),
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as { username: string; role: string };
}

/** 获取笔记本树（打平过的列表） */
export async function listNotebooks(
  cfg: SuperClipperConfig,
): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const res = await fetch(`${base}/api/notebooks`, { headers: authHeaders(cfg) });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as Array<{ id: string; name: string; parentId: string | null }>;
}

/** 导入一条笔记。
 *
 * 关键点：我们提交的 content 是 HTML；后端 `export/import` 路由会自动调用
 * `extractInlineBase64Images` 把 <img src="data:image/..."> 抽成 /api/attachments/<id>，
 * 因此"图片随正文一起提交"对调用方是零感知的。
 */
export async function importNote(
  cfg: SuperClipperConfig,
  payload: ImportNotePayload,
): Promise<ImportResponse> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const body: Record<string, unknown> = {
    notes: [
      {
        title: payload.title,
        content: payload.content,
        contentText: payload.contentText,
        notebookName: payload.notebookName,
        notebookPath: payload.notebookPath,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      },
    ],
  };
  // 如果 payload 给了 notebookName 作为全局归属（优先级更高）
  if (payload.notebookName && !payload.notebookPath) {
    body.notebookName = payload.notebookName;
  }

  const res = await fetch(`${base}/api/export/import`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as ImportResponse;
}

// ============================================================
// AI 优化：剪藏正文 → LLM 增强 → 返回结构化结果
// ------------------------------------------------------------
//
// 对应后端 POST /api/ai/clip-enhance（非流式）。
// 注意失败语义：后端把"AI 服务调用失败"包装成 HTTP 200 + ok:false，
// 这样客户端可以根据 cfg.aiFailureStrategy 决定是降级保存原文还是整体失败，
// 而不是触发 fetch 的异常路径。HTTP 4xx/5xx 仍走异常抛出。
// ============================================================

export interface AIEnhanceRequest {
  title?: string;
  url?: string;
  siteName?: string;
  contentText: string;
  tasks: {
    summary?: boolean;
    outline?: boolean;
    tags?: boolean;
    title?: boolean;
    highlight?: boolean;
    translation?: boolean;
  };
  language?: "zh-CN" | "en";
  customInstruction?: string;
  maxInputChars?: number;
}

export interface AIEnhanceResult {
  ok: boolean;
  error?: string;
  enhanced?: {
    title?: string;
    summary?: string;
    outline?: string;
    tags?: string[];
    highlights?: string[];
    translation?: string;
  };
  model?: string;
  truncated?: boolean;
}

export async function enhanceClip(
  cfg: SuperClipperConfig,
  payload: AIEnhanceRequest,
): Promise<AIEnhanceResult> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const res = await fetch(`${base}/api/ai/clip-enhance`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(payload),
  });
  // 4xx / 5xx 走异常路径
  if (!res.ok) throw await parseErr(res);
  // 200 同时可能携带 ok:false（AI 服务自身的逻辑失败，例如超时、JSON 解析失败）
  return (await res.json()) as AIEnhanceResult;
}

export interface SaveClipPayload {
  type: "note" | "diary";
  title?: string;
  content?: string;
  contentText?: string;
  workspaceId?: string | null;
  notebookId?: string | null;
  tags?: string[] | string;
  images?: string[];
  mood?: string;
  visibility?: string;
}

export async function getClipWorkspaces(cfg: SuperClipperConfig): Promise<any[]> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const res = await fetch(`${base}/api/clip/workspaces`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as any[];
}

export async function getClipNotebooks(cfg: SuperClipperConfig, workspaceId?: string): Promise<any[]> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const url = workspaceId
    ? `${base}/api/clip/notebooks?workspaceId=${encodeURIComponent(workspaceId)}`
    : `${base}/api/clip/notebooks`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as any[];
}

export async function uploadClipImage(
  cfg: SuperClipperConfig,
  file: File | Blob,
  workspaceId?: string | null,
): Promise<{ id: string; url: string; mimeType: string; size: number }> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const url = workspaceId
    ? `${base}/api/clip/upload-img?workspaceId=${encodeURIComponent(workspaceId)}`
    : `${base}/api/clip/upload-img`;
  
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
    body: formData,
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as { id: string; url: string; mimeType: string; size: number };
}

export async function saveClip(cfg: SuperClipperConfig, payload: SaveClipPayload): Promise<{ success: boolean; id: string }> {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const res = await fetch(`${base}/api/clip/save`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as { success: boolean; id: string };
}

