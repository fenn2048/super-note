/**
 * CoverBlurBackdrop — 全屏播放器封面氛围底
 * ----------------------------------------------------------------------------
 * 用 ID3 / 附件封面做「高斯模糊」环境光：
 *   1) 小分辨率 canvas + Canvas filter 多遍 blur（比整图 CSS blur 更匀、更省）
 *   2) 加载中 / canvas 失败时 CSS 超大幅 blur 兜底
 *   3) 始终垫一层标题/主色派生渐变，避免纯黑空窗
 *
 * 设计：保留色相，遮罩偏轻，避免盖死封面颜色。
 */
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CoverBlurBackdropProps = {
  /** 已 resolve 的封面 URL（blob/data/同源附件） */
  coverSrc?: string | null;
  /** 无封面或加载中的底色渐变 */
  fallbackGradient: string;
  className?: string;
};

const CANVAS_SIZE = 56;

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: number,
) {
  const ir = img.naturalWidth / Math.max(1, img.naturalHeight);
  let dw = size;
  let dh = size;
  let dx = 0;
  let dy = 0;
  if (ir > 1) {
    dh = size;
    dw = size * ir;
    dx = -(dw - size) / 2;
  } else {
    dw = size;
    dh = size / Math.max(ir, 0.01);
    dy = -(dh - size) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

/**
 * 小图 + filter blur 两遍，近似高斯环境光。
 * Android WebView (Chromium) 对 canvas filter 支持良好；失败则返回 false。
 */
function paintBlurredCover(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): boolean {
  const S = CANVAS_SIZE;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!ctx) return false;

  try {
    // 底色：避免透明缝
    ctx.fillStyle = "#0c0a10";
    ctx.fillRect(0, 0, S, S);

    const tmp = document.createElement("canvas");
    tmp.width = S;
    tmp.height = S;
    const tctx = tmp.getContext("2d", { alpha: false });
    if (!tctx) return false;

    tctx.fillStyle = "#0c0a10";
    tctx.fillRect(0, 0, S, S);
    drawCoverFit(tctx, img, S);

    // 第一遍：强模糊 + 提饱和
    if (typeof ctx.filter === "string") {
      ctx.filter = "blur(14px) saturate(1.55) brightness(0.92)";
      ctx.drawImage(tmp, 0, 0);
      // 第二遍：再柔化边缘
      ctx.filter = "blur(10px) saturate(1.2)";
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = "none";
    } else {
      // 无 filter 时：缩小再放大模拟柔化
      const tiny = document.createElement("canvas");
      tiny.width = 12;
      tiny.height = 12;
      const x = tiny.getContext("2d");
      if (!x) return false;
      x.drawImage(tmp, 0, 0, 12, 12);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(tiny, 0, 0, S, S);
    }
    return true;
  } catch {
    return false;
  }
}

export default function CoverBlurBackdrop({
  coverSrc,
  fallbackGradient,
  className,
}: CoverBlurBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setCanvasReady(false);
    setImgFailed(false);
    if (!coverSrc) return;

    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    if (!coverSrc.startsWith("blob:") && !coverSrc.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      if (cancelled) return;
      const ok = paintBlurredCover(canvas, img);
      if (!cancelled) {
        setCanvasReady(ok);
        if (!ok) setImgFailed(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setCanvasReady(false);
        setImgFailed(true);
      }
    };
    img.src = coverSrc;

    return () => {
      cancelled = true;
    };
  }, [coverSrc]);

  const showCssFallback = !!coverSrc && (!canvasReady || imgFailed);

  return (
    <div
      className={cn(
        "absolute inset-0 z-0 overflow-hidden pointer-events-none select-none",
        className,
      )}
      aria-hidden
    >
      {/* 1. 主色渐变底：加载中 / 无封面也有氛围 */}
      <div className="absolute inset-0" style={{ background: fallbackGradient }} />

      {/* 2. Canvas 高斯环境光（小图上采样） */}
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 w-full h-full object-cover scale-[1.5]",
          "transition-opacity duration-panel ease-out",
          canvasReady ? "opacity-100" : "opacity-0",
        )}
      />

      {/* 3. CSS 兜底：超大幅铺开再 blur，避免边缘黑框（Android 上 canvas 失败时） */}
      {showCssFallback && (
        <>
          <img
            src={coverSrc!}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 w-[180%] h-[180%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover blur-[56px] saturate-[1.5] brightness-[0.88] opacity-90"
          />
          <img
            src={coverSrc!}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 w-[220%] h-[220%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover blur-[88px] saturate-150 opacity-55"
          />
        </>
      )}

      {/* 4. 轻遮罩：可读性 + 保留封面色相（勿用高不透明 app-bg） */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black/72" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 35%, transparent 0%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </div>
  );
}
