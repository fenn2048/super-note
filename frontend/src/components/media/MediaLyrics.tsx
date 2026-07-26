/**
 * 全屏播放器歌词面板：同步歌词高亮 + 正在唱的这行平滑置顶在第一行。
 * 样式跟随 app 主题 token，适配浅色/暗色。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { findActiveLyricIndex, parseLrcText, type LyricLine } from "@/lib/id3";
import { cn } from "@/lib/utils";

export interface MediaLyricsProps {
  lines?: LyricLine[] | null;
  plain?: string | null;
  currentTime: number;
  className?: string;
  /** 点词 seek（秒） */
  onSeek?: (time: number) => void;
}

export default function MediaLyrics({
  lines,
  plain,
  currentTime,
  className,
  onSeek,
}: MediaLyricsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | HTMLParagraphElement | null)[]>([]);
  const userScrollUntil = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);

  const parsedFromPlain = useMemo(() => {
    if (lines && lines.length > 0) return null;
    if (!plain) return null;
    return parseLrcText(plain);
  }, [lines, plain]);

  const effectiveLines = lines && lines.length > 0 ? lines : parsedFromPlain;
  const synced = !!(effectiveLines && effectiveLines.length > 0);

  const plainLines = useMemo(() => {
    if (synced) return [];
    if (!plain) return [];
    return plain
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [synced, plain]);

  useEffect(() => {
    if (!synced || !effectiveLines) {
      setActiveIndex(-1);
      return;
    }
    const idx = findActiveLyricIndex(effectiveLines, currentTime);
    setActiveIndex(idx);
  }, [synced, effectiveLines, currentTime]);

  useEffect(() => {
    if (!synced || activeIndex < 0) return;
    if (Date.now() < userScrollUntil.current) return;
    const container = scrollRef.current;
    const el = lineRefs.current[activeIndex];
    if (!container || !el) return;

    try {
      const targetTop = el.offsetTop - container.offsetTop;
      container.scrollTo({
        top: Math.max(0, targetTop - 12),
        behavior: "smooth",
      });
    } catch {
      /* ignore */
    }
  }, [activeIndex, synced]);

  const markUserScroll = () => {
    userScrollUntil.current = Date.now() + 3500;
  };

  if (!synced && plainLines.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-tx-tertiary select-none",
          className,
        )}
      >
        暂无歌词
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "min-h-0 overflow-y-auto overscroll-contain px-2 py-2 scrollbar-thin",
        className,
      )}
      onTouchStart={markUserScroll}
      onWheel={markUserScroll}
      onPointerDown={markUserScroll}
    >
      <div className="flex flex-col items-center gap-2.5 py-3">
        {synced && effectiveLines
          ? effectiveLines.map((line, i) => {
              const active = i === activeIndex;
              const near = Math.abs(i - activeIndex) <= 1;
              return (
                <button
                  key={`${line.time}-${i}`}
                  type="button"
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  onClick={() => {
                    if (onSeek && line.time >= 0) onSeek(line.time);
                  }}
                  className={cn(
                    "w-full max-w-md text-center px-4 py-1.5 rounded-xl transition-all duration-300",
                    active
                      ? "text-accent-primary text-[17px] font-extrabold scale-[1.02] bg-accent-primary/10 border border-accent-primary/20"
                      : near
                        ? "text-tx-secondary text-[14px] font-medium"
                        : "text-tx-tertiary text-[13px]",
                    onSeek && "active:bg-app-hover cursor-pointer",
                    !onSeek && "cursor-default",
                  )}
                >
                  {line.text || " "}
                </button>
              );
            })
          : plainLines.map((text, i) => (
              <p
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className="w-full max-w-md text-center text-[14px] leading-relaxed text-tx-tertiary px-3"
              >
                {text}
              </p>
            ))}
      </div>
    </div>
  );
}
