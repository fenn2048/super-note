/**
 * Popup IA（C1–C2）
 * 主路径：工作区/笔记本 → 剪藏正文；配置折叠；AI/更多/备注二级
 */

import {
  getConfig,
  setConfig,
  normalizeBaseUrl,
  noteOpenUrl,
  getClipHistory,
  pushClipHistory,
  type SuperClipperConfig,
} from "../lib/storage";
import { ping, getClipWorkspaces, getClipNotebooks } from "../lib/api";
import type {
  AIEnhanceMode,
  AIEnhanceTasks,
  ClipMode,
  ClipProgress,
  ClipRequest,
} from "../lib/protocol";

let checkTimeout: ReturnType<typeof setTimeout> | null = null;
let lastFailedReq: ClipRequest | null = null;

async function init() {
  const cfg = await getConfig();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.title) {
      document.getElementById("page-title")!.textContent = tab.title;
    }
  } catch {
    /* ignore */
  }

  const openOpts = (e: Event) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  };
  document.getElementById("open-options")?.addEventListener("click", openOpts);
  document.getElementById("footer-options")?.addEventListener("click", openOpts);

  document.getElementById("toggle-config")!.addEventListener("click", () => {
    document.getElementById("config-section")!.classList.toggle("hidden");
  });

  const serverInput = document.getElementById("server-url") as HTMLInputElement;
  const tokenInput = document.getElementById("api-token") as HTMLInputElement;
  const imageLocCheckbox = document.getElementById("image-localization") as HTMLInputElement;
  const quickCaptureCheckbox = document.getElementById("quick-capture") as HTMLInputElement;

  serverInput.value = cfg.serverUrl || "";
  tokenInput.value = cfg.token || "";
  imageLocCheckbox.checked = cfg.imageLocalization;
  quickCaptureCheckbox.checked = !!cfg.quickCapture;

  const aiEnhanceCheckbox = document.getElementById("ai-enhance") as HTMLInputElement;
  const aiModeSelect = document.getElementById("ai-mode") as HTMLSelectElement;
  aiEnhanceCheckbox.checked = cfg.aiEnhanceEnabled;
  aiModeSelect.value = cfg.aiEnhanceMode;

  document.querySelectorAll<HTMLInputElement>("#ai-details input[data-task]").forEach((el) => {
    const k = el.dataset.task as keyof AIEnhanceTasks;
    el.checked = !!cfg.aiEnhanceTasks[k];
  });

  const aiDetails = document.getElementById("ai-details")!;
  aiDetails.classList.toggle("hidden", !cfg.aiEnhanceEnabled);

  document.getElementById("ai-toggle-details")!.addEventListener("click", (e) => {
    e.preventDefault();
    aiDetails.classList.toggle("hidden");
  });

  aiEnhanceCheckbox.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    aiDetails.classList.toggle("hidden", !checked);
    void setConfig({ aiEnhanceEnabled: checked, authMethod: "token" });
  });

  document.getElementById("toggle-advanced")!.addEventListener("click", () => {
    document.getElementById("advanced-content")!.classList.toggle("hidden");
    document.getElementById("toggle-advanced")!.classList.toggle("expanded");
  });

  document.getElementById("toggle-more")!.addEventListener("click", () => {
    document.getElementById("more-panel")!.classList.toggle("hidden");
  });

  imageLocCheckbox.addEventListener("change", () => {
    void setConfig({ imageLocalization: imageLocCheckbox.checked });
  });
  quickCaptureCheckbox.addEventListener("change", () => {
    void setConfig({ quickCapture: quickCaptureCheckbox.checked });
  });
  aiModeSelect.addEventListener("change", () => {
    void setConfig({ aiEnhanceMode: aiModeSelect.value as AIEnhanceMode });
  });
  document.querySelectorAll<HTMLInputElement>("#ai-details input[data-task]").forEach((el) => {
    el.addEventListener("change", () => {
      void setConfig({ aiEnhanceTasks: collectAITasks() });
    });
  });

  const triggerConnectionCheck = () => {
    if (checkTimeout) clearTimeout(checkTimeout);
    checkTimeout = setTimeout(() => {
      void checkConnection(serverInput.value.trim(), tokenInput.value.trim());
    }, 400);
  };
  serverInput.addEventListener("input", triggerConnectionCheck);
  tokenInput.addEventListener("input", triggerConnectionCheck);

  document.getElementById("clip-article")!.addEventListener("click", () => void clip("article"));
  document.getElementById("clip-selection")!.addEventListener("click", () => void clip("selection"));
  document.getElementById("clip-more")!.addEventListener("click", () => {
    const mode = (document.getElementById("clip-mode") as HTMLSelectElement).value as ClipMode;
    void clip(mode);
  });

  await renderHistory();
  await refreshQueueStatus();
  document.getElementById("queue-flush")?.addEventListener("click", () => void flushQueue());

  if (cfg.serverUrl && cfg.token) {
    await checkConnection(cfg.serverUrl, cfg.token);
  } else {
    document.getElementById("config-section")!.classList.remove("hidden");
    disableClipUI();
    setBadge("err", "未配置");
  }
}

