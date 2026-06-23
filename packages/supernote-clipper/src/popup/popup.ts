/**
 * Popup 页交互：
 *
 * - 读取配置，展示直接配置区（服务器地址、令牌、状态、图片本地化）
 * - 实时输入防抖检测连接并更新连接状态 badge
 * - 连接正常时，加载工作区并动态拉取笔记本选项（追加 默认剪藏 和 保存为说说 选项）
 * - 选择笔记本，支持添加标签、备注，并且可配置 AI 优化细节
 * - 点击按钮向 background 发送 CLIP_REQUEST 并监听进度
 */

import { getConfig, setConfig } from "../lib/storage";
import { ping, getClipWorkspaces, getClipNotebooks } from "../lib/api";
import type { AIEnhanceMode, AIEnhanceTasks, ClipMode, ClipProgress, ClipRequest } from "../lib/protocol";

let checkTimeout: any = null;

async function init() {
  const cfg = await getConfig();

  // 获取当前标签页标题，提供更友好的界面预览
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.title) {
      document.getElementById("page-title")!.textContent = tab.title;
    }
  } catch (e) {
    /* ignore */
  }

  // 绑定服务器配置显示/隐藏开关
  document.getElementById("toggle-config")!.addEventListener("click", () => {
    document.getElementById("config-section")!.classList.toggle("hidden");
  });

  // 1. 初始化基础配置字段
  const serverInput = document.getElementById("server-url") as HTMLInputElement;
  const tokenInput = document.getElementById("api-token") as HTMLInputElement;
  const imageLocCheckbox = document.getElementById("image-localization") as HTMLInputElement;
  const quickCaptureCheckbox = document.getElementById("quick-capture") as HTMLInputElement;

  serverInput.value = cfg.serverUrl || "";
  tokenInput.value = cfg.token || "";
  imageLocCheckbox.checked = cfg.imageLocalization;
  quickCaptureCheckbox.checked = cfg.quickCapture || false;

  // AI 优化区初始化
  const aiEnhanceCheckbox = document.getElementById("ai-enhance") as HTMLInputElement;
  const aiModeSelect = document.getElementById("ai-mode") as HTMLSelectElement;

  aiEnhanceCheckbox.checked = cfg.aiEnhanceEnabled;
  aiModeSelect.value = cfg.aiEnhanceMode;

  document.querySelectorAll<HTMLInputElement>("#ai-details input[data-task]").forEach((el) => {
    const k = el.dataset.task as keyof AIEnhanceTasks;
    el.checked = !!cfg.aiEnhanceTasks[k];
  });

  // 展开/收起 AI 详情
  const aiDetails = document.getElementById("ai-details")!;
  if (cfg.aiEnhanceEnabled) {
    aiDetails.classList.remove("hidden");
  } else {
    aiDetails.classList.add("hidden");
  }

  document.getElementById("ai-toggle-details")!.addEventListener("click", (e) => {
    e.preventDefault();
    aiDetails.classList.toggle("hidden");
  });

  aiEnhanceCheckbox.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      aiDetails.classList.remove("hidden");
    } else {
      aiDetails.classList.add("hidden");
    }
    void setConfig({ aiEnhanceEnabled: checked });
  });

  // 2. 绑定事件：展开/收起高级设置
  const toggleAdvanced = document.getElementById("toggle-advanced")!;
  const advancedContent = document.getElementById("advanced-content")!;
  toggleAdvanced.addEventListener("click", () => {
    advancedContent.classList.toggle("hidden");
    toggleAdvanced.classList.toggle("expanded");
  });

  // 3. 绑定配置改动即时保存
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
      const tasks = collectAITasks();
      void setConfig({ aiEnhanceTasks: tasks });
    });
  });

  // 4. 输入变更进行防抖检测
  const triggerConnectionCheck = () => {
    if (checkTimeout) clearTimeout(checkTimeout);
    checkTimeout = setTimeout(() => {
      const serverUrl = serverInput.value.trim();
      const token = tokenInput.value.trim();
      void checkConnection(serverUrl, token);
    }, 500);
  };

  serverInput.addEventListener("input", triggerConnectionCheck);
  tokenInput.addEventListener("input", triggerConnectionCheck);

  // 5. 绑定剪藏事件
  document.getElementById("clip-article")!.addEventListener("click", () => clip("article"));
  document.getElementById("clip-selection")!.addEventListener("click", () => clip("selection"));
  document.getElementById("clip-more")!.addEventListener("click", () => {
    const mode = (document.getElementById("clip-mode") as HTMLSelectElement).value as ClipMode;
    void clip(mode);
  });

  // 6. 执行初始连接检查
  if (cfg.serverUrl && cfg.token) {
    await checkConnection(cfg.serverUrl, cfg.token);
  } else {
    disableClipUI();
  }
}

