/**
 * GET /api/releases/latest —— 代理 GitHub Releases 最新发布
 * ---------------------------------------------------------------------------
 *
 * 为什么由后端代理而不是前端直连 GitHub：
 *   1. **CORS 与配额**：GitHub API 对未认证请求有 60 次/小时/IP 的上限；
 *      让所有前端共享一个后端缓存，整个实例每 N 分钟最多 1 次外呼，
 *      天然避免用户打开多个 tab、或国内多用户共享出口 IP 时把额度打光。
 *   2. **私网可用**：一些企业内网部署能访问本实例的 80/443，但出站到
 *      github.com 要走代理；通过后端代理能让"是否启用更新检查"成为
 *      运维配置，而不是前端硬编码。
 *   3. **故障降级**：外呼失败时返回 `{ available: false, reason }` 而非
 *      5xx，让前端关于页平稳显示"无法检查更新"，不影响核心功能。
 *
 * 缓存策略（针对国内大并发 + IP 共享 quota 场景重新设计）：
 *   - 成功结果缓存 15 分钟（CACHE_TTL_MS，可经环境变量覆盖）：
 *     一个实例每小时最多外呼 4 次，远低于 60/h 的未认证额度。
 *   - 失败结果缓存 5 分钟（FAIL_CACHE_TTL_MS）：避免 GitHub 403 时
 *     每个请求都触发外呼形成"403 风暴 → IP 永远恢复不了"的死循环。
 *   - ETag 条件请求：保存上次成功响应的 ETag，下次外呼带 If-None-Match；
 *     GitHub 返回 304 时不计入 rate limit（官方文档保证），等于免费续期。
 *   - stale-while-error：缓存过期后 GitHub 又失败时，**优先继续返回上次
 *     成功数据**而不是错误——对用户体验上"版本号偶尔停止更新" >> "面板
 *     直接挂掉"。
 *
 * 鉴权扩展：
 *   - 可选环境变量 GITHUB_TOKEN（也兼容 SUPER_GITHUB_TOKEN）：填了后
 *     authenticated quota 升到 5000/h，并支持私有仓库（虽然本项目是公开的）。
 *
 * 无需鉴权：与 /api/version 同级，贴着 health 挂在 JWT 之前。
 */

import { Hono } from "hono";
import fs from "fs";
import path from "path";

const router = new Hono();