async function refreshQueueStatus() {
  const section = document.getElementById("queue-section");
  const status = document.getElementById("queue-status");
  if (!section || !status) return;
  try {
    const res = (await chrome.runtime.sendMessage({ type: "QUEUE_STATUS" })) as {
      ok?: boolean;
      count?: number;
    };
    const n = res?.count ?? 0;
    if (n > 0) {
      section.classList.remove("hidden");
      status.textContent = `${n} 条待上传（联网后自动或点同步）`;
    } else {
      section.classList.add("hidden");
      status.textContent = "—";
    }
  } catch {
    section.classList.add("hidden");
  }
}

async function flushQueue() {
  const status = document.getElementById("queue-status");
  if (status) status.textContent = "同步中…";
  try {
    const res = (await chrome.runtime.sendMessage({ type: "QUEUE_FLUSH" })) as {
      uploaded?: number;
      remaining?: number;
      failed?: number;
    };
    const up = res?.uploaded ?? 0;
    const rem = res?.remaining ?? 0;
    if (status) {
      status.textContent =
        up > 0
          ? `已上传 ${up} 条${rem ? `，剩余 ${rem}` : ""}`
          : rem
            ? `仍有 ${rem} 条未成功`
            : "队列已空";
    }
    if (up > 0) {
      showResult(true, `离线队列已同步 ${up} 条`);
    }
  } catch (e: any) {
    if (status) status.textContent = "同步失败";
    showResult(false, String(e?.message || e));
  }
  await refreshQueueStatus();
  await renderHistory();
}

function collectAITasks(): AIEnhanceTasks {
  const tasks: AIEnhanceTasks = {};
  document.querySelectorAll<HTMLInputElement>("#ai-details input[data-task]").forEach((el) => {
    const k = el.dataset.task as keyof AIEnhanceTasks;
    if (el.checked) tasks[k] = true;
  });
  return tasks;
}

function setBadge(kind: "ok" | "err" | "warn", text: string) {
  const badge = document.getElementById("connection-badge")!;
  badge.className = `badge ${kind}`;
  badge.textContent = text;
}

async function checkConnection(serverUrl: string, token: string) {
  if (!serverUrl || !token) {
    setBadge("err", "未连接");
    document.getElementById("config-section")!.classList.remove("hidden");
    disableClipUI();
    return;
  }

  setBadge("warn", "连接中…");
  try {
    const tempCfg = { serverUrl: normalizeBaseUrl(serverUrl), token } as SuperClipperConfig;
    const r = await ping(tempCfg);
    const name = r.username || "已连接";
    setBadge("ok", name);
    document.getElementById("config-section")!.classList.add("hidden");
    const authMethod = token.startsWith("nkn_") ? "token" : "login";
    await setConfig({
      serverUrl: normalizeBaseUrl(serverUrl),
      token,
      authMethod,
      username: r.username || "",
      displayName: r.username || "",
    });
    enableClipUI();
    await loadWorkspacesAndNotebooks();
  } catch (err: any) {
    const msg = String(err?.message || err);
    setBadge("err", "连接失败");
    document.getElementById("config-section")!.classList.remove("hidden");
    disableClipUI();
    showResult(false, classifyConnectError(msg), { retryConnect: true });
  }
}

