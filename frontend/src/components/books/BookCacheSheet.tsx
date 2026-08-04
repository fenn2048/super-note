/**
 * BookCacheSheet — 移动端书库本地缓存管理（进度 + 暂停/继续）
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BottomSheet } from "@/components/common/BottomSheet";
import {
  BookOpen,
  Trash2,
  Check,
  HardDrive,
  Loader2,
  Pause,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookFileMeta } from "@/lib/localStore";
import {
  getBookCacheJobs,
  getBookCacheQueueVersion,
  subscribeBookCacheQueue,
  listBookCacheMeta,
  getBookCacheStats,
  removeLocalBookCaches,
  clearLocalBookCache,
  cancelBookCacheJob,
  pauseBookCacheJob,
  resumeBookCacheJob,
  pauseAllBookCache,
  resumeAllBookCache,
  isBookCacheQueuePaused,
  refreshCachedBookHashSet,
  formatBytes,
  type BookCacheJob,
} from "@/lib/bookCacheQueue";

function useQueueJobs(): BookCacheJob[] {
  useSyncExternalStore(subscribeBookCacheQueue, getBookCacheQueueVersion, () => 0);
  return getBookCacheJobs();
}

function progressLabel(job: BookCacheJob): string {
  if (job.status === "queued") return "排队中";
  if (job.status === "paused") {
    if (job.progress > 0 && job.progress <= 1) {
      return `已暂停 ${Math.round(job.progress * 100)}%`;
    }
    return "已暂停";
  }
  if (job.progress < 0) {
    if (job.receivedBytes && job.receivedBytes > 0) {
      return `下载中 ${formatBytes(job.receivedBytes)}`;
    }
    return "下载中…";
  }
  const pct = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  if (job.receivedBytes != null && job.totalBytes != null && job.totalBytes > 0) {
    return `${pct}% · ${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)}`;
  }
  return `${pct}%`;
}

export type BookCacheSheetProps = {
  open: boolean;
  onClose: () => void;
};

export default function BookCacheSheet({ open, onClose }: BookCacheSheetProps) {
  const [items, setItems] = useState<BookFileMeta[]>([]);
  const [stats, setStats] = useState({ count: 0, totalBytes: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const jobs = useQueueJobs();
  const globallyPaused = isBookCacheQueuePaused();

  const activeJobs = jobs.filter(
    (j) =>
      j.status === "queued" ||
      j.status === "downloading" ||
      j.status === "paused",
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await refreshCachedBookHashSet();
      const [list, st] = await Promise.all([listBookCacheMeta(), getBookCacheStats()]);
      setItems(list);
      setStats(st);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    void reload();
    return subscribeBookCacheQueue(() => {
      // 任务完成时刷新已缓存列表
      void reload();
    });
  }, [open, reload]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.bookHash)));
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确认删除选中的 ${selected.size} 本本地缓存？`)) return;
    setBusy(true);
    try {
      await removeLocalBookCaches(Array.from(selected));
      setSelected(new Set());
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (stats.count === 0) return;
    if (!window.confirm(`确认清空全部本地书籍缓存（${formatBytes(stats.totalBytes)}）？`)) {
      return;
    }
    setBusy(true);
    try {
      await clearLocalBookCache();
      setSelected(new Set());
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="书籍缓存"
      maxHeight="min(88dvh, 100%)"
      className="h-[min(72dvh,100%)]"
      bodyClassName="px-0 pb-0 flex flex-col min-h-0 overflow-hidden"
      zClassName="z-[80]"
      headerRight={
        <button
          type="button"
          data-no-drag
          onClick={() => void handleClearAll()}
          disabled={busy || stats.count === 0}
          className={cn(
            "min-h-11 px-3 text-xs font-semibold rounded-button",
            stats.count > 0
              ? "text-accent-danger"
              : "text-tx-tertiary cursor-not-allowed",
          )}
        >
          清空
        </button>
      }
    >
      <div className="flex flex-col flex-1 min-h-0 h-full">
        <div className="px-4 pb-3 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0">
            <HardDrive size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-tx-primary">
              已缓存 {stats.count} 本
            </p>
            <p className="text-xs text-tx-tertiary">
              占用 {formatBytes(stats.totalBytes)}
            </p>
          </div>
          {activeJobs.length > 0 && (
            <button
              type="button"
              data-no-drag
              onClick={() =>
                globallyPaused || activeJobs.every((j) => j.status === "paused")
                  ? resumeAllBookCache()
                  : pauseAllBookCache()
              }
              className="min-h-11 px-3 rounded-xl border border-app-border text-xs font-semibold text-tx-secondary flex items-center gap-1.5"
            >
              {globallyPaused || activeJobs.every((j) => j.status === "paused") ? (
                <>
                  <Play size={14} /> 全部继续
                </>
              ) : (
                <>
                  <Pause size={14} /> 全部暂停
                </>
              )}
            </button>
          )}
        </div>

        {activeJobs.length > 0 && (
          <div className="px-4 pb-3 space-y-2 border-b border-app-border/60 shrink-0 max-h-[40%] overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
              缓存任务 · {activeJobs.length}
            </p>
            {activeJobs.map((job) => (
              <div
                key={job.bookHash}
                className="flex items-center gap-2 min-h-11 rounded-xl bg-app-sidebar/40 border border-app-border/50 px-3 py-2"
              >
                {job.status === "downloading" ? (
                  <Loader2 size={16} className="text-accent-primary animate-spin shrink-0" />
                ) : job.status === "paused" ? (
                  <Pause size={16} className="text-amber-500 shrink-0" />
                ) : (
                  <BookOpen size={16} className="text-tx-tertiary shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-tx-primary truncate">{job.title}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-app-hover overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-fast ease-out",
                        job.status === "paused" ? "bg-amber-500" : "bg-accent-primary",
                        job.progress < 0 && job.status === "downloading" && "animate-pulse",
                      )}
                      style={{
                        width:
                          job.progress < 0
                            ? "35%"
                            : `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-tx-tertiary mt-0.5 tabular-nums">
                    {progressLabel(job)}
                  </p>
                </div>
                {job.status === "paused" ? (
                  <button
                    type="button"
                    className="min-h-11 min-w-11 text-accent-primary"
                    onClick={() => resumeBookCacheJob(job.bookHash)}
                    aria-label="继续"
                  >
                    <Play size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 min-w-11 text-tx-secondary"
                    onClick={() => pauseBookCacheJob(job.bookHash)}
                    aria-label="暂停"
                  >
                    <Pause size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-11 min-w-11 text-tx-tertiary"
                  onClick={() => cancelBookCacheJob(job.bookHash)}
                  aria-label="取消"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-tx-tertiary text-sm gap-2">
              <Loader2 size={16} className="animate-spin" />
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-tx-tertiary">
              暂无本地书籍缓存
              <p className="mt-1 text-xs">在书架长按或点缓存后可离线阅读</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const checked = selected.has(item.bookHash);
                return (
                  <li key={item.bookHash}>
                    <button
                      type="button"
                      onClick={() => toggle(item.bookHash)}
                      className={cn(
                        "w-full flex items-center gap-3 min-h-12 px-3 py-2.5 rounded-xl border text-left",
                        "active:bg-app-hover transition-colors duration-fast ease-out",
                        checked
                          ? "border-accent-primary/40 bg-accent-primary/5"
                          : "border-app-border/50 bg-app-sidebar/20",
                      )}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded-md border flex items-center justify-center shrink-0",
                          checked
                            ? "bg-accent-primary border-accent-primary text-white"
                            : "border-app-border",
                        )}
                      >
                        {checked && <Check size={12} />}
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0">
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-tx-primary truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-tx-tertiary">
                          {formatBytes(item.size)}
                          {item.format ? ` · ${item.format.toUpperCase()}` : ""}
                          {" · "}
                          {new Date(item.cachedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div
            className={cn(
              "shrink-0 border-t border-app-border",
              "bg-app-elevated/95 backdrop-blur-md",
              "px-4 py-3 flex items-center gap-2",
            )}
          >
            <button
              type="button"
              onClick={selectAll}
              className="min-h-11 px-3 rounded-xl border border-app-border text-xs font-semibold text-tx-secondary"
            >
              {selected.size === items.length ? "取消全选" : "全选"}
            </button>
            <div className="flex-1 text-xs text-tx-tertiary text-center">
              已选 {selected.size}
            </div>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void handleDeleteSelected()}
              className={cn(
                "min-h-11 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5",
                selected.size > 0
                  ? "bg-accent-danger text-white"
                  : "bg-app-sidebar border border-app-border text-tx-tertiary cursor-not-allowed",
              )}
            >
              <Trash2 size={14} />
              删除缓存
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
