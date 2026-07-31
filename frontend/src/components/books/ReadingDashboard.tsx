/**
 * 书库「阅读中」仪表盘：当前图书 / 最近读过 / 每日阅读目标
 * 桌面与移动端共用同一套页面；移动端做触控与窄屏适配。
 * 样式走 app token，布局参考产品截图功能，不抄扁平黑白皮。
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, SlidersHorizontal, X } from "lucide-react";
import type { Book } from "@/types";
import { cn } from "@/lib/utils";
import { resolveAttachmentUrl } from "@/lib/api";
import {
  DEFAULT_DAILY_READING_GOAL_MINUTES,
  formatReadingClock,
  getCachedDailyReadingGoal,
  getTodayReadingMinutes,
  goalProgressRatio,
  parseGoalFromPrefs,
  remainingGoalMinutes,
  setCachedDailyReadingGoal,
  clampDailyReadingGoal,
  MIN_DAILY_READING_GOAL,
  MAX_DAILY_READING_GOAL,
} from "@/lib/readingGoal";
import { api } from "@/lib/api";

function getHashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsla(${h}, 70%, 35%, 0.85)`;
}

function coverUrlOf(book: Book): string | null {
  if (!book.metadata) return null;
  try {
    const meta = JSON.parse(book.metadata);
    if (meta.coverAttachmentId) {
      return resolveAttachmentUrl(`/api/attachments/${meta.coverAttachmentId}`);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 桌面/移动统一封面宽度：与「最近读过」一致，书库网格也沿用此尺寸 */
export const BOOK_COVER_WIDTH_CLASS = "w-28 sm:w-32";