function classifyConnectError(msg: string): string {
  if (/401|403|Unauthorized|令牌|token/i.test(msg)) {
    return "鉴权失败：请检查访问令牌是否正确、是否已吊销。";
  }
  if (/Failed to fetch|NetworkError|CORS|ECONNREFUSED/i.test(msg)) {
    return "无法连接服务器：检查地址、HTTPS/证书，以及是否允许扩展访问。";
  }
  return `连接失败：${msg.slice(0, 120)}`;
}

function enableClipUI() {
  document.getElementById("clip-settings-panel")!.classList.remove("disabled");
  document.getElementById("advanced-panel")!.classList.remove("disabled");
  document.getElementById("more-panel")!.classList.remove("disabled");
  (document.getElementById("workspace-select") as HTMLSelectElement).disabled = false;
  (document.getElementById("notebook-select") as HTMLSelectElement).disabled = false;
  (document.getElementById("clip-article") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-selection") as HTMLButtonElement).disabled = false;
  (document.getElementById("toggle-more") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-more") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-mode") as HTMLSelectElement).disabled = false;
}

function disableClipUI() {
  document.getElementById("clip-settings-panel")!.classList.add("disabled");
  document.getElementById("advanced-panel")!.classList.add("disabled");
  document.getElementById("more-panel")!.classList.add("disabled");
  (document.getElementById("workspace-select") as HTMLSelectElement).disabled = true;
  (document.getElementById("notebook-select") as HTMLSelectElement).disabled = true;
  (document.getElementById("clip-article") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-selection") as HTMLButtonElement).disabled = true;
  (document.getElementById("toggle-more") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-more") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-mode") as HTMLSelectElement).disabled = true;
}

async function loadWorkspacesAndNotebooks() {
  const cfg = await getConfig();
  const wsSelect = document.getElementById("workspace-select") as HTMLSelectElement;

  try {
    const workspaces = await getClipWorkspaces(cfg);
    wsSelect.innerHTML = "";

    if (!workspaces.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（无工作区，将用默认）";
      wsSelect.appendChild(opt);
    } else {
      for (const ws of workspaces) {
        const opt = document.createElement("option");
        opt.value = ws.id;
        opt.textContent = ws.name;
        wsSelect.appendChild(opt);
      }
    }

    let defaultWsId = "";
    if (cfg.lastWorkspaceId && workspaces.some((w) => w.id === cfg.lastWorkspaceId)) {
      defaultWsId = cfg.lastWorkspaceId;
    } else {
      const family = workspaces.find(
        (w) => w.name?.includes("家庭") || w.name?.includes("Family"),
      );
      defaultWsId = family?.id || workspaces[0]?.id || "";
    }
    if (defaultWsId) wsSelect.value = defaultWsId;

    wsSelect.onchange = async () => {
      await setConfig({ lastWorkspaceId: wsSelect.value });
      await loadNotebooksForWorkspace(wsSelect.value);
    };

    await loadNotebooksForWorkspace(wsSelect.value);
  } catch (err) {
    console.error("加载工作区失败:", err);
    wsSelect.innerHTML = `<option value="">加载失败</option>`;
  }
}

async function loadNotebooksForWorkspace(workspaceId: string) {
  const cfg = await getConfig();
  const nbSelect = document.getElementById("notebook-select") as HTMLSelectElement;
  const savedNbId = cfg.lastNotebookId || "__default__";

  try {
    const notebooks = await getClipNotebooks(cfg, workspaceId || undefined);
    nbSelect.innerHTML = `
      <option value="__default__">📓 剪藏笔记</option>
      <option value="__diary__">💬 说说</option>
    `;
    for (const nb of notebooks) {
      const opt = document.createElement("option");
      opt.value = nb.id;
      opt.textContent = nb.name;
      nbSelect.appendChild(opt);
    }
    nbSelect.value = savedNbId;
    if (nbSelect.value !== savedNbId) nbSelect.value = "__default__";

    nbSelect.onchange = async () => {
      await setConfig({ lastNotebookId: nbSelect.value });
    };
  } catch (err) {
    console.error("加载笔记本失败:", err);
  }
}