// 仓库地址硬编码；如果未来仓库重命名，这里改一次即可。
const GITHUB_OWNER = process.env.SUPER_RELEASE_OWNER || "cropflre";
const GITHUB_REPO = process.env.SUPER_RELEASE_REPO || "super-note";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// 可选 token：优先 GITHUB_TOKEN（与生态一致），其次 SUPER_GITHUB_TOKEN
// （避免与同主机其他服务的 GITHUB_TOKEN 冲突时，运维有显式覆盖入口）。
const GITHUB_TOKEN = (process.env.SUPER_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();

// 缓存 TTL：成功 15min，失败 5min。允许通过环境变量按部署调优。
// 选 15min 的依据：1h / 15min = 4 次/小时外呼，留 56 次余量给"用户手动刷新"。
const CACHE_TTL_MS = parseTtl(process.env.SUPER_RELEASE_CACHE_MS, 15 * 60_000);
const FAIL_CACHE_TTL_MS = parseTtl(process.env.SUPER_RELEASE_FAIL_CACHE_MS, 5 * 60_000);
const FETCH_TIMEOUT_MS = 5_000;
const APK_FETCH_TIMEOUT_MS = 180_000;

const GITEE_OWNER = process.env.SUPER_GITEE_OWNER || GITHUB_OWNER;
const GITEE_REPO = process.env.SUPER_GITEE_REPO || GITHUB_REPO;

function parseTtl(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return fallback; // 不允许 < 1s，避免误配
  return n;
}

interface ReleaseAsset {
  name: string;            // 文件名，如 "Super Note Setup 1.1.7.exe"
  size: number;            // 字节
  contentType: string;     // application/octet-stream 等
  browserDownloadUrl: string; // GitHub 直链
}

interface LatestRelease {
  available: true;
  tag: string;           // e.g. "v1.0.31"
  version: string;       // 去掉前导 v："1.0.31"
  name: string;          // release 标题（可能为空）
  htmlUrl: string;       // release 页面 URL
  publishedAt: string;   // ISO
  prerelease: boolean;
  draft: boolean;
  body?: string;         // release notes（markdown）
  assets: ReleaseAsset[];
}

interface Unavailable {
  available: false;
  reason: string;
}

type Payload = LatestRelease | Unavailable;

/** 从 release 资产里挑正式 APK（优先 Super-Note-x.y.z.apk，排除 debug）。 */
export function pickAndroidApkAsset<T extends { name: string }>(assets: T[]): T | undefined {
  const apks = assets.filter((a) => /\.apk$/i.test(a.name || ""));
  if (apks.length === 0) return undefined;
  const releaseNamed = apks.find((a) => /super-note-\d/i.test(a.name) && !/debug/i.test(a.name));
  if (releaseNamed) return releaseNamed;
  const nonDebug = apks.find((a) => !/debug/i.test(a.name));
  return nonDebug || apks[0];
}

export function giteeDownloadUrl(owner: string, repo: string, tag: string, filename: string): string {
  const t = tag.startsWith("v") ? tag : `v${tag}`;
  return `https://gitee.com/${owner}/${repo}/releases/download/${t}/${encodeURIComponent(filename)}`;
}

export function githubProxyDownloadUrl(githubUrl: string): string {
  if (!githubUrl) return githubUrl;
  if (/^https?:\/\/ghproxy\.net\//i.test(githubUrl)) return githubUrl;
  return `https://ghproxy.net/${githubUrl}`;
}

function uniqueUrls(urls: string[]): string[] {
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

function isDirectApkUrl(url: string): boolean {
  if (!url) return false;
  if (/\/releases\/latest\/?$/i.test(url)) return false;
  return /\.apk(\?|$)/i.test(url) || /android-apk\/file/i.test(url);
}

function resolveLocalApkFile(): { path: string; filename: string } | null {
  const apkCandidates = [
    path.resolve(process.cwd(), "frontend/dist/downloads/super-note-debug.apk"),
    path.resolve(process.cwd(), "frontend/dist/downloads/super-note.apk"),
    path.resolve(process.cwd(), "../frontend/dist/downloads/super-note-debug.apk"),
    path.resolve(__dirname, "../../../frontend/dist/downloads/super-note-debug.apk"),
  ];
  for (const p of apkCandidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return { path: p, filename: path.basename(p) };
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/**
 * 缓存槽：
 *   - lastSuccess：最近一次成功的数据 + ETag。即使过期了，外呼又失败时
 *     还会作为 stale 兜底返回。永不主动清除（除非进程重启）。
 *   - current：当前 TTL 内有效的 payload（成功或失败）；过期则触发外呼。
 */
let lastSuccess: { payload: LatestRelease; etag: string | null } | null = null;
let current: { at: number; ttl: number; payload: Payload } | null = null;

/** 拉取并规范化 GitHub release。
 *  返回 'not-modified' 表示 ETag 命中（沿用 lastSuccess.payload）。
 *  其他失败抛错。
 */
async function fetchLatestFromGitHub(): Promise<LatestRelease | "not-modified"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // GitHub 建议带 User-Agent；用仓库名避免被 rate-limit 误杀
      "User-Agent": `${GITHUB_OWNER}-${GITHUB_REPO}-server`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    if (lastSuccess?.etag) {
      // 关键：带 If-None-Match 让 GitHub 返回 304；304 不计 rate limit。
      headers["If-None-Match"] = lastSuccess.etag;
    }
    const resp = await fetch(GITHUB_API, { signal: ctrl.signal, headers });
    if (resp.status === 304) {
      return "not-modified";
    }
    if (!resp.ok) {
      // 把 rate-limit 信息塞进错误，方便日志排查
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const reset = resp.headers.get("x-ratelimit-reset");
      const extra = remaining !== null ? ` (rate-limit remaining=${remaining} reset=${reset})` : "";
      throw new Error(`GitHub API ${resp.status} ${resp.statusText}${extra}`);
    }
    const etag = resp.headers.get("etag");
    const data = (await resp.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      prerelease?: boolean;
      draft?: boolean;
      body?: string;
      assets?: Array<{
        name?: string;
        size?: number;
        content_type?: string;
        browser_download_url?: string;
      }>;
    };
    const tag = data.tag_name || "";
    const version = tag.replace(/^v/, "");
    const assets: ReleaseAsset[] = (data.assets || [])
      .filter((a) => !!a.browser_download_url && !!a.name)
      .map((a) => ({
        name: a.name || "",
        size: typeof a.size === "number" ? a.size : 0,
        contentType: a.content_type || "application/octet-stream",
        browserDownloadUrl: a.browser_download_url || "",
      }));
    const payload: LatestRelease = {
      available: true,
      tag,
      version,
      name: data.name || tag,
      htmlUrl: data.html_url || "",
      publishedAt: data.published_at || "",
      prerelease: Boolean(data.prerelease),
      draft: Boolean(data.draft),
      body: data.body || "",
      assets,
    };
    lastSuccess = { payload, etag };
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getLatestReleasePayload(): Promise<Payload> {
  const now = Date.now();

  if (current && now - current.at < current.ttl) {
    return current.payload;
  }

  try {
    const result = await fetchLatestFromGitHub();
    const payload: LatestRelease = result === "not-modified" ? lastSuccess!.payload : result;
    current = { at: now, ttl: CACHE_TTL_MS, payload };
    return payload;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);

    if (lastSuccess) {
      current = { at: now, ttl: FAIL_CACHE_TTL_MS, payload: lastSuccess.payload };
      return lastSuccess.payload;
    }

    const payload: Unavailable = { available: false, reason };
    current = { at: now, ttl: FAIL_CACHE_TTL_MS, payload };
    return payload;
  }
}

router.get("/latest", async (c) => {
  return c.json(await getLatestReleasePayload());
});

/**
 * GET /api/releases/android-apk —— 最新 Android 安装包的候选直链。
 * GET /api/releases/android-apk/file —— 由本机代理拉取并流式返回 APK
 *   （手机只连用户自己的服务器，避开 GitHub 在国内不稳定）。
 */
async function resolveLatestAndroidApk(): Promise<{
  available: boolean;
  version: string;
  tag: string;
  filename: string;
  urls: string[];
  fileUrl: string;
  localPath: string | null;
  remoteUrls: string[];
  reason?: string;
}> {
  const fileUrl = "/api/releases/android-apk/latest.apk";
  const local = resolveLocalApkFile();
  const envUrl = (process.env.SUPER_ANDROID_APK_URL || process.env.ANDROID_APK_URL || "").trim();
  const remoteUrls: string[] = [];
  const publicUrls: string[] = [];

  if (envUrl && isDirectApkUrl(envUrl)) {
    remoteUrls.push(envUrl);
    publicUrls.push(envUrl);
  }

  const rel = await getLatestReleasePayload();
  let version = "";
  let tag = "";
  let filename = local?.filename || "super-note.apk";

  if (rel.available) {
    version = rel.version;
    tag = rel.tag;
    const apk = pickAndroidApkAsset(rel.assets);
    if (apk) {
      filename = apk.name;
      const gitee = giteeDownloadUrl(GITEE_OWNER, GITEE_REPO, tag, apk.name);
      remoteUrls.push(gitee);
      publicUrls.push(gitee);
      if (apk.browserDownloadUrl) {
        remoteUrls.push(apk.browserDownloadUrl);
        publicUrls.push(apk.browserDownloadUrl);
        remoteUrls.push(githubProxyDownloadUrl(apk.browserDownloadUrl));
        publicUrls.push(githubProxyDownloadUrl(apk.browserDownloadUrl));
      }
    }
  }

  publicUrls.unshift(fileUrl);
  if (local) {
    publicUrls.push(`/downloads/${local.filename}`);
  }

  const available = remoteUrls.length > 0 || !!local;
  return {
    available,
    version,
    tag,
    filename,
    urls: uniqueUrls(publicUrls),
    fileUrl,
    localPath: local?.path ?? null,
    remoteUrls: uniqueUrls(remoteUrls),
    ...(available ? {} : { reason: !rel.available ? rel.reason : "no apk asset" }),
  };
}

async function fetchRemoteApk(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), APK_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "User-Agent": `${GITHUB_OWNER}-${GITHUB_REPO}-server`,
      Accept: "application/vnd.android.package-archive, application/octet-stream, */*",
    };
    if (GITHUB_TOKEN && /github\.com|githubusercontent\.com/i.test(url)) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers });
    if (!resp.ok || !resp.body) return null;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) return null;
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/android-apk", async (c) => {
  const resolved = await resolveLatestAndroidApk();
  return c.json({
    available: resolved.available,
    version: resolved.version,
    tag: resolved.tag,
    filename: resolved.filename,
    urls: resolved.urls,
    fileUrl: resolved.fileUrl,
    ...(resolved.reason ? { reason: resolved.reason } : {}),
  });
});

async function serveLatestAndroidApkFile(c: import("hono").Context) {
  const resolved = await resolveLatestAndroidApk();
  const filename = resolved.filename || "super-note.apk";
  const headers: Record<string, string> = {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "Cache-Control": "no-store",
  };

  for (const url of resolved.remoteUrls) {
    const resp = await fetchRemoteApk(url);
    if (!resp?.body) continue;
    // 不转发 Content-Length：上游可能 gzip，Node fetch 解压后长度对不上
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
    return c.body(resp.body, 200);
  }

  if (resolved.localPath && fs.existsSync(resolved.localPath)) {
    const stat = fs.statSync(resolved.localPath);
    headers["Content-Length"] = String(stat.size);
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
    return c.body(fs.readFileSync(resolved.localPath), 200);
  }

  return c.json({ error: "无法获取最新 Android 安装包", reason: resolved.reason || "no apk" }, 404);
}

router.get("/android-apk/file", (c) => serveLatestAndroidApkFile(c));
// 带 .apk 后缀：旧客户端用 /\.apk$/ 判断直链，系统下载器也更好识别
router.get("/android-apk/latest.apk", (c) => serveLatestAndroidApkFile(c));

export default router;
