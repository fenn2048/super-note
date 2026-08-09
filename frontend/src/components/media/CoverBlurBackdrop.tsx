/**
 * CoverBlurBackdrop — 全屏播放器封面氛围底（Apple Music Now Playing）
 * ----------------------------------------------------------------------------
 * 目标：背景仍能辨认封面主体（人物 / 构图），不是纯色色调。
 *
 * 关键：BottomSheet 等带 transform 的祖先会让 CSS filter:blur 在 Android WebView
 * 上失效或糊成色泥。因此：
 *   1) 支持 portal 到 body（fixed），脱离 transform 树
 *   2) Android 走 canvas 中等分辨率虚化（不依赖 CSS filter 合成）
 *   3) canvas 前 fetch→blob 规避 CORS 污染
 *   4) 其它平台优先 CSS blur；失败再回退 canvas / 放大图占位
 *
 * 遮罩：上半透亮、下半渐深，保证控件可读且上半仍见封面。
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type CoverBlurBackdropProps = {
  /** 已 resolve 的封面 URL（blob/data/同源附件） */
  coverSrc?: string | null;
  /** 无封面或加载失败的底色渐变 */
  fallbackGradient: string;
  className?: string;
  /**
   * true：fixed 全屏 portal 到 body（推荐全屏播放器，避免 sheet transform 毁掉 blur）
   * false：作为普通 absolute 层（需父级 relative + 无 transform 干扰）
   */
  portal?: boolean;
  /** portal 时的 z-index 类，默认低于全屏 sheet(z-160) */
  zClassName?: string;
  /** portal 打开时才挂载（与 isExpanded 绑定） */
  active?: boolean;
};

