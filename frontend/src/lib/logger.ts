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

/**
 * 浏览器在同一帧里 ResizeObserver 回调又触发尺寸变化时会抛出该通知。
 * 常见于阅读器 / 列表 / 图表，**不是真正的业务异常**，Chrome 也会在控制台
 * 显示为 error 级别。过滤掉避免污染 GlobalJSError 与 Android 日志。
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors
 */
function isBenignResizeObserverNoise(message: unknown): boolean {
  const msg = String(message || "");
  return (
    msg.includes("ResizeObserver loop completed with undelivered notifications") ||
    msg.includes("ResizeObserver loop limit exceeded")
  );
}

// 自动拦截未捕获全局 JS 错误
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (isBenignResizeObserverNoise(event.message)) {
      // 阻止继续冒泡到其它全局 handler / 控制台重复刷屏（部分环境）
      event.stopImmediatePropagation?.();
      event.preventDefault?.();
      return;
    }
    logger.error(
      "GlobalJSError",
      `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      event.error?.stack || "",
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason);
    if (isBenignResizeObserverNoise(msg)) {
      event.preventDefault?.();
      return;
    }
    logger.error("UnhandledPromiseRejection", msg, reason?.stack || "");
  });
}