function BookCoverCard({
  book,
  onOpen,
}: {
  book: Book;
  onOpen: (hash: string) => void;
}) {
  const coverUrl = coverUrlOf(book);
  const bg = getHashColor(book.title);

  return (
    <button
      type="button"
      onClick={() => onOpen(book.bookHash)}
      className={cn(
        "group/cover flex flex-col text-left shrink-0 active:scale-[0.98] transition-transform",
        BOOK_COVER_WIDTH_CLASS,
      )}
    >
      <div
        className="aspect-[3/4] w-full relative overflow-hidden rounded-lg shadow-md border border-app-border/40"
        style={{ backgroundColor: bg }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1.5 z-[1] bg-gradient-to-r from-black/25 via-white/10 to-transparent pointer-events-none" />
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center px-2 text-center pointer-events-none">
          <span className="text-[11px] font-bold text-white leading-tight font-serif line-clamp-4 drop-shadow">
            {book.title}
          </span>
        </div>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="absolute inset-0 z-[2] w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-xs font-medium text-tx-primary line-clamp-2 leading-snug group-hover/cover:text-accent-primary transition-colors">
          {book.title}
        </div>
        {book.author ? (
          <div className="text-[10px] text-tx-tertiary truncate mt-0.5">{book.author}</div>
        ) : null}
      </div>
    </button>
  );
}

/** SVG 半环进度（仅环本身，文案叠在外层独立定位层） */
function SemiRing({ ratio, className }: { ratio: number; className?: string }) {
  const r = 92;
  const cx = 110;
  const cy = 108;
  const startX = cx - r;
  const startY = cy;
  const endX = cx + r;
  const endY = cy;
  const path = `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`;
  const len = Math.PI * r;
  const progress = Math.min(1, Math.max(0, ratio));
  const dash = progress * len;

  return (
    <svg
      viewBox="0 0 220 120"
      className={cn("w-full h-auto block", className)}
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        className="text-app-border"
      />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        className="text-accent-primary"
        strokeDasharray={`${dash} ${len}`}
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
    </svg>
  );
}

export interface ReadingDashboardProps {
  books: Book[];
  onOpenBook: (bookHash: string) => void;
  /**
   * page：书库独立全页（自带滚动）
   * section：嵌入首页等父级滚动容器（无独立滚动、更紧凑）
   */
  variant?: "page" | "section";
}

export default function ReadingDashboard({
  books,
  onOpenBook,
  variant = "page",
}: ReadingDashboardProps) {
  const isSection = variant === "section";
  const sorted = useMemo(() => {
    return [...books].sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      return tb - ta;
    });
  }, [books]);

  const currentBook = sorted[0] ?? null;
  const recentBooks = sorted.slice(1, 13);

  const [goalMinutes, setGoalMinutes] = useState(getCachedDailyReadingGoal);
  const [todayMinutes, setTodayMinutes] = useState(() => getTodayReadingMinutes());
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [draftGoal, setDraftGoal] = useState(String(goalMinutes));
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getUserPreferences();
        const fromPrefs = parseGoalFromPrefs(res.prefs);
        if (!cancelled && fromPrefs != null) {
          setGoalMinutes(setCachedDailyReadingGoal(fromPrefs));
        }
      } catch {
        /* offline / 未登录：用缓存 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setTodayMinutes(getTodayReadingMinutes());
    refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("super:reading-minutes-changed", refresh);
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("super:reading-minutes-changed", refresh);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, []);

  // 弹窗打开时锁 body 滚动，避免底层资料库列表跟着滑
  useEffect(() => {
    if (!goalDialogOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [goalDialogOpen]);

  const remaining = remainingGoalMinutes(todayMinutes, goalMinutes);
  const ratio = goalProgressRatio(todayMinutes, goalMinutes);
  const clock = formatReadingClock(todayMinutes);

  const openGoalDialog = (e?: React.MouseEvent | React.PointerEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setDraftGoal(String(goalMinutes));
    setGoalDialogOpen(true);
  };

  const saveGoal = async () => {
    const n = clampDailyReadingGoal(Number(draftGoal) || DEFAULT_DAILY_READING_GOAL_MINUTES);
    setSavingGoal(true);
    try {
      setGoalMinutes(setCachedDailyReadingGoal(n));
      try {
        await api.updateUserPreferences({ dailyReadingGoalMinutes: n });
      } catch {
        /* 本地已缓存，同步失败不阻断 */
      }
      setGoalDialogOpen(false);
    } finally {
      setSavingGoal(false);
    }
  };

  const goalDialog =
    goalDialogOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
            onClick={() => setGoalDialogOpen(false)}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal
              aria-labelledby="daily-reading-goal-title"
              className="w-full sm:max-w-xs rounded-t-2xl sm:rounded-2xl border border-app-border bg-app-elevated shadow-2xl p-5 pb-[max(1.25rem,var(--safe-area-bottom,0px))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <h3
                  id="daily-reading-goal-title"
                  className="text-base font-bold text-tx-primary text-center flex-1"
                >
                  每日阅读目标
                </h3>
                <button
                  type="button"
                  onClick={() => setGoalDialogOpen(false)}
                  className="p-2 -mr-1 rounded-md text-tx-tertiary hover:bg-app-hover min-w-[40px] min-h-[40px] flex items-center justify-center"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex items-center justify-center gap-2 mb-5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_DAILY_READING_GOAL}
                  max={MAX_DAILY_READING_GOAL}
                  step={5}
                  value={draftGoal}
                  onChange={(e) => setDraftGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveGoal();
                  }}
                  className="w-24 h-11 px-2 text-center text-base font-semibold rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 tabular-nums"
                  autoFocus
                />
                <span className="text-sm text-tx-secondary">分钟/天</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setGoalDialogOpen(false)}
                  className="px-5 py-2.5 rounded-full text-sm font-medium border border-app-border bg-app-surface text-tx-primary hover:bg-app-hover transition-colors min-h-[44px]"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={savingGoal}
                  onClick={() => void saveGoal()}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold bg-tx-primary text-app-bg hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                >
                  好
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={cn(
        isSection
          ? "w-full"
          : "flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-8 pb-[calc(5rem+var(--safe-area-bottom,0px))]",
      )}
    >
      <div
        className={cn(
          "space-y-5 md:space-y-8",
          isSection ? "w-full" : "max-w-4xl mx-auto",
        )}
      >
        {/* 标题 */}
        <header>
          <h1
            className={cn(
              "font-bold text-tx-primary tracking-tight",
              isSection ? "text-base md:text-lg" : "text-xl md:text-2xl",
            )}
          >
            阅读中
          </h1>
          <p className="mt-1.5 text-sm text-tx-secondary flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  ratio >= 1 ? "bg-emerald-500" : "bg-accent-primary animate-pulse",
                )}
                aria-hidden
              />
              今日阅读进度
            </span>
            <span className="text-tx-tertiary">
              {remaining > 0 ? `还剩 ${remaining} 分钟` : "今日目标已完成"}
            </span>
          </p>
        </header>

        {/* 当前 / 最近：窄屏上下堆叠，宽屏横排 */}
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-8">
            <div className="shrink-0">
              <h2 className="text-sm font-semibold text-tx-primary mb-3">当前图书</h2>
              {currentBook ? (
                <BookCoverCard book={currentBook} onOpen={onOpenBook} />
              ) : (
                <div
                  className={cn(
                    BOOK_COVER_WIDTH_CLASS,
                    "aspect-[3/4] rounded-lg border border-dashed border-app-border bg-app-surface/40 flex flex-col items-center justify-center text-tx-tertiary text-xs gap-2 px-3 text-center",
                  )}
                >
                  <BookOpen size={22} className="opacity-50" />
                  暂无在读
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-tx-primary mb-3">最近读过</h2>
              {recentBooks.length > 0 ? (
                <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
                  {recentBooks.map((b) => (
                    <BookCoverCard key={b.bookHash} book={b} onOpen={onOpenBook} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-tx-tertiary py-6 md:py-8">开始阅读更多书籍后会出现在这里</p>
              )}
            </div>
          </div>
        </section>

        {/* 阅读目标 */}
        <section className="space-y-2">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-tx-primary">阅读目标</h2>
            <p className="text-xs text-tx-tertiary mt-1 leading-relaxed">
              坚持每天阅读，提升你的数据，以激励你读完更多图书。
            </p>
          </div>

          <div className="relative rounded-2xl border border-app-border bg-app-elevated/60 shadow-sm px-4 pt-5 pb-6 sm:px-8 sm:pt-8 sm:pb-10">
            {/* 设置目标：独立高层，避免被进度环遮挡；移动端始终可见 */}
            <button
              type="button"
              onClick={openGoalDialog}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "absolute top-3 right-3 z-20",
                "p-2.5 min-w-[44px] min-h-[44px] rounded-xl",
                "border border-app-border bg-app-surface text-tx-secondary",
                "hover:text-accent-primary hover:border-accent-primary/40",
                "active:scale-95 transition-colors shadow-sm",
                "flex items-center justify-center",
                "touch-manipulation",
              )}
              title="设置每日阅读目标"
              aria-label="设置每日阅读目标"
            >
              <SlidersHorizontal size={16} />
            </button>

            {/*
              进度环与文案：单独 relative 容器，高度只等于 SVG。
              禁止把「继续阅读」放进同一 relative，否则 absolute 文案会相对整块（环+按钮）定位导致重叠。
            */}
            <div className="relative w-full max-w-[260px] sm:max-w-[300px] mx-auto">
              <SemiRing ratio={ratio} />
              {/* 文案叠在半环内侧空腔，不参与文档流，也不盖住下方按钮 */}
              <div className="absolute left-0 right-0 top-[18%] flex flex-col items-center justify-center text-center pointer-events-none px-4">
                <div className="text-[11px] sm:text-xs font-medium text-tx-secondary mb-0.5">
                  今日阅读进度
                </div>
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-tx-primary tabular-nums tracking-tight leading-none">
                  {clock}
                </div>
                <div className="text-[11px] sm:text-xs text-tx-tertiary mt-1.5">
                  （目标 {goalMinutes} 分钟）
                </div>
              </div>
            </div>

            {/* 继续阅读：正常文档流，在环下方留出明确间距 */}
            <div className="mt-5 sm:mt-6 flex justify-center px-1">
              <button
                type="button"
                disabled={!currentBook}
                onClick={() => currentBook && onOpenBook(currentBook.bookHash)}
                className={cn(
                  "w-full max-w-sm px-6 py-3.5 rounded-full text-sm font-semibold transition-all active:scale-[0.98]",
                  "bg-tx-primary text-app-bg hover:opacity-90 shadow-md",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100",
                  "touch-manipulation min-h-[48px]",
                )}
              >
                <span className="block leading-tight">继续阅读</span>
                {currentBook ? (
                  <span className="block text-[11px] font-normal opacity-80 mt-0.5 line-clamp-1">
                    {currentBook.title}
                  </span>
                ) : (
                  <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                    暂无在读书籍
                  </span>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>

      {goalDialog}
    </div>
  );
}
