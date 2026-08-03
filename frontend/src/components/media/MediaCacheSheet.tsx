/**
 * MediaCacheSheet — 移动端媒体本地缓存管理
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BottomSheet } from "@/components/common/BottomSheet";
import { Film, Music, Trash2, Check, HardDrive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listMediaCacheMeta,
  getMediaCacheStats,
  formatBytes,
  subscribeMediaCache,
  type MediaCacheMeta,
} from "@/lib/mediaFileCache";
import {
  getMediaCacheJobs,
  getMediaCacheQueueVersion,
  subscribeMediaCacheQueue,
  removeLocalMediaCaches,
  clearLocalMediaCache,
  cancelMediaCacheJob,
  type MediaCacheJob,
} from "@/lib/mediaCacheQueue";

function useQueueJobs(): MediaCacheJob[] {
  useSyncExternalStore(subscribeMediaCacheQueue, getMediaCacheQueueVersion, () => 0);
  return getMediaCacheJobs();
}

export type MediaCacheSheetProps = {
  open: boolean;
  onClose: () => void;
  /** 过滤：仅视频 / 仅音频 / 全部 */
  filterType?: "video" | "audio" | "all";
};

export default function MediaCacheSheet({
  open,
  onClose,
  filterType = "all",
}: MediaCacheSheetProps) {
  const [items, setItems] = useState<MediaCacheMeta[]>([]);
  const [stats, setStats] = useState({ count: 0, totalBytes: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const jobs = useQueueJobs();

  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "downloading",
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const type = filterType === "all" ? undefined : filterType;
      const [list, st] = await Promise.all([
        listMediaCacheMeta(type ? { type } : undefined),
        getMediaCacheStats(),
      ]);
      setItems(list);
      setStats(st);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    void reload();
    return subscribeMediaCache(() => {
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
    else setSelected(new Set(items.map((i) => i.mediaId)));
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确认删除选中的 ${selected.size} 项本地缓存？`)) return;
    setBusy(true);
    try {
      await removeLocalMediaCaches(Array.from(selected));
      setSelected(new Set());
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (stats.count === 0) return;
    if (!window.confirm(`确认清空全部本地媒体缓存（${formatBytes(stats.totalBytes)}）？`)) {
      return;
    }
    setBusy(true);
    try {
      await clearLocalMediaCache();
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
      title="缓存管理"
      // 必须给面板明确高度：仅 maxHeight 时 flex-1/min-h-0 子项会塌成 0，
      // 只剩标题条贴在底部（用户看到「一片黑 + 底栏一条」）。
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
        {/* Stats */}
        <div className="px-4 pb-3 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0">
            <HardDrive size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-tx-primary">
              已缓存 {stats.count} 项
            </p>
            <p className="text-xs text-tx-tertiary">
              占用 {formatBytes(stats.totalBytes)}
            </p>
          </div>
        </div>

        {/* Active downloads */}
        {activeJobs.length > 0 && (
          <div className="px-4 pb-3 space-y-2 border-b border-app-border/60 shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
              正在缓存
            </p>
            {activeJobs.map((job) => (
              <div
                key={job.mediaId}
                className="flex items-center gap-3 min-h-11 rounded-xl bg-app-sidebar/40 border border-app-border/50 px-3 py-2"
              >
                <Loader2 size={16} className="text-accent-primary animate-spin shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-tx-primary truncate">{job.title}</p>
                  <div className="mt-1 h-1 rounded-full bg-app-hover overflow-hidden">
                    <div
                      className="h-full bg-accent-primary rounded-full transition-[width] duration-fast ease-out"
                      style={{
                        width:
                          job.progress < 0
                            ? "30%"
                            : `${Math.round(job.progress * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="min-h-11 min-w-11 text-xs font-semibold text-tx-secondary"
                  onClick={() => cancelMediaCacheJob(job.mediaId)}
                >
                  取消
                </button>
              </div>
            ))}
          </div>
        )}

        {/* List：占满中间可滚动区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-tx-tertiary text-sm gap-2">
              <Loader2 size={16} className="animate-spin" />
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-tx-tertiary">
              暂无本地缓存
              <p className="mt-1 text-xs">在列表中选择文件缓存后可离线播放</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const checked = selected.has(item.mediaId);
                return (
                  <li key={item.mediaId}>
                    <button
                      type="button"
                      onClick={() => toggle(item.mediaId)}
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
                      <div
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          item.type === "audio"
                            ? "bg-accent-primary/10 text-accent-primary"
                            : "bg-app-hover text-tx-secondary",
                        )}
                      >
                        {item.type === "audio" ? (
                          <Music size={16} />
                        ) : (
                          <Film size={16} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-tx-primary truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-tx-tertiary">
                          {formatBytes(item.size)}
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

        {/* Bottom bar：固定在 sheet 底部，不进列表滚动 */}
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
