/**
 * 扫码登录：桌面出码 / 移动端解析与确认
 * ---------------------------------------------------------------------------
 * QR payload（勿含 JWT）：
 *   { v:1, t:"web_login", id:"<ticket>", s:"http://server:port" }
 */

import { getBaseUrl, getServerUrl, getToken } from "@/lib/api";

export const QR_LOGIN_TYPE = "web_login" as const;
export const QR_LOGIN_VERSION = 1 as const;

export interface QrLoginPayload {
  v: typeof QR_LOGIN_VERSION;
  t: typeof QR_LOGIN_TYPE;
  /** ticket id */
  id: string;
  /** 桌面端 API origin（无尾斜杠） */
  s: string;
}

export type QrTicketStatus =
  | "pending"
  | "scanned"
  | "confirmed"
  | "consumed"
  | "expired"
  | "cancelled";

export interface QrCreateResult {
  id: string;
  expiresIn: number;
  expiresAt: number;
}

export interface QrStatusResult {
  status: QrTicketStatus;
  token?: string;
  user?: any;
  usernameMasked?: string;
  error?: string;
}

function authApiBase(serverOverride?: string): string {
  if (serverOverride) {
    return `${serverOverride.replace(/\/+$/, "")}/api`;
  }
  return getBaseUrl();
}

/** 规范化服务器 origin，去掉尾斜杠与 /api */
export function normalizeServerOrigin(url: string): string {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/api")) u = u.slice(0, -4).replace(/\/+$/, "");
  return u;
}

export function encodeQrLoginPayload(id: string, serverUrl: string): string {
  const payload: QrLoginPayload = {
    v: QR_LOGIN_VERSION,
    t: QR_LOGIN_TYPE,
    id,
    s: normalizeServerOrigin(serverUrl),
  };
  return JSON.stringify(payload);
}

export function parseQrLoginPayload(raw: string): QrLoginPayload | null {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  // 兼容可能被包装成 supernote://... 或 URL query
  if (text.startsWith("supernote://") || text.startsWith("http://") || text.startsWith("https://")) {
    try {
      const u = new URL(text.replace(/^supernote:/, "https:"));
      const id = u.searchParams.get("id");
      const s = u.searchParams.get("s") || u.searchParams.get("server");
      if (id && s) {
        return { v: QR_LOGIN_VERSION, t: QR_LOGIN_TYPE, id, s: normalizeServerOrigin(s) };
      }
      // path 里可能是整段 JSON
      if (u.hash?.startsWith("#")) text = decodeURIComponent(u.hash.slice(1));
    } catch {
      /* fallthrough */
    }
  }
  try {
    const obj = JSON.parse(text) as Partial<QrLoginPayload>;
    if (obj.v !== 1 || obj.t !== QR_LOGIN_TYPE) return null;
    if (!obj.id || typeof obj.id !== "string") return null;
    if (!obj.s || typeof obj.s !== "string") return null;
    return {
      v: QR_LOGIN_VERSION,
      t: QR_LOGIN_TYPE,
      id: obj.id.trim(),
      s: normalizeServerOrigin(obj.s),
    };
  } catch {
    return null;
  }
}

/** 当前 App 配置的服务器是否与 QR 一致 */
export function isSameServerAsQr(qrServer: string): boolean {
  const current = normalizeServerOrigin(getServerUrl() || (typeof window !== "undefined" ? window.location.origin : ""));
  const target = normalizeServerOrigin(qrServer);
  if (!current || !target) return false;
  try {
    return new URL(current).origin === new URL(target).origin;
  } catch {
    return current === target;
  }
}

export async function qrCreate(serverOverride?: string): Promise<QrCreateResult> {
  const base = authApiBase(serverOverride);
  const res = await fetch(`${base}/auth/qr/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: "web" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "创建二维码失败");
  return data as QrCreateResult;
}

export async function qrStatus(id: string, serverOverride?: string): Promise<QrStatusResult> {
  const base = authApiBase(serverOverride);
  const res = await fetch(`${base}/auth/qr/status?id=${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return { status: "expired", error: data.error };
  if (!res.ok) throw new Error(data.error || "查询状态失败");
  return data as QrStatusResult;
}

export async function qrCancel(id: string, serverOverride?: string): Promise<void> {
  const base = authApiBase(serverOverride);
  await fetch(`${base}/auth/qr/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

export async function qrScan(id: string, serverOverride?: string): Promise<void> {
  const base = authApiBase(serverOverride);
  const token = getToken();
  if (!token) throw new Error("请先登录 App");
  const res = await fetch(`${base}/auth/qr/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "扫码登记失败");
}

export async function qrConfirm(id: string, serverOverride?: string): Promise<void> {
  const base = authApiBase(serverOverride);
  const token = getToken();
  if (!token) throw new Error("请先登录 App");
  const res = await fetch(`${base}/auth/qr/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "确认登录失败");
}