/** 收集 AI 任务勾选 */
function collectAITasks(): AIEnhanceTasks {
  const tasks: AIEnhanceTasks = {};
  document.querySelectorAll<HTMLInputElement>("#ai-details input[data-task]").forEach((el) => {
    const k = el.dataset.task as keyof AIEnhanceTasks;
    if (el.checked) tasks[k] = true;
  });
  return tasks;
}

/** 校验连接及鉴权 */
async function checkConnection(serverUrl: string, token: string) {
  const badge = document.getElementById("connection-badge")!;
  if (!serverUrl || !token) {
    badge.className = "badge err";
    badge.textContent = "❌ 未连接";
    document.getElementById("config-section")!.classList.remove("hidden");
    disableClipUI();
    return;
  }

  badge.className = "badge warn";
  badge.textContent = "⏳ 连接中...";

  try {
    const tempCfg = { serverUrl, token } as any;
    const r = await ping(tempCfg);
    
    badge.className = "badge ok";
    badge.textContent = `✅ 连接正常 (${r.username})`;
    
    // 连接成功后，自动折叠/隐藏配置区域，使用户界面极其清爽
    document.getElementById("config-section")!.classList.add("hidden");
    
    // 如果与原存储不同，进行保存
    await setConfig({ serverUrl, token });
    
    enableClipUI();
    await loadWorkspacesAndNotebooks();
  } catch (err: any) {
    badge.className = "badge err";
    badge.textContent = "❌ 连接失败";
    document.getElementById("config-section")!.classList.remove("hidden");
    disableClipUI();
  }
}

function enableClipUI() {
  document.getElementById("clip-settings-panel")!.classList.remove("disabled");
  document.getElementById("advanced-panel")!.classList.remove("disabled");
  document.getElementById("more-actions-row")!.classList.remove("disabled");

  (document.getElementById("workspace-select") as HTMLSelectElement).disabled = false;
  (document.getElementById("notebook-select") as HTMLSelectElement).disabled = false;
  (document.getElementById("clip-article") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-selection") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-more") as HTMLButtonElement).disabled = false;
  (document.getElementById("clip-mode") as HTMLSelectElement).disabled = false;
}

function disableClipUI() {
  document.getElementById("clip-settings-panel")!.classList.add("disabled");
  document.getElementById("advanced-panel")!.classList.add("disabled");
  document.getElementById("more-actions-row")!.classList.add("disabled");

  (document.getElementById("workspace-select") as HTMLSelectElement).disabled = true;
  (document.getElementById("notebook-select") as HTMLSelectElement).disabled = true;
  (document.getElementById("clip-article") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-selection") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-more") as HTMLButtonElement).disabled = true;
  (document.getElementById("clip-mode") as HTMLSelectElement).disabled = true;
}

async function loadWorkspacesAndNotebooks() {
  const cfg = await getConfig();
  const wsSelect = document.getElementById("workspace-select") as HTMLSelectElement;
  
  const savedWsId = cfg.lastWorkspaceId || "personal";
  
  try {
    const workspaces = await getClipWorkspaces(cfg);
    
    wsSelect.innerHTML = `<option value="personal">个人空间</option>`;
    for (const ws of workspaces) {
      const opt = document.createElement("option");
      opt.value = ws.id;
      opt.textContent = ws.name;
      wsSelect.appendChild(opt);
    }
    
    wsSelect.value = savedWsId;
    if (wsSelect.value !== savedWsId) {
      wsSelect.value = "personal";
    }
    
    // 监听工作区切换事件
    wsSelect.onchange = async () => {
      const val = wsSelect.value;
      await setConfig({ lastWorkspaceId: val });
      await loadNotebooksForWorkspace(val);
    };
    
    await loadNotebooksForWorkspace(wsSelect.value);
  } catch (err) {
    console.error("加载工作区失败:", err);
  }
}

