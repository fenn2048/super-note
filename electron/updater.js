// electron/updater.js
// electron-updater 包装：自动检查 + 手动触发 + 事件广播给 renderer。
// publish 配置在 builder.config.js（GitHub Releases 作为 feed）。
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

let autoUpdater = null;
try {
  // electron-updater 是运行时依赖，构建环境可能未安装；开发环境降级为 noop
  autoUpdater = require("electron-updater").autoUpdater;
} catch (e) {
  console.warn("[updater] electron-updater 未安装，更新功能已禁用。");
}

let initialized = false;

// ---- 上下文（由 main.js 注入） --------------------------------------------
// main.js 在 app.whenReady 之后会调 setUpdaterContext({ getUserDataPath })
// 把 userData 目录的真实路径告诉 updater。这样升级前备份就能落在与 backend
// 完全一致的 `{userData}/super-data` 下，不会出现两套数据目录的怪异情况。
let ctx = {
  /** 返回 backend 实际使用的数据目录（含 SQLite）。默认兜底写进 app.getPath("userData") */
  getUserDataPath: () => {
    try {
      return path.join(app.getPath("userData"), "super-data");
    } catch {
      return null;
    }
  },
};

/**
 * 注入运行期上下文（由 main.js 调用，避免 updater 反向 require main.js 循环依赖）。
 * @param {{ getUserDataPath?: () => string | null }} next
 */
function setUpdaterContext(next) {
  if (!next) return;
  if (typeof next.getUserDataPath === "function") {
    ctx.getUserDataPath = next.getUserDataPath;
  }
}

/**
 * 升级前自动备份 SQLite。
 *
 * 为什么需要：
 *   autoUpdater.quitAndInstall 会在退出后立刻替换二进制并执行 migrations。
 *   若新版本引入了**向下不兼容**的 schema 改动（列删除、表重命名等），
 *   用户一旦发现数据异常想回退，就只能找更早的整库备份。这里在 install
 *   之前做一次"纯粹的 DB 快照"作为最后一道兜底。
 *
 * 策略：
 *   - 源文件：{userData}/super-data/super-note.db
 *   - 目标：  {userData}/super-data/backups-pre-update/<ISO-ts>.db
 *   - 只保留最近 3 份（按文件名字典序；ISO 时间戳保证与创建顺序一致）
 *   - 使用 fs.copyFileSync；SQLite 支持 WAL 模式时 .db 单文件可能不含最新
 *     事务，但 backend 进程此刻已被 autoUpdater 退出流程停掉，checkpoint
 *     一般已 flush 回主文件。极端情况下丢最后几条写入可以接受——这不是
 *     代替正常备份，只是"升级崩盘"的最后救命稻草。
 *   - 全链路 try/catch：备份失败绝不阻塞升级，只打 warn 让用户后续排查。
 */
function backupDatabaseBeforeUpdate() {
  try {
    const userDataPath = ctx.getUserDataPath?.();
    if (!userDataPath) {
      console.warn("[updater] 备份跳过：userDataPath 为空");
      return;
    }
    const dbPath = path.join(userDataPath, "super-note.db");
    if (!fs.existsSync(dbPath)) {
      console.log("[updater] 备份跳过：DB 文件不存在", dbPath);
      return;
    }
    const backupDir = path.join(userDataPath, "backups-pre-update");
    fs.mkdirSync(backupDir, { recursive: true });

    // ISO 时间戳 + 去冒号：Windows 文件名不允许 `:`
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(backupDir, `${ts}.db`);
    fs.copyFileSync(dbPath, target);
    console.log("[updater] 升级前 DB 已备份到", target);

    // 只留最近 3 份
    try {
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith(".db"))
        .sort(); // ISO 前缀保证自然顺序 = 时间顺序
      const toDelete = files.slice(0, Math.max(0, files.length - 3));
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(backupDir, f));
        } catch (e) {
          console.warn("[updater] 清理旧备份失败", f, e?.message || e);
        }
      }
    } catch (e) {
      console.warn("[updater] 清理旧备份遍历失败", e?.message || e);
    }
  } catch (e) {
    console.warn("[updater] 升级前备份失败（已忽略，不阻塞升级）:", e?.message || e);
  }
}

function broadcast(status, payload) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (!w.isDestroyed()) {
      w.webContents.send("updater:status", { status, ...payload });
    }
  }
}

/**
 * 初始化自动更新。仅在打包后的生产环境生效。
 * @param {{ onQuitRequested?: () => void }} [opts]
 */
function initAutoUpdater(opts = {}) {
  if (initialized) return;
  initialized = true;

  if (!autoUpdater || !app.isPackaged) {
    console.log("[updater] 跳过自动更新（dev 或 electron-updater 缺失）");
    // 仍注册 IPC，以便 UI 层调用时给出明确反馈
    registerIpc({ manualTrigger: true, disabled: true });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => broadcast("checking"));
  autoUpdater.on("update-available", (info) =>
    broadcast("available", { version: info?.version })
  );
  autoUpdater.on("update-not-available", () => broadcast("not-available"));
  autoUpdater.on("download-progress", (p) =>
    broadcast("downloading", {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  );
  autoUpdater.on("update-downloaded", (info) => {
    broadcast("downloaded", { version: info?.version });
    // 提示用户立即重启安装
    dialog
      .showMessageBox({
        type: "info",
        buttons: ["立即重启并安装", "稍后"],
        defaultId: 0,
        cancelId: 1,
        title: "更新已下载",
        message: `Super Note ${info?.version} 已下载完成`,
        detail: "重启后将自动安装新版本。安装前会自动保留一份数据库快照。",
      })
      .then((r) => {
        if (r.response === 0) {
          // 先做升级前 DB 备份（失败不阻塞）
          backupDatabaseBeforeUpdate();
          opts.onQuitRequested?.();
          autoUpdater.quitAndInstall();
        }
      });
  });
  autoUpdater.on("error", (err) =>
    broadcast("error", { message: err?.message || String(err) })
  );

  // 启动 5 秒后静默检查一次
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.error("[updater]", e));
  }, 5000);

  registerIpc({ manualTrigger: true, disabled: false });
}

function registerIpc({ disabled } = {}) {
  // 避免重复注册
  ipcMain.removeHandler("updater:check");
  ipcMain.removeHandler("updater:quit-and-install");

  ipcMain.handle("updater:check", async () => {
    if (disabled || !autoUpdater) {
      return { ok: false, reason: "updater-disabled" };
    }
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r?.updateInfo?.version };
    } catch (e) {
      return { ok: false, reason: e?.message || "check-failed" };
    }
  });

  ipcMain.handle("updater:quit-and-install", () => {
    if (disabled || !autoUpdater) return { ok: false };
    // 走手动调用通道同样保证升级前备份
    backupDatabaseBeforeUpdate();
    autoUpdater.quitAndInstall();
    return { ok: true };
  });
}

/** 供菜单"检查更新"调用 */
async function checkForUpdatesManually() {
  if (!autoUpdater || !app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      message: "当前为开发模式",
      detail: "自动更新仅在打包后的正式版本中可用。",
    });
    return;
  }
  try {
    broadcast("checking");
    const r = await autoUpdater.checkForUpdates();
    if (!r || !r.updateInfo) {
      await dialog.showMessageBox({ type: "info", message: "已是最新版本" });
    }
  } catch (e) {
    await dialog.showErrorBox("检查更新失败", e?.message || String(e));
  }
}

module.exports = { initAutoUpdater, checkForUpdatesManually, setUpdaterContext };

