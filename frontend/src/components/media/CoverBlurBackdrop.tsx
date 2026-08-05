/**
 * CoverBlurBackdrop — 全屏播放器封面氛围底（Apple Music Now Playing）
 * ----------------------------------------------------------------------------
 * 目标：背景仍能辨认封面主体（人物 / 构图），不是纯色色调。
 *
 * 关键：BottomSheet 等带 transform 的祖先会让 CSS filter:blur 在 Android WebView
 * 上失效或糊成色泥。因此：
 *   1) 支持 portal 到 body（fixed），脱离 transform 树
 *   2) Android 默认走 canvas 中等分辨率虚化（不依赖 CSS filter 合成）
 *   3) 其它平台优先 CSS blur；失败再回退 canvas
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

function isAndroidNative(): boolean {
  try {
    return document.documentElement.getAttribute("data-native") === "android";
  } catch {
    return false;
  }
}

/** 中等分辨率 canvas 虚化，保留构图（勿用 56px） */
function buildCanvasBlurDataUrl(src: string, outSize = 320, blurPx = 18): Promise<string | null> {
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
        // cover 裁切进正方形
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const scale = Math.max(outSize / iw, outSize / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (outSize - dw) / 2;
        const dy = (outSize - dh) / 2;
        // 略放大再画，边缘更满
        ctx.filter = `blur(${blurPx}px) brightness(0.88) saturate(1.2)`;
        ctx.drawImage(img, dx - outSize * 0.08, dy - outSize * 0.08, dw * 1.16, dh * 1.16);
        ctx.filter = "none";
        resolve(canvas.toDataURL("image/jpeg", 0.85));
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
  const preferCanvas = useMemo(() => isAndroidNative(), []);
  const [imgFailed, setImgFailed] = useState(false);
  const [cssReady, setCssReady] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setCssReady(false);
    setCanvasUrl(null);
    setCanvasReady(false);
    if (!coverSrc) return;

    let cancelled = false;
    // Android 始终准备 canvas；其它平台并行准备作为兜底
    void buildCanvasBlurDataUrl(coverSrc).then((url) => {
      if (cancelled || !url) return;
      setCanvasUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [coverSrc]);

  const showCss = !!coverSrc && !imgFailed && !preferCanvas;
  const showCanvas = !!coverSrc && !!canvasUrl && (preferCanvas || imgFailed || !cssReady);

  return (
    <div
      className={cn(
        "overflow-hidden pointer-events-none select-none",
        className,
      )}
      aria-hidden
    >
      {/* 1. 主色渐变底 */}
      <div className="absolute inset-0" style={{ background: fallbackGradient }} />

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
              "brightness-[0.88] contrast-[1.04] saturate-[1.18]",
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
              "blur-[56px] brightness-[0.75] saturate-[1.25]",
              "transition-opacity duration-panel ease-out",
              cssReady ? "opacity-30" : "opacity-0",
            )}
          />
        </>
      )}

      {/* 2b. Canvas 虚化层（Android / CSS 失败 / CSS 未就绪时） */}
      {showCanvas && (
        <img
          key={`cv-${coverSrc}`}
          src={canvasUrl!}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setCanvasReady(true)}
          className={cn(
            "absolute left-1/2 top-1/2 w-[140%] h-[140%] max-w-none",
            "-translate-x-1/2 -translate-y-1/2 object-cover",
            "transition-opacity duration-panel ease-out",
            canvasReady || preferCanvas ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/* 3. 遮罩：顶部更透，底部才深（对齐参考：上半见封面） */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.32) 38%, rgba(0,0,0,0.52) 68%, rgba(0,0,0,0.82) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 95% 58% at 50% 26%, rgba(255,255,255,0.08) 0%, transparent 58%)",
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