async function loadNotebooksForWorkspace(workspaceId: string) {
  const cfg = await getConfig();
  const nbSelect = document.getElementById("notebook-select") as HTMLSelectElement;
  
  const savedNbId = cfg.lastNotebookId || "__default__";
  
  try {
    const wsVal = workspaceId === "personal" ? undefined : workspaceId;
    const notebooks = await getClipNotebooks(cfg, wsVal);
    
    nbSelect.innerHTML = `
      <option value="__default__">📓 默认：剪藏笔记本</option>
      <option value="__diary__">💬 保存为说说</option>
    `;
    
    for (const nb of notebooks) {
      const opt = document.createElement("option");
      opt.value = nb.id;
      opt.textContent = nb.name;
      nbSelect.appendChild(opt);
    }
    
    nbSelect.value = savedNbId;
    if (nbSelect.value !== savedNbId) {
      nbSelect.value = "__default__";
    }

    nbSelect.onchange = async () => {
      await setConfig({ lastNotebookId: nbSelect.value });
    };
  } catch (err) {
    console.error("加载笔记本失败:", err);
  }
}

/** 执行剪藏逻辑 */
async function clip(mode: ClipMode) {
  const progress = document.getElementById("progress")!;
  const progressText = document.getElementById("progress-text")!;
  const resultEl = document.getElementById("result")!;

  resultEl.classList.add("hidden");
  progress.classList.remove("hidden");
  progressText.textContent = "准备中...";
  
  disableClipUI();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showResult(false, "未找到当前标签页");
    enableClipUI();
    progress.classList.add("hidden");
    return;
  }

  const comment = (document.getElementById("comment") as HTMLTextAreaElement).value.trim();
  const aiEnhance = (document.getElementById("ai-enhance") as HTMLInputElement).checked;
  const aiMode = (document.getElementById("ai-mode") as HTMLSelectElement).value as AIEnhanceMode;
  const aiTasks = collectAITasks();

  // 保存当前的 AI 偏好
  try {
    await setConfig({
      aiEnhanceEnabled: aiEnhance,
      aiEnhanceMode: aiMode,
      aiEnhanceTasks: aiTasks,
    });
  } catch {
    /* ignore */
  }

  const workspaceSelect = document.getElementById("workspace-select") as HTMLSelectElement;
  const notebookSelect = document.getElementById("notebook-select") as HTMLSelectElement;

  const workspaceId = workspaceSelect.value;
  const notebookId = notebookSelect.value;

  const req: ClipRequest = {
    type: "CLIP_REQUEST",
    mode,
    tabId: tab.id,
    overrideTags: (document.getElementById("tags") as HTMLInputElement).value.trim(),
    workspaceId: workspaceId || undefined,
    notebookId: notebookId || undefined,
    comment: comment || undefined,
    aiEnhance: aiEnhance,
    aiTasks: aiTasks,
    aiMode: aiMode,
  };

  // 截图模式：关闭 popup
  if (mode === "screenshot" || mode === "fullScreenshot") {
    progressText.textContent = "正在准备截图，popup 即将关闭...";
    chrome.runtime.sendMessage(req).catch(() => {});
    setTimeout(() => window.close(), 100);
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
      noteTitle?: string;
      images?: { ok: number; failed: number; skipped: number };
    };
    progress.classList.add("hidden");
    if (res?.ok) {
      const imgInfo = res.images
        ? `图片 ${res.images.ok} 张${res.images.failed ? `（${res.images.failed} 张失败）` : ""}`
        : "";
      showResult(true, `✅ 已剪藏：「${res.noteTitle || "无标题"}」${imgInfo ? "，" + imgInfo : ""}`);
    } else {
      showResult(false, `❌ ${res?.error || "未知错误"}`);
    }
  } catch (e: any) {
    progress.classList.add("hidden");
    showResult(false, `❌ ${String(e?.message || e)}`);
  } finally {
    chrome.runtime.onMessage.removeListener(handler);
    enableClipUI();
  }
}

function showResult(ok: boolean, text: string) {
  const el = document.getElementById("result")!;
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(ok ? "ok" : "err");
  el.textContent = text;
}

void init();
