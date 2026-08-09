/**
 * 我的任务 · 四象限视图（P1）
 * 桌面 2×2 + 未归类收纳；移动端分段；拖拽改象限；批量归类。
 */
import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  Check,
  Circle,
  GripVertical,
  Inbox,
  LayoutGrid,
  Play,
  Pause,
  CheckCircle2,
} from "lucide-react";
import type { ProjectTask } from "@/types";
import { cn } from "@/lib/utils";
import {
  QUADRANT_META,
  QUADRANT_ORDER,
  getQuadrantFromTask,
  quadrantToFlags,
  compareByQuadrant,
  type QuadrantId,
} from "@/lib/taskQuadrant";
import { BottomSheet } from "@/components/common/BottomSheet";
import { Button } from "@/components/ui/button";
import { Motion } from "@/components/common/Motion";
import { springs } from "@/lib/motion";

const MATRIX_GUIDE_KEY = "super-matrix-guide-seen";
const DRAG_MIME = "application/x-supernote-task-id";

export type MatrixBucket = QuadrantId | "uncategorized";

type Props = {
  tasks: ProjectTask[];
  loading?: boolean;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onStartTask?: (task: ProjectTask) => void;
  onPauseTask?: (task: ProjectTask) => void;
  onSetQuadrant: (
    taskIds: string[],
    target: MatrixBucket,
  ) => Promise<void> | void;
  onOpenTask: (taskId: string) => void;
};

function isOpenTask(t: ProjectTask): boolean {
  return t.isCompleted !== 1 && (t as { stageName?: string }).stageName !== "已完成";
}

