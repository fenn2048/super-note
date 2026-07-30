/**
 * 桌面书库「阅读中」仪表盘：当前图书 / 最近读过 / 每日阅读目标
 * 样式走 app token，布局参考产品截图功能，不抄扁平黑白皮。
 */
import React, { useEffect, useMemo, useState } from "react";
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

function BookCoverCard({
  book,
  onOpen,
  size = "md",
}: {
  book: Book;
  onOpen: (hash: string) => void;
  size?: "md" | "lg";
}) {
  const coverUrl = coverUrlOf(book);
  const bg = getHashColor(book.title);
  const w = size === "lg" ? "w-36 sm:w-40" : "w-28 sm:w-32";

  return (
    <button
      type="button"
      onClick={() => onOpen(book.bookHash)}
      className={cn(
        "group/cover flex flex-col text-left shrink-0 active:scale-[0.98] transition-transform",
        w,
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

/** SVG 半环进度 */
function SemiRing({ ratio, className }: { ratio: number; className?: string }) {
  const r = 92;
  const cx = 110;
  const cy = 108;
  // 半圆路径：从左到右（180° → 0°）
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
      className={cn("w-full max-w-[280px] mx-auto", className)}
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
}

export default function ReadingDashboard({
  books,
  onOpenBook,
}: ReadingDashboardProps) {
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

  // 拉取偏好中的目标；监听 storage / 自定义事件刷新今日分钟
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

  const remaining = remainingGoalMinutes(todayMinutes, goalMinutes);
  const ratio = goalProgressRatio(todayMinutes, goalMinutes);
  const clock = formatReadingClock(todayMinutes);

  const openGoalDialog = () => {
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

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-[calc(1.5rem+var(--safe-area-bottom,0px))]">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* 标题 */}
        <header>
          <h1 className="text-2xl font-bold text-tx-primary tracking-tight">阅读中</h1>
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

        {/* 当前 / 最近 */}
        <section className="space-y-4">
          <div className="flex items-start gap-8 overflow-x-auto pb-1">
            <div className="shrink-0">
              <h2 className="text-sm font-semibold text-tx-primary mb-3">当前图书</h2>
              {currentBook ? (
                <BookCoverCard book={currentBook} onOpen={onOpenBook} size="lg" />
              ) : (
                <div className="w-40 aspect-[3/4] rounded-lg border border-dashed border-app-border bg-app-surface/40 flex flex-col items-center justify-center text-tx-tertiary text-xs gap-2 px-3 text-center">
                  <BookOpen size={22} className="opacity-50" />
                  暂无在读
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-tx-primary mb-3">最近读过</h2>
              {recentBooks.length > 0 ? (
                <div className="flex gap-4 overflow-x-auto pb-1">
                  {recentBooks.map((b) => (
                    <BookCoverCard key={b.bookHash} book={b} onOpen={onOpenBook} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-tx-tertiary py-8">开始阅读更多书籍后会出现在这里</p>
              )}
            </div>
          </div>
        </section>

        {/* 阅读目标 */}
        <section className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold text-tx-primary">阅读目标</h2>
            <p className="text-xs text-tx-tertiary mt-1">
              坚持每天阅读，提升你的数据，以激励你读完更多图书。
            </p>
          </div>

          <div className="group/goal relative rounded-2xl border border-app-border bg-app-elevated/60 shadow-sm px-4 py-8 md:px-8 md:py-10">
            {/* hover 设置按钮 — 对应参考图右上角 */}
            <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover/goal:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={openGoalDialog}
                className="p-2 rounded-lg border border-app-border bg-app-surface text-tx-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors shadow-sm"
                title="设置每日阅读目标"
                aria-label="设置每日阅读目标"
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>

            <div className="relative flex flex-col items-center">
              <SemiRing ratio={ratio} />
              <div className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                <div className="text-xs font-medium text-tx-secondary mb-0.5">今日阅读进度</div>
                <div className="text-4xl md:text-5xl font-bold text-tx-primary tabular-nums tracking-tight">
                  {clock}
                </div>
                <div className="text-xs text-tx-tertiary mt-1">（目标 {goalMinutes} 分钟）</div>
              </div>

              <button
                type="button"
                disabled={!currentBook}
                onClick={() => currentBook && onOpenBook(currentBook.bookHash)}
                className={cn(
                  "mt-2 max-w-md w-full sm:w-auto min-w-[220px] px-6 py-3 rounded-full text-sm font-semibold transition-all",
                  "bg-tx-primary text-app-bg hover:opacity-90 shadow-md",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
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

      {/* 每日目标弹窗 */}
      {goalDialogOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
          onClick={() => setGoalDialogOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            aria-labelledby="daily-reading-goal-title"
            className="w-full max-w-xs rounded-2xl border border-app-border bg-app-elevated shadow-xl p-5"
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
                className="p-1 rounded-md text-tx-tertiary hover:bg-app-hover -mr-1"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center justify-center gap-2 mb-5">
              <input
                type="number"
                min={MIN_DAILY_READING_GOAL}
                max={MAX_DAILY_READING_GOAL}
                step={5}
                value={draftGoal}
                onChange={(e) => setDraftGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveGoal();
                }}
                className="w-24 h-10 px-2 text-center text-base font-semibold rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 tabular-nums"
                autoFocus
              />
              <span className="text-sm text-tx-secondary">分钟/天</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setGoalDialogOpen(false)}
                className="px-4 py-1.5 rounded-full text-sm font-medium border border-app-border bg-app-surface text-tx-primary hover:bg-app-hover transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingGoal}
                onClick={() => void saveGoal()}
                className="px-5 py-1.5 rounded-full text-sm font-semibold bg-tx-primary text-app-bg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                好
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
