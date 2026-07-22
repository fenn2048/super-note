/**
 * 全局 JS 日志框架 & Android 原生日志桥接：
 *   - 在 Web / Dev 状态输出格式化控制台日志
 *   - 在 Android 原生平台通过 AndroidLogBridge 异步写入 AppLogger 持久化文件
 *   - 拦截未捕获的全局 JS 异常与 Promise 拒绝
 */

declare global {
  interface Window {
    AndroidLogBridge?: {
      log: (level: string, tag: string, message: string) => void;
    };
  }
}

function formatMsg(msg: string, meta?: any): string {
  if (meta === undefined) return msg;
  try {
    const metaStr = typeof meta === "object" ? JSON.stringify(meta) : String(meta);
    return `${msg} ${metaStr}`;
  } catch {
    return `${msg} [Meta Serialization Error]`;
  }
}

function sendToNative(level: string, tag: string, message: string) {
  if (typeof window !== "undefined" && window.AndroidLogBridge) {
    try {
      window.AndroidLogBridge.log(level, tag, message);
    } catch {
      /* ignore native bridge error */
    }
  }
}

export const logger = {
  debug(tag: string, msg: string, meta?: any) {
    const text = formatMsg(msg, meta);
    console.debug(`[${tag}] ${text}`);
    sendToNative("DEBUG", tag, text);
  },

  info(tag: string, msg: string, meta?: any) {
    const text = formatMsg(msg, meta);
    console.info(`[${tag}] ${text}`);
    sendToNative("INFO", tag, text);
  },

  warn(tag: string, msg: string, meta?: any) {
    const text = formatMsg(msg, meta);
    console.warn(`[${tag}] ${text}`);
    sendToNative("WARN", tag, text);
  },

  error(tag: string, msg: string, meta?: any) {
    const text = formatMsg(msg, meta);
    console.error(`[${tag}] ${text}`);
    sendToNative("ERROR", tag, text);
  },
};

// 自动拦截未捕获全局 JS 错误
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    logger.error(
      "GlobalJSError",
      `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      event.error?.stack || "",
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason);
    logger.error("UnhandledPromiseRejection", msg, reason?.stack || "");
  });
}
