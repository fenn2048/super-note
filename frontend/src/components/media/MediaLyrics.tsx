/**
 * 全屏播放器歌词面板：同步歌词高亮 + 自动居中滚动；纯文本可滚动只读。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { findActiveLyricIndex, type LyricLine } from "@/lib/id3";
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

  const synced = !!(lines && lines.length > 0);
  const plainLines = useMemo(() => {
    if (synced) return [];
    if (!plain) return [];
    return plain
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [synced, plain]);

  // 跟拍当前句
  useEffect(() => {
    if (!synced || !lines) {
      setActiveIndex(-1);
      return;
    }
    const idx = findActiveLyricIndex(lines, currentTime);
    setActiveIndex(idx);
  }, [synced, lines, currentTime]);

  // 自动滚到当前句（用户手动滑动后短暂停跟滚）
  useEffect(() => {
    if (!synced || activeIndex < 0) return;
    if (Date.now() < userScrollUntil.current) return;
    const el = lineRefs.current[activeIndex];
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* ignore */
    }
  }, [activeIndex, synced]);

  const markUserScroll = () => {
    userScrollUntil.current = Date.now() + 3000;
  };

  if (!synced && plainLines.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-white/35 select-none",
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
        "min-h-0 overflow-y-auto overscroll-contain px-2 py-4 scrollbar-thin",
        className,
      )}
      onTouchStart={markUserScroll}
      onWheel={markUserScroll}
      onPointerDown={markUserScroll}
    >
      <div className="flex flex-col items-center gap-3 py-8">
        {synced && lines
          ? lines.map((line, i) => {
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
                    "w-full max-w-md text-center px-3 py-1.5 rounded-lg transition-all duration-200",
                    active
                      ? "text-white text-[17px] font-semibold scale-[1.02]"
                      : near
                        ? "text-white/55 text-[14px] font-medium"
                        : "text-white/30 text-[13px]",
                    onSeek && "active:bg-white/5 cursor-pointer",
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
                className="w-full max-w-md text-center text-[14px] leading-relaxed text-white/50 px-3"
              >
                {text}
              </p>
            ))}
      </div>
    </div>
  );
}
