import { BottomSheet } from "@/components/common/BottomSheet";
/**
 * 书库「阅读中」仪表盘：当前图书 / 最近读过 / 每日阅读目标
 * 桌面与移动端共用同一套页面；移动端做触控与窄屏适配。
 * 样式走 app token，布局参考产品截图功能，不抄扁平黑白皮。
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  SlidersHorizontal,
  X,
  HardDrive,
  DownloadCloud,
  Loader2,
  Pause,
} from "lucide-react";
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
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  enqueueBookCache,
  getBookCacheJob,
  getCachedBookHashSet,
  subscribeBookCacheQueue,
  getBookCacheQueueVersion,
  pauseBookCacheJob,
  resumeBookCacheJob,
} from "@/lib/bookCacheQueue";

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
  showCache = false,
}: {
  book: Book;
  onOpen: (hash: string) => void;
  showCache?: boolean;
}) {
  const coverUrl = coverUrlOf(book);
  const bg = getHashColor(book.title);
  // 订阅队列以刷新角标
  useSyncExternalStore(subscribeBookCacheQueue, getBookCacheQueueVersion, () => 0);
  const job = showCache ? getBookCacheJob(book.bookHash) : undefined;
  const cached = showCache && getCachedBookHashSet().has(book.bookHash);

  return (
    <div
      className={cn(
        "group/cover flex flex-col text-left shrink-0",
        BOOK_COVER_WIDTH_CLASS,
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(book.bookHash)}
        className="active:scale-[0.98] transition-transform w-full text-left"
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

          {showCache && job?.status === "downloading" && (
            <div className="absolute bottom-0 inset-x-0 z-[3] bg-black/70 px-1.5 py-1">
              <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className={cn(
                    "h-full bg-accent-primary rounded-full",
                    job.progress < 0 && "w-1/3 animate-pulse",
                  )}
                  style={
                    job.progress >= 0
                      ? { width: `${Math.round(job.progress * 100)}%` }
                      : undefined
                  }
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[9px] text-white/90 tabular-nums">
                  {job.progress >= 0 ? `${Math.round(job.progress * 100)}%` : "…"}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="p-0.5 text-white/90"
                  onClick={(e) => {
                    e.stopPropagation();
                    pauseBookCacheJob(book.bookHash);
                  }}
                >
                  <Pause size={12} />
                </span>
              </div>
            </div>
          )}
          {showCache && job?.status === "paused" && (
            <span
              role="button"
              tabIndex={0}
              className="absolute bottom-1.5 right-1.5 z-[3] min-h-8 px-2 rounded-md bg-amber-500/90 text-white text-[10px] font-bold"
              onClick={(e) => {
                e.stopPropagation();
                resumeBookCacheJob(book.bookHash);
              }}
            >
              继续
            </span>
          )}
          {showCache && job?.status === "queued" && (
            <div className="absolute bottom-1.5 right-1.5 z-[3] min-h-8 px-2 rounded-md bg-black/70 text-white text-[10px] font-semibold flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              排队
            </div>
          )}
          {showCache && !job && cached && (
            <div className="absolute top-1.5 right-1.5 z-[3] w-7 h-7 rounded-full bg-accent-primary/90 text-white flex items-center justify-center shadow">
              <HardDrive size={12} />
            </div>
          )}
          {showCache && !job && !cached && (
            <span
              role="button"
              tabIndex={0}
              className="absolute bottom-1.5 right-1.5 z-[3] w-8 h-8 rounded-full bg-black/65 text-white flex items-center justify-center shadow"
              onClick={(e) => {
                e.stopPropagation();
                if (!book.attachmentId) return;
                enqueueBookCache({
                  bookHash: book.bookHash,
                  attachmentId: book.attachmentId,
                  title: book.title,
                  format: book.format,
                  size: book.size,
                });
              }}
            >
              <DownloadCloud size={14} />
            </span>
          )}
        </div>
      </button>
      <div className="mt-2 px-0.5">
        <div className="text-xs font-medium text-tx-primary line-clamp-2 leading-snug group-hover/cover:text-accent-primary transition-colors">
          {book.title}
        </div>
        {book.author ? (
          <div className="text-[10px] text-tx-tertiary truncate mt-0.5">{book.author}</div>
        ) : null}
      </div>
    </div>
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
  const isMobile = useMediaQuery("(max-width: 767px)");
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

  const goalDialog = (
    <BottomSheet
      open={goalDialogOpen}
      onClose={() => setGoalDialogOpen(false)}
      title="每日阅读目标"
      maxHeight="min(50dvh, 100%)"
      zClassName="z-[9999]"
      className="sm:max-w-xs sm:mx-auto"
    >
      <div className="px-5 pb-5">
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
            className="w-24 text-center text-2xl font-bold bg-app-bg border border-app-border rounded-xl py-2 text-tx-primary"
            autoFocus
          />
          <span className="text-sm text-tx-secondary">分钟 / 天</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setGoalDialogOpen(false)}
            className="flex-1 py-2.5 rounded-xl border border-app-border text-sm font-semibold text-tx-secondary min-h-[44px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void saveGoal()}
            disabled={savingGoal}
            className="flex-1 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold min-h-[44px] disabled:opacity-50"
          >
            {savingGoal ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );


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

        {/* 当前图书 / 最近读过：始终分行（桌面首页与书库「阅读中」一致，不再横排挤一行） */}
        <section className="space-y-6 md:space-y-8">
          <div>
            <h2 className="text-sm font-semibold text-tx-primary mb-3">当前图书</h2>
            {currentBook ? (
              <BookCoverCard book={currentBook} onOpen={onOpenBook} showCache={isMobile} />
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

          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-tx-primary mb-3">最近读过</h2>
            {recentBooks.length > 0 ? (
              <div
                className={cn(
                  // 独立成行后用换行铺开；窄屏仍可横向轻滑
                  "flex flex-wrap gap-3 sm:gap-4",
                  "max-md:flex-nowrap max-md:overflow-x-auto max-md:overflow-y-hidden max-md:pb-2 max-md:-mx-1 max-md:px-1",
                  "max-md:overscroll-x-contain max-md:scroll-smooth max-md:no-scrollbar",
                )}
              >
                {recentBooks.map((b) => (
                  <BookCoverCard key={b.bookHash} book={b} onOpen={onOpenBook} showCache={isMobile} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-tx-tertiary py-6 md:py-8">开始阅读更多书籍后会出现在这里</p>
            )}
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

          <div className="group/goal relative rounded-2xl border border-app-border bg-app-elevated/60 shadow-sm px-4 pt-5 pb-6 sm:px-8 sm:pt-8 sm:pb-10">
            {/* 设置目标：桌面默认隐藏，hover 卡片时显示；移动端触控始终可见 */}
            <button
              type="button"
              onClick={openGoalDialog}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "absolute top-3 right-3 z-20",
                "p-2.5 min-w-[44px] min-h-[44px] rounded-xl",
                "border border-app-border bg-app-surface text-tx-secondary",
                "hover:text-accent-primary hover:border-accent-primary/40",
                "active:scale-95 transition-transform duration-press ease-out shadow-sm",
                "flex items-center justify-center",
                "touch-manipulation",
                // 桌面：默认隐藏，鼠标进入卡片或焦点在按钮时显示
                "md:opacity-0 md:pointer-events-none",
                "md:group-hover/goal:opacity-100 md:group-hover/goal:pointer-events-auto",
                "md:focus-visible:opacity-100 md:focus-visible:pointer-events-auto",
                "max-md:opacity-100",
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
              {/* 文案下移，与半环弧顶留出间距，避免贴着进度条 */}
              <div className="absolute left-0 right-0 top-[32%] sm:top-[34%] flex flex-col items-center justify-center text-center pointer-events-none px-4">
                <div className="text-[11px] sm:text-xs font-medium text-tx-secondary mb-1">
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
                  "w-full max-w-sm px-6 py-3.5 rounded-full text-sm font-semibold transition-transform duration-press ease-out active:scale-[0.98]",
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
