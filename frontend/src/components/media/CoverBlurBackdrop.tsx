/**
 * CoverBlurBackdrop — 全屏播放器封面氛围底（Apple Music Now Playing）
 * ----------------------------------------------------------------------------
 * Android WebView 上 CSS filter:blur 与 canvas ctx.filter 都不可靠。
 * 虚化策略：
 *   1) fetch → blob（减少 CORS）
 *   2) 画到很小的 canvas 再放大到大尺寸（不依赖 filter API）
 *   3) 同时放一层放大原图作占位，保证始终能看见封面构图
 * portal：fixed 到 body，避免 sheet transform 干扰；全屏播放器也会在 panel 内再叠一层。
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type CoverBlurBackdropProps = {
  coverSrc?: string | null;
  fallbackGradient: string;
  className?: string;
  /** true：fixed 全屏 portal 到 body */
  portal?: boolean;
  zClassName?: string;
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

async function ensureDrawableSrc(src: string): Promise<{ url: string; revoke?: () => void }> {
  if (src.startsWith("blob:") || src.startsWith("data:")) {
    return { url: src };
  }
  try {
    const res = await fetch(src, { credentials: "include", mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (blob.size < 32) throw new Error("empty");
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    try {
      // no-cors 读不到像素，仅作 img 直链兜底
      return { url: src };
    } catch {
      return { url: src };
    }
  }
}

/**
 * 降采样再放大的虚化（不依赖 ctx.filter，Android WebView 可用）
 * smallSize 越小越糊；outSize 越大越清晰边缘。
 */
function buildDownscaleBlurDataUrl(
  src: string,
  outSize = 512,
  smallSize = 48,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // blob/data 不需要 crossOrigin；远程尝试 anonymous
    if (!src.startsWith("blob:") && !src.startsWith("data:")) {
      try {
        img.crossOrigin = "anonymous";
      } catch {
        /* ignore */
      }
    }
    img.onload = () => {
      try {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) {
          resolve(null);
          return;
        }

        const small = document.createElement("canvas");
        small.width = smallSize;
        small.height = smallSize;
        const sctx = small.getContext("2d");
        if (!sctx) {
          resolve(null);
          return;
        }
        // cover 裁进正方形
        const scale0 = Math.max(smallSize / iw, smallSize / ih);
        const dw0 = iw * scale0;
        const dh0 = ih * scale0;
        sctx.drawImage(img, (smallSize - dw0) / 2, (smallSize - dh0) / 2, dw0, dh0);

        const out = document.createElement("canvas");
        out.width = outSize;
        out.height = outSize;
        const octx = out.getContext("2d");
        if (!octx) {
          resolve(null);
          return;
        }
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        // 略放大再画，边缘更满、更糊
        const pad = outSize * 0.12;
        octx.drawImage(small, -pad, -pad, outSize + pad * 2, outSize + pad * 2);

        // 轻微二次降采样增强糊感（仍不依赖 filter）
        const mid = document.createElement("canvas");
        const midSize = Math.max(32, Math.round(outSize / 6));
        mid.width = midSize;
        mid.height = midSize;
        const mctx = mid.getContext("2d");
        if (mctx) {
          mctx.imageSmoothingEnabled = true;
          mctx.drawImage(out, 0, 0, midSize, midSize);
          octx.clearRect(0, 0, outSize, outSize);
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = "high";
          octx.drawImage(mid, -pad * 0.5, -pad * 0.5, outSize + pad, outSize + pad);
        }

        // 亮度/饱和：用半透明叠色近似
        octx.globalCompositeOperation = "source-atop";
        octx.fillStyle = "rgba(0,0,0,0.12)";
        octx.fillRect(0, 0, outSize, outSize);
        octx.globalCompositeOperation = "source-over";

        resolve(out.toDataURL("image/jpeg", 0.9));
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
  const preferDownscale = useMemo(() => isAndroidWebView(), []);
  const [imgFailed, setImgFailed] = useState(false);
  const [blurUrl, setBlurUrl] = useState<string | null>(null);
  const [blurReady, setBlurReady] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setBlurUrl(null);
    setBlurReady(false);
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
      // Android：更强糊（更小 mid）；桌面也可统一走此路径更稳
      const url = await buildDownscaleBlurDataUrl(
        drawable.url,
        560,
        preferDownscale ? 40 : 56,
      );
      if (cancelled) return;
      if (url) setBlurUrl(url);
    })();

    return () => {
      cancelled = true;
      revoke?.();
    };
  }, [coverSrc, preferDownscale]);

  // 铺满视口、中心对齐；不 scale，避免切歌时「先清晰再放大虚化」
  const fillScreen =
    "absolute inset-0 w-full h-full object-cover object-center max-w-none";

  return (
    <div
      className={cn("overflow-hidden pointer-events-none select-none", className)}
      style={{ background: fallbackGradient }}
      aria-hidden
    >
      {/* 仅显示虚化层：切歌时先保持渐变底，虚化图好了再淡入，绝不闪清晰原图 */}
      {!!blurUrl && (
        <img
          key={`blur-${coverSrc}`}
          src={blurUrl}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setBlurReady(true)}
          className={cn(
            fillScreen,
            "transition-opacity duration-300 ease-out",
            blurReady ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/* 桌面：可选 CSS blur（同样无 scale、不叠清晰原图） */}
      {!!coverSrc && !imgFailed && !preferDownscale && blurReady && (
        <img
          src={coverSrc}
          alt=""
          draggable={false}
          onError={() => setImgFailed(true)}
          className={cn(
            fillScreen,
            "blur-[40px] brightness-[0.88] saturate-[1.15] opacity-40",
          )}
        />
      )}

      {/* 遮罩：上半透、下半深 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 35%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.7) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 95% 70% at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 58%)",
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