function isAndroidWebView(): boolean {
  try {
    if (document.documentElement.getAttribute("data-native") === "android") return true;
    return /Android/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

/** 把远程图拉成 blob:，避免 canvas CORS 污染导致 toDataURL 失败 */
async function ensureDrawableSrc(src: string): Promise<{ url: string; revoke?: () => void }> {
  if (src.startsWith("blob:") || src.startsWith("data:")) {
    return { url: src };
  }
  try {
    const res = await fetch(src, { credentials: "include", mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && blob.size < 32) throw new Error("not image");
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    // 无 CORS 时仍尝试直接画（同源附件可能成功）
    return { url: src };
  }
}

/** 中等分辨率 canvas 虚化，保留构图 */
function buildCanvasBlurDataUrl(
  src: string,
  outSize = 480,
  blurPx = 24,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith("blob:") && !src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = outSize;
        canvas.height = outSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) {
          resolve(null);
          return;
        }
        const scale = Math.max(outSize / iw, outSize / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (outSize - dw) / 2;
        const dy = (outSize - dh) / 2;
        ctx.filter = `blur(${blurPx}px) brightness(0.92) saturate(1.22)`;
        ctx.drawImage(img, dx - outSize * 0.1, dy - outSize * 0.1, dw * 1.2, dh * 1.2);
        ctx.filter = "none";
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function AtmosphereLayers({
  coverSrc,
  fallbackGradient,
  className,
}: {
  coverSrc?: string | null;
  fallbackGradient: string;
  className?: string;
}) {
  const preferCanvas = useMemo(() => isAndroidWebView(), []);
  const [imgFailed, setImgFailed] = useState(false);
  const [cssReady, setCssReady] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasFailed, setCanvasFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setCssReady(false);
    setCanvasUrl(null);
    setCanvasReady(false);
    setCanvasFailed(false);
    if (!coverSrc) return;

    let cancelled = false;
    let revoke: (() => void) | undefined;

    void (async () => {
      const drawable = await ensureDrawableSrc(coverSrc);
      if (cancelled) {
        drawable.revoke?.();
        return;
      }
      revoke = drawable.revoke;
      const url = await buildCanvasBlurDataUrl(drawable.url, 480, preferCanvas ? 26 : 22);
      if (cancelled) return;
      if (url) {
        setCanvasUrl(url);
      } else {
        setCanvasFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      revoke?.();
    };
  }, [coverSrc, preferCanvas]);

  const showCss = !!coverSrc && !imgFailed && !preferCanvas;
  // Android / CSS 失败：canvas；canvas 失败时用放大原图作弱虚化占位
  const showCanvas = !!coverSrc && !!canvasUrl && (preferCanvas || imgFailed || !cssReady);
  const showScaledFallback =
    !!coverSrc && !imgFailed && (preferCanvas ? !canvasUrl || canvasFailed : imgFailed && canvasFailed);

  return (
    <div
      className={cn("overflow-hidden pointer-events-none select-none", className)}
      aria-hidden
    >
      {/* 1. 主色渐变底 */}
      <div className="absolute inset-0" style={{ background: fallbackGradient }} />

      {/* 1b. 占位：未 blur 的放大封面（canvas/CSS 就绪前也能认出构图） */}
      {!!coverSrc && !imgFailed && (
        <img
          key={`ph-${coverSrc}`}
          src={coverSrc}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setImgFailed(true)}
          className={cn(
            "absolute left-1/2 top-1/2 w-[160%] h-[160%] max-w-none",
            "-translate-x-1/2 -translate-y-1/2 object-cover",
            "brightness-[0.78] saturate-[1.15] scale-110",
            // canvas/CSS 出来后淡出，避免硬切
            showCanvas && canvasReady
              ? "opacity-0 transition-opacity duration-panel ease-out"
              : showCss && cssReady
                ? "opacity-0 transition-opacity duration-panel ease-out"
                : "opacity-70",
          )}
        />
      )}

      {/* 2a. CSS blur 层（非 Android 优先） */}
      {showCss && (
        <>
          <img
            key={`css-${coverSrc}`}
            src={coverSrc!}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => {
              setCssReady(true);
              setImgFailed(false);
            }}
            onError={() => {
              setCssReady(false);
              setImgFailed(true);
            }}
            className={cn(
              "absolute left-1/2 top-1/2 w-[130%] h-[130%] max-w-none",
              "-translate-x-1/2 -translate-y-1/2 object-cover",
              "blur-[36px] sm:blur-[44px]",
              "brightness-[0.9] contrast-[1.04] saturate-[1.2]",
              "transition-opacity duration-panel ease-out",
              cssReady ? "opacity-100" : "opacity-0",
            )}
          />
          <img
            src={coverSrc!}
            alt=""
            draggable={false}
            aria-hidden
            className={cn(
              "absolute left-1/2 top-1/2 w-[150%] h-[150%] max-w-none",
              "-translate-x-1/2 -translate-y-1/2 object-cover",
              "blur-[56px] brightness-[0.78] saturate-[1.25]",
              "transition-opacity duration-panel ease-out",
              cssReady ? "opacity-35" : "opacity-0",
            )}
          />
        </>
      )}

      {/* 2b. Canvas 虚化层（Android / CSS 失败） */}
      {showCanvas && (
        <img
          key={`cv-${coverSrc}`}
          src={canvasUrl!}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setCanvasReady(true)}
          className={cn(
            "absolute left-1/2 top-1/2 w-[145%] h-[145%] max-w-none",
            "-translate-x-1/2 -translate-y-1/2 object-cover",
            "transition-opacity duration-panel ease-out",
            canvasReady || preferCanvas ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/* 2c. canvas 彻底失败时的弱化原图层 */}
      {showScaledFallback && (
        <img
          src={coverSrc!}
          alt=""
          draggable={false}
          className={cn(
            "absolute left-1/2 top-1/2 w-[170%] h-[170%] max-w-none",
            "-translate-x-1/2 -translate-y-1/2 object-cover",
            "opacity-55 brightness-[0.75] saturate-[1.2]",
          )}
        />
      )}

      {/* 3. 遮罩：上半更透（见封面），下半渐深（保控件）——对齐 Apple 参考 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.22) 32%, rgba(0,0,0,0.42) 58%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 62% at 50% 28%, rgba(255,255,255,0.1) 0%, transparent 55%)",
        }}
      />
    </div>
  );
}

export default function CoverBlurBackdrop({
  coverSrc,
  fallbackGradient,
  className,
  portal = false,
  zClassName = "z-[159]",
  active = true,
}: CoverBlurBackdropProps) {
  if (!active) return null;

  if (portal && typeof document !== "undefined") {
    return createPortal(
      <AtmosphereLayers
        coverSrc={coverSrc}
        fallbackGradient={fallbackGradient}
        className={cn("fixed inset-0", zClassName, className)}
      />,
      document.body,
    );
  }

  return (
    <AtmosphereLayers
      coverSrc={coverSrc}
      fallbackGradient={fallbackGradient}
      className={cn("absolute inset-0 z-0", className)}
    />
  );
}