async function clip(mode: ClipMode) {
  const progress = document.getElementById("progress")!;
  const progressText = document.getElementById("progress-text")!;
  const resultEl = document.getElementById("result")!;

  resultEl.classList.add("hidden");
  progress.classList.remove("hidden");
  progressText.textContent = "准备中…";
  disableClipUI();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showResult(false, "未找到当前标签页");
    enableClipUI();
    progress.classList.add("hidden");
    return;
  }

  // 特权页
  if (tab.url && /^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url)) {
    progress.classList.add("hidden");
    showResult(false, "无法在浏览器内部页剪藏，请打开普通网页后再试。");
    enableClipUI();
    return;
  }

  const comment = (document.getElementById("comment") as HTMLTextAreaElement).value.trim();
  const aiEnhance = (document.getElementById("ai-enhance") as HTMLInputElement).checked;
  const aiMode = (document.getElementById("ai-mode") as HTMLSelectElement).value as AIEnhanceMode;
  const aiTasks = collectAITasks();

  try {
    await setConfig({
      aiEnhanceEnabled: aiEnhance,
      aiEnhanceMode: aiMode,
      aiEnhanceTasks: aiTasks,
    });
  } catch {
    /* ignore */
  }

  const workspaceId = (document.getElementById("workspace-select") as HTMLSelectElement).value;
  const notebookId = (document.getElementById("notebook-select") as HTMLSelectElement).value;

  const req: ClipRequest = {
    type: "CLIP_REQUEST",
    mode,
    tabId: tab.id,
    overrideTags: (document.getElementById("tags") as HTMLInputElement).value.trim(),
    workspaceId: workspaceId || undefined,
    notebookId: notebookId || undefined,
    comment: comment || undefined,
    aiEnhance,
    aiTasks,
    aiMode,
  };
  lastFailedReq = null;

  if (mode === "screenshot" || mode === "fullScreenshot") {
    progressText.textContent = "正在截图…";
    chrome.runtime.sendMessage(req).catch(() => {});
    setTimeout(() => window.close(), 120);
    return;
  }

  const handler = (msg: ClipProgress) => {
    if (msg?.type !== "CLIP_PROGRESS") return;
    progressText.textContent = msg.message;
  };
  chrome.runtime.onMessage.addListener(handler);

  try {
    const res = (await chrome.runtime.sendMessage(req)) as {
      ok: boolean;
      error?: string;
      noteId?: string;
      noteTitle?: string;
      images?: { ok: number; failed: number; skipped: number };
      aiInfo?: { ok: boolean; error?: string };
      queued?: boolean;
    };
    progress.classList.add("hidden");
    if (res?.ok) {
      const imgInfo = res.images
        ? ` · 图 ${res.images.ok}${res.images.failed ? `（${res.images.failed} 失败）` : ""}`
        : "";
      const aiInfo =
        res.aiInfo && !res.aiInfo.ok
          ? ` · AI 未生效（${(res.aiInfo.error || "").slice(0, 32)}）`
          : res.aiInfo?.ok
            ? " · 已 AI 整理"
            : "";
      const title = res.noteTitle || "无标题";
      await pushClipHistory({ title, noteId: res.noteId, ok: true });
      await renderHistory();
      const cfg = await getConfig();
      showResult(true, `已保存「${title}」${imgInfo}${aiInfo}`, {
        noteId: res.noteId,
        serverUrl: cfg.serverUrl,
      });
    } else if (res?.queued) {
      await pushClipHistory({
        title: tab.title || "已入队",
        ok: false,
        error: "已加入离线队列",
      });
      await renderHistory();
      await refreshQueueStatus();
      showResult(false, res.error || "网络失败，已加入离线队列", {
        flushQueue: true,
      });
    } else {
      lastFailedReq = req;
      const err = classifyClipError(res?.error || "未知错误");
      await pushClipHistory({ title: tab.title || "失败", ok: false, error: err });
      await renderHistory();
      showResult(false, err, { retry: true, simplify: mode !== "simplified" });
    }
  } catch (e: any) {
    progress.classList.add("hidden");
    lastFailedReq = req;
    const err = classifyClipError(String(e?.message || e));
    showResult(false, err, { retry: true });
  } finally {
    chrome.runtime.onMessage.removeListener(handler);
    enableClipUI();
  }
}