export default function TaskMatrixView({
  tasks,
  loading,
  onToggleComplete,
  onStartTask,
  onPauseTask,
  onSetQuadrant,
  onOpenTask,
}: Props) {
  const openTasks = useMemo(
    () => tasks.filter(isOpenTask).sort(compareByQuadrant),
    [tasks],
  );

  const buckets = useMemo(() => {
    const map: Record<MatrixBucket, ProjectTask[]> = {
      q1: [],
      q2: [],
      q3: [],
      q4: [],
      uncategorized: [],
    };
    for (const t of openTasks) {
      const q = getQuadrantFromTask(t);
      if (q) map[q].push(t);
      else map.uncategorized.push(t);
    }
    return map;
  }, [openTasks]);

  const [mobileTab, setMobileTab] = useState<MatrixBucket>("q1");
  const [dragOver, setDragOver] = useState<MatrixBucket | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedUncat, setSelectedUncat] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(MATRIX_GUIDE_KEY)) setShowGuide(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismissGuide = () => {
    try {
      localStorage.setItem(MATRIX_GUIDE_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowGuide(false);
  };

  const handleDrop = useCallback(
    async (target: MatrixBucket, e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id =
        e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
      setDraggingId(null);
      if (!id) return;
      const task = openTasks.find((t) => t.id === id);
      if (!task) return;
      const cur = getQuadrantFromTask(task);
      const curBucket: MatrixBucket = cur ?? "uncategorized";
      if (curBucket === target) return;
      await onSetQuadrant([id], target);
    },
    [openTasks, onSetQuadrant],
  );

  const toggleSelectUncat = (id: string) => {
    setSelectedUncat((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllUncat = () => {
    setSelectedUncat(new Set(buckets.uncategorized.map((t) => t.id)));
  };

  const clearSelectUncat = () => setSelectedUncat(new Set());

  const batchMove = async (target: MatrixBucket) => {
    if (selectedUncat.size === 0) return;
    setBatchBusy(true);
    try {
      await onSetQuadrant([...selectedUncat], target);
      setSelectedUncat(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  const cellHeaderClass = (id: MatrixBucket) => {
    if (id === "uncategorized") return "text-tx-secondary";
    return QUADRANT_META[id].badgeClass.split(" ").find((c) => c.startsWith("text-")) || "";
  };

  const dropZoneClass = (id: MatrixBucket, active: boolean) =>
    cn(
      "rounded-xl border bg-app-elevated flex flex-col min-h-0 overflow-hidden shadow-xs transition-[border-color,box-shadow,background-color] duration-fast ease-out",
      active
        ? "border-accent-primary ring-2 ring-accent-primary/20 bg-accent-primary/5"
        : "border-app-border/50",
      id === "q1" && !active && "border-red-500/20",
      id === "q2" && !active && "border-emerald-500/20",
      id === "q3" && !active && "border-amber-500/20",
    );

  const renderCard = (task: ProjectTask, opts?: { selectable?: boolean }) => {
    const stageName = (task as { stageName?: string }).stageName;
    const canStart =
      stageName === "待启动" || stageName === "待规划" || task.status === "paused";
    const canPause =
      stageName !== "待启动" &&
      stageName !== "待规划" &&
      task.status !== "paused" &&
      task.isCompleted !== 1;
    const selected = selectedUncat.has(task.id);

    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, task.id);
          e.dataTransfer.setData("text/plain", task.id);
          e.dataTransfer.effectAllowed = "move";
          setDraggingId(task.id);
        }}
        onDragEnd={() => setDraggingId(null)}
        className={cn(
          "group flex items-start gap-2 p-2.5 rounded-lg border border-app-border/40 bg-app-sidebar/40 hover:bg-app-hover/40 cursor-grab active:cursor-grabbing transition-[transform,background-color,opacity,border-color] duration-fast ease-out",
          draggingId === task.id && "opacity-50",
          selected && "ring-1 ring-accent-primary/40 border-accent-primary/30",
        )}
      >
        {opts?.selectable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleSelectUncat(task.id);
            }}
            className={cn(
              "mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors duration-press ease-out",
              selected
                ? "bg-accent-primary border-accent-primary text-white"
                : "border-app-border bg-app-elevated",
            )}
            aria-label="选择"
          >
            {selected && <Check size={10} />}
          </button>
        ) : (
          <GripVertical
            size={14}
            className="text-tx-quaternary shrink-0 mt-0.5 opacity-50 group-hover:opacity-100"
          />
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task.id, task.isCompleted);
          }}
          className="text-tx-tertiary hover:text-accent-primary shrink-0 mt-0.5"
        >
          {task.isCompleted === 1 ? (
            <CheckCircle2 size={15} className="text-green-500" />
          ) : (
            <Circle size={15} />
          )}
        </button>

        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onOpenTask(task.id)}
        >
          <p className="text-[13px] font-semibold text-tx-secondary truncate leading-snug">
            {task.title}
          </p>
          {(task as { projectName?: string }).projectName && (
            <p className="text-[10px] text-tx-tertiary mt-0.5 truncate">
              {(task as { projectName?: string }).projectName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {canStart && onStartTask && (
            <button
              type="button"
              title={task.status === "paused" ? "恢复" : "启动"}
              onClick={(e) => {
                e.stopPropagation();
                onStartTask(task);
              }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-accent-primary hover:bg-accent-primary/10"
            >
              <Play size={11} fill="currentColor" />
            </button>
          )}
          {canPause && onPauseTask && (
            <button
              type="button"
              title="暂停"
              onClick={(e) => {
                e.stopPropagation();
                onPauseTask(task);
              }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-500 hover:bg-amber-500/10"
            >
              <Pause size={11} fill="currentColor" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderBucket = (
    id: MatrixBucket,
    opts?: { className?: string; selectable?: boolean },
  ) => {
    const list = buckets[id];
    const title =
      id === "uncategorized"
        ? "未归类"
        : `${QUADRANT_META[id].shortLabel}`;
    const sub =
      id === "uncategorized"
        ? "拖到上方象限，或勾选批量归类"
        : QUADRANT_META[id].label;

    return (
      <div
        className={cn(dropZoneClass(id, dragOver === id), opts?.className)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOver !== id) setDragOver(id);
        }}
        onDragLeave={() => {
          if (dragOver === id) setDragOver(null);
        }}
        onDrop={(e) => handleDrop(id, e)}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-app-border/30 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-bold", cellHeaderClass(id))}>
                {title}
              </span>
              <span className="text-[10px] font-mono font-bold text-tx-tertiary bg-app-hover/80 px-1.5 py-0.5 rounded-full">
                {list.length}
              </span>
            </div>
            <p className="text-[10px] text-tx-tertiary mt-0.5 truncate">{sub}</p>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
          {list.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-tx-quaternary">
              {id === "uncategorized" ? "没有未归类任务" : "拖入任务到这里"}
            </div>
          ) : (
            list.map((t) => renderCard(t, { selectable: opts?.selectable }))
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-tx-tertiary">加载任务…</div>
    );
  }

  if (openTasks.length === 0) {
    return (
      <div className="py-16 text-center space-y-2">
        <LayoutGrid className="mx-auto text-tx-quaternary" size={28} />
        <p className="text-sm font-semibold text-tx-secondary">暂无待办</p>
        <p className="text-xs text-tx-tertiary">
          创建任务后可在此用重要 × 紧急排一排
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* 移动端分段 */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {(
          [
            ...QUADRANT_ORDER.map((id) => ({
              id: id as MatrixBucket,
              label: QUADRANT_META[id].shortLabel,
            })),
            { id: "uncategorized" as const, label: "未归类" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
            className={cn(
              "px-3 py-2 rounded-button text-[11px] font-semibold border shrink-0 min-h-11 transition-[transform,background-color,color,border-color] duration-press ease-out active:scale-[0.97]",
              mobileTab === tab.id
                ? "bg-accent-primary/12 text-accent-primary border-accent-primary/30"
                : "bg-app-elevated text-tx-tertiary border-app-border/40",
            )}
            aria-pressed={mobileTab === tab.id}
          >
            {tab.label}
            <span className="ml-1 opacity-70 font-mono">
              {buckets[tab.id].length}
            </span>
          </button>
        ))}
      </div>

      <div className="md:hidden min-h-[50vh]">
        {renderBucket(mobileTab, {
          className: "min-h-[50vh]",
          selectable: mobileTab === "uncategorized",
        })}
        {mobileTab === "uncategorized" && buckets.uncategorized.length > 0 && selectedUncat.size === 0 && (
          <p className="text-center text-[11px] text-tx-tertiary py-2 px-1">
            点选任务后底部出现批量归类 · 或拖到桌面象限
          </p>
        )}
      </div>

      {/* 桌面 2×2 */}
      <div className="hidden md:grid grid-cols-2 gap-3 auto-rows-fr" style={{ minHeight: "420px" }}>
        {renderBucket("q1", { className: "min-h-[200px] max-h-[36vh]" })}
        {renderBucket("q2", { className: "min-h-[200px] max-h-[36vh]" })}
        {renderBucket("q3", { className: "min-h-[200px] max-h-[36vh]" })}
        {renderBucket("q4", { className: "min-h-[200px] max-h-[36vh]" })}
      </div>

      {/* 未归类收纳（桌面） */}
      <div className="hidden md:block space-y-2">
        {renderBucket("uncategorized", {
          className: "min-h-[120px] max-h-[28vh]",
          selectable: true,
        })}
      </div>

      {/* 批量操作条：避让移动底栏 + safe-area */}
      {selectedUncat.size > 0 && (
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.snappy}
          className="sticky z-10 mx-auto max-w-lg flex flex-wrap items-center justify-center gap-2 p-2.5 rounded-xl border border-app-border bg-app-elevated shadow-lg"
          style={{
            bottom: "max(12px, calc(var(--mobile-tab-h, 0px) + var(--safe-area-bottom, 0px) + 10px))",
          }}
        >
          <span className="text-[11px] font-semibold text-tx-secondary px-1">
            已选 {selectedUncat.size}
          </span>
          {QUADRANT_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              disabled={batchBusy}
              onClick={() => batchMove(id)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border min-h-9 active:scale-[0.97] transition-transform duration-press ease-out disabled:opacity-50",
                QUADRANT_META[id].badgeClass,
              )}
            >
              → {QUADRANT_META[id].shortLabel}
            </button>
          ))}
          <button
            type="button"
            onClick={selectAllUncat}
            className="text-[11px] text-tx-tertiary hover:text-tx-secondary px-2 min-h-9"
          >
            全选未归类
          </button>
          <button
            type="button"
            onClick={clearSelectUncat}
            className="text-[11px] text-tx-tertiary hover:text-tx-secondary px-2 min-h-9"
          >
            取消
          </button>
        </Motion.div>
      )}

      {buckets.uncategorized.length > 0 && selectedUncat.size === 0 && (
        <p className="text-center text-[11px] text-tx-tertiary flex items-center justify-center gap-1.5">
          <Inbox size={12} />
          {buckets.uncategorized.length} 条未归类 · 拖入象限或勾选批量整理
        </p>
      )}

      {/* 首次引导 */}
      <BottomSheet open={showGuide} onClose={dismissGuide} title="矩阵整理怎么用">
        <div className="px-4 pb-6 space-y-3 text-sm text-tx-secondary">
          <p className="text-tx-primary font-semibold">重要看价值，紧急看时间</p>
          <p className="text-[11px] text-tx-tertiary leading-snug">
            与列表里的「今日关注」（截止/提醒）不同：这里是你对任务价值与时间压力的主观归类。
          </p>
          <ul className="space-y-2 text-xs leading-relaxed">
            <li>
              <span className="font-bold text-red-500">马上做</span>
              ：重要且紧急，立刻处理
            </li>
            <li>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">计划做</span>
              ：重要不紧急，最值得保护的时间
            </li>
            <li>
              <span className="font-bold text-amber-600 dark:text-amber-400">能转就转</span>
              ：紧急但不重要，压缩或转交家人
            </li>
            <li>
              <span className="font-bold text-tx-tertiary">少做</span>
              ：不紧急不重要，延后或删掉
            </li>
          </ul>
          <p className="text-[11px] text-tx-tertiary">
            桌面可拖拽卡片到象限；未归类可勾选后批量归类。创建时不强制打标。
          </p>
          <Button type="button" className="w-full mt-2" onClick={dismissGuide}>
            知道了
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

/** 供外部批量更新时复用：bucket → flags */
export function matrixBucketToFlags(bucket: MatrixBucket) {
  if (bucket === "uncategorized") return quadrantToFlags(null);
  return quadrantToFlags(bucket);
}
