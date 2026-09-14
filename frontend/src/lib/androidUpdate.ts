/**
 * Android 应用内更新：解析最新 APK 直链，交给原生下载并调起安装器。
 */

import { api, getServerUrl } from "@/lib/api";
import { downloadAndInstallApkFromUrls } from "@/lib/downloadFile";
import { toast } from "@/lib/toast";

const GITEE_OWNER = "cropflre";
const GITEE_REPO = "super-note";

export function buildAndroidApkCandidateUrls(input: {
  serverBase: string;
  fileUrl?: string;
  release?: {
    tag?: string;
    version?: string;
    assets: Array<{ name: string; browserDownloadUrl: string }>;
  };
  androidApkUrl?: string;
  giteeOwner?: string;
  giteeRepo?: string;
}): string[] {
  const urls: string[] = [];
  const base = (input.serverBase || "").replace(/\/+$/, "");
  const abs = (u: string): string => {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/") && base) return `${base}${u}`;
    return u;
  };

  const fileUrl = input.fileUrl || "/api/releases/android-apk/latest.apk";
  urls.push(abs(fileUrl) || fileUrl);

  const rel = input.release;
  if (rel?.assets?.length) {
    const apk =
      rel.assets.find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name)) ||
      rel.assets.find((a) => /\.apk$/i.test(a.name));
    if (apk) {
      const rawTag = (rel.tag || (rel.version ? `v${rel.version}` : "")).trim();
      const t = rawTag ? (rawTag.startsWith("v") ? rawTag : `v${rawTag}`) : "";
      const owner = input.giteeOwner || GITEE_OWNER;
      const repo = input.giteeRepo || GITEE_REPO;
      if (t) {
        urls.push(
          `https://gitee.com/${owner}/${repo}/releases/download/${t}/${encodeURIComponent(apk.name)}`,
        );
      }
      if (apk.browserDownloadUrl) {
        urls.push(apk.browserDownloadUrl);
        urls.push(`https://ghproxy.net/${apk.browserDownloadUrl}`);
      }
    }
  }

  if (input.androidApkUrl) {
    const u = abs(input.androidApkUrl);
    if (u && (/\.apk(\?|$)/i.test(u) || /android-apk\/file/i.test(u))) urls.push(u);
  }

  if (base) urls.push(`${base}/downloads/super-note-debug.apk`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = (u || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 点击「下载更新 / 关于-Android」后：解析最新包 → 原生下载 → 系统安装界面 */
export async function installLatestAndroidApk(): Promise<void> {
  const server = (getServerUrl() || (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/+$/,
    "",
  );

  toast.info("正在准备最新安装包…", 2500);

  let fileUrl = "/api/releases/android-apk/latest.apk";
  let filename = "super-note.apk";
  let urls: string[] = [];

  try {
    const meta = await api.getAndroidApk();
    if (meta.available && Array.isArray(meta.urls) && meta.urls.length > 0) {
      urls = meta.urls.map((u) => (u.startsWith("/") && server ? `${server}${u}` : u));
      if (meta.fileUrl) fileUrl = meta.fileUrl;
      if (meta.filename) filename = meta.filename;
    }
  } catch {
    /* 旧后端没有该接口 */
  }

  if (urls.length === 0) {
    let release:
      | {
          tag?: string;
          version?: string;
          assets: Array<{ name: string; browserDownloadUrl: string }>;
        }
      | undefined;
    let androidApkUrl: string | undefined;
    try {
      const rel = await api.getLatestRelease();
      if (rel.available) {
        release = {
          tag: rel.tag,
          version: rel.version,
          assets: rel.assets.map((a) => ({
            name: a.name,
            browserDownloadUrl: a.browserDownloadUrl,
          })),
        };
        const apk = rel.assets.find((a) => /\.apk$/i.test(a.name));
        if (apk?.name) filename = apk.name;
      }
    } catch {
      /* ignore */
    }
    try {
      const ver = await api.getVersion();
      androidApkUrl = ver.androidApkUrl;
    } catch {
      /* ignore */
    }
    urls = buildAndroidApkCandidateUrls({
      serverBase: server,
      fileUrl,
      release,
      androidApkUrl,
    });
  }

  if (urls.length === 0) {
    toast.error("没有可用的 Android 安装包地址");
    return;
  }

  downloadAndInstallApkFromUrls(urls, filename);
}