function classifyClipError(raw: string): string {
  if (/401|403|Unauthorized|令牌|token|JWT/i.test(raw)) {
    return "鉴权失败：Token 可能过期。请改用访问令牌（nkn_）或重新登录。";
  }
  if (/抽取|extract|无法运行|Cannot access/i.test(raw)) {
    return "无法读取页面内容：请刷新网页后重试，或换「简化」模式。";
  }
  if (/Failed to fetch|Network|ECONNREFUSED|timeout/i.test(raw)) {
    return "上传失败：网络或服务器不可达，请检查地址后重试。";
  }
  return raw.slice(0, 200);
}

function showResult(
  ok: boolean,
  text: string,
  opts?: {
    noteId?: string;
    serverUrl?: string;
    retry?: boolean;
    simplify?: boolean;
    retryConnect?: boolean;
    flushQueue?: boolean;
  },
) {
  const el = document.getElementById("result")!;
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(ok ? "ok" : "err");
  el.innerHTML = "";

  const p = document.createElement("div");
  p.className = "result-msg";
  p.textContent = text;
  el.appendChild(p);

  const actions = document.createElement("div");
  actions.className = "result-actions";

  if (ok && opts?.serverUrl) {
    const a = document.createElement("a");
    a.className = "btn-link";
    a.href = noteOpenUrl(opts.serverUrl, opts.noteId);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "在蜉蝣中打开";
    actions.appendChild(a);
  }
  if (opts?.retry && lastFailedReq) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-link";
    b.textContent = "重试";
    b.onclick = () => void clip(lastFailedReq!.mode);
    actions.appendChild(b);
  }
  if (opts?.simplify) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-link";
    b.textContent = "用简化模式";
    b.onclick = () => void clip("simplified");
    actions.appendChild(b);
  }
  if (opts?.flushQueue) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-link";
    b.textContent = "同步队列";
    b.onclick = () => void flushQueue();
    actions.appendChild(b);
  }
  if (opts?.retryConnect) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-link";
    b.textContent = "重新连接";
    b.onclick = () => {
      const s = (document.getElementById("server-url") as HTMLInputElement).value.trim();
      const t = (document.getElementById("api-token") as HTMLInputElement).value.trim();
      void checkConnection(s, t);
    };
    actions.appendChild(b);
  }

  if (actions.childNodes.length) el.appendChild(actions);
}

async function renderHistory() {
  const list = document.getElementById("history-list")!;
  const items = await getClipHistory();
  list.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "暂无记录";
    list.appendChild(li);
    return;
  }
  const cfg = await getConfig();
  for (const it of items.slice(0, 5)) {
    const li = document.createElement("li");
    li.className = it.ok ? "hist-ok" : "hist-err";
    const title = document.createElement("span");
    title.className = "hist-title";
    title.textContent = it.title;
    li.appendChild(title);
    if (it.ok && it.noteId && cfg.serverUrl) {
      const a = document.createElement("a");
      a.href = noteOpenUrl(cfg.serverUrl, it.noteId);
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "hist-link";
      a.textContent = "打开";
      li.appendChild(a);
    } else if (!it.ok && it.error) {
      const e = document.createElement("span");
      e.className = "hist-err-msg";
      e.title = it.error;
      e.textContent = "失败";
      li.appendChild(e);
    }
    list.appendChild(li);
  }
}

void init();
