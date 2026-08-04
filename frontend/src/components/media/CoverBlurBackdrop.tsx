/**
 * CoverBlurBackdrop — 全屏播放器封面氛围底（Apple Music 风格）
 * ----------------------------------------------------------------------------
 * 目标：背景仍能辨认封面主体（人物 / 构图 / 色块），不是纯色色调。
 *
 * 做法（对齐 Now Playing 参考图）：
 *   1) 全分辨率封面 object-cover 铺满，scale 略放大挡住 blur 边缘
 *   2) 中等 CSS blur（~36–48px），保留轮廓；过强会变成色泥
 *   3) 底部渐变加深保证控件可读，顶部保持透亮
 *   4) 加载失败 / 无封面时回退主色渐变
 *
 * 不再用 56px canvas 多遍强 blur（上采样后只剩色相，看不到图）。
 */
import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type CoverBlurBackdropProps = {
  /** 已 resolve 的封面 URL（blob/data/同源附件） */
  coverSrc?: string | null;
  /** 无封面或加载失败的底色渐变 */
  fallbackGradient: string;
  className?: string;
};

export default function CoverBlurBackdrop({
  coverSrc,
  fallbackGradient,
  className,
}: CoverBlurBackdropProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setImgReady(false);
  }, [coverSrc]);

  const showCover = !!coverSrc && !imgFailed;

  return (
    <div
      className={cn(
        "absolute inset-0 z-0 overflow-hidden pointer-events-none select-none",
        className,
      )}
      aria-hidden
    >
      {/* 1. 主色渐变底：无封面 / 加载中也有氛围 */}
      <div className="absolute inset-0" style={{ background: fallbackGradient }} />

      {/* 2. 封面本体：可辨认主体 + 柔和高斯（参考 Apple Music Now Playing） */}
      {showCover && (
        <>
          {/* 主层：中等 blur，亮度略压，饱和略提 */}
          <img
            key={coverSrc}
            src={coverSrc!}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => {
              setImgReady(true);
              setImgFailed(false);
            }}
            onError={() => {
              setImgReady(false);
              setImgFailed(true);
            }}
            className={cn(
              // scale 放大盖住 blur 发虚的边缘；object-cover 铺满
              "absolute left-1/2 top-1/2 w-[125%] h-[125%] max-w-none",
              "-translate-x-1/2 -translate-y-1/2 object-cover",
              // 36–48px：仍能看出人物/构图；不要上到 80px+ 色泥
              "blur-[40px] sm:blur-[48px]",
              "brightness-[0.72] contrast-[1.05] saturate-[1.2]",
              "transition-opacity duration-panel ease-out",
              imgReady ? "opacity-100" : "opacity-0",
            )}
          />
          {/* 轻微第二层：更大更淡，增加景深柔和，不盖死细节 */}
          <img
            src={coverSrc!}
            alt=""
            draggable={false}
            aria-hidden
            className={cn(
              "absolute left-1/2 top-1/2 w-[145%] h-[145%] max-w-none",
              "-translate-x-1/2 -translate-y-1/2 object-cover",
              "blur-[64px] brightness-[0.65] saturate-[1.35]",
              "transition-opacity duration-panel ease-out",
              imgReady ? "opacity-45" : "opacity-0",
            )}
          />
        </>
      )}

      {/* 3. 遮罩：顶部透、中部略压、底部深 —— 控件区可读，上半仍见封面 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.38) 42%, rgba(0,0,0,0.62) 72%, rgba(0,0,0,0.88) 100%)",
        }}
      />
      {/* 中心略提亮，让圆形封面与背景层次分离（参考图上半偏亮） */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 50% 28%, rgba(255,255,255,0.06) 0%, transparent 55%)",
        }}
      />
    </div>
  );
}
