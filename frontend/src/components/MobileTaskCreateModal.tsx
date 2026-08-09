import React, { useState, useEffect, useRef } from "react";
import { X, Folder, User, Loader2, ChevronDown, Check, ScanText } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Motion } from "@/components/common/Motion";
import { springs } from "@/lib/motion";
import { BottomSheet } from "@/components/common/BottomSheet";
import { api, getCurrentWorkspace } from "@/lib/api";
import { Project } from "@/types";
import { toast } from "@/lib/toast";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import ReminderOffsetPicker from "@/components/common/ReminderOffsetPicker";
import RecurrenceConfigurator, { RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import OCRModal from "@/components/OCRModal";
import { useModalFocusTrap } from "@/hooks/useModalFocusTrap";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { syncTaskNotification } from "@/hooks/useCapacitor";
import { resolveCompletedStageId, resolveNotStartedStageId } from "@/lib/taskEntry";
import QuadrantPicker from "@/components/QuadrantPicker";
import TaskCategoryPicker from "@/components/TaskCategoryPicker";

interface MobileTaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export default function MobileTaskCreateModal({
  isOpen,
  onClose,
  onCreated
}: MobileTaskCreateModalProps) {
  const [title, setTitle] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [isImportant, setIsImportant] = useState<number | null>(null);
  const [isUrgent, setIsUrgent] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isBackfilled, setIsBackfilled] = useState(false);
  const [completedAt, setCompletedAt] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>({ type: "weekday" });
  const [remindAt, setRemindAt] = useState("");
  const [reminderOffsetValue, setReminderOffsetValue] = useState<number>(1);
  const [reminderOffsetUnit, setReminderOffsetUnit] = useState<'minute'|'hour'|'day'|'month'|'year'>('day');
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isProjectDrawerOpen, setIsProjectDrawerOpen] = useState(false);
  const [isAssigneeDrawerOpen, setIsAssigneeDrawerOpen] = useState(false);

  const workspaceId = getCurrentWorkspace();

  // Load projects and current user
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const me = await api.getMe();
        setCurrentUserId(me.id);
        setAssigneeId(me.id); // default to myself

        // Get projects for current workspace
        const activeProjects = await api.getProjects(workspaceId, "active");
        setProjects(activeProjects);

        // Auto-select "个人TODO" or first project
        const personalTodo = activeProjects.find(p => p.name === "个人TODO");
        if (personalTodo) {
          setSelectedProjectId(personalTodo.id);
        } else if (activeProjects.length > 0) {
          setSelectedProjectId(activeProjects[0].id);
        }

        // Fetch workspace members if in a team workspace
        if (workspaceId && workspaceId !== "personal") {
          const wsMembers = await api.getWorkspaceMembers(workspaceId);
          setMembers(wsMembers);
        } else {
          setMembers([]);
        }
      } catch (err) {
        console.error("Failed to load task creation data:", err);
        toast.error("加载初始数据失败");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, workspaceId]);

  // Automatically calculate default reminder date (1 day before due date)
  const handleDueDateChange = (dateVal: string) => {
    setDueDate(dateVal);
    if (dateVal) {
      try {
        const hasTime = dateVal.includes(" ");
        const datePart = hasTime ? dateVal.split(" ")[0] : dateVal;
        const timePart = hasTime ? dateVal.split(" ")[1] : "";
        const [year, month, day] = datePart.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        date.setDate(date.getDate() - 1);
        if (hasTime) {
          setRemindAt(`${format(date, "yyyy-MM-dd")} ${timePart}`);
        } else {
          setRemindAt(format(date, "yyyy-MM-dd"));
        }
      } catch {
        setRemindAt("");
      }
    } else {
      setRemindAt("");
    }
  };

  const handleFinish = async () => {
    if (!title.trim()) {
      toast.error("请输入任务标题");
      return;
    }
    if (!selectedProjectId) {
      toast.error("请选择所属项目");
      return;
    }
    if (isBackfilled && !completedAt.trim()) {
      toast.error("补录请填写实际完成日");
      return;
    }

    setSubmitting(true);
    try {
      const stageId = isBackfilled
        ? await resolveCompletedStageId(selectedProjectId)
        : await resolveNotStartedStageId(selectedProjectId);

      const due = dueDate || (isBackfilled ? completedAt : "");
      const payload = {
        stageId,
        title: title.trim(),
        description: description.trim(),
        assigneeId: assigneeId || null,
        endDate: due
          ? new Date(due.includes("T") || due.includes(" ") ? due : `${due}T23:59:59`).toISOString()
          : null,
        priority: 2,
        status: (isBackfilled ? "completed" : "pending") as "completed" | "pending",
        isCompleted: isBackfilled ? 1 : 0,
        isBackfilled: isBackfilled ? 1 : 0,
        completedAt: isBackfilled ? completedAt : null,
        progress: isBackfilled ? 100 : 0,
        remindAt: isBackfilled ? null : remindAt || null,
        reminderOffsetValue,
        reminderOffsetUnit,
        isRecurring: isBackfilled ? 0 : isRecurring ? 1 : 0,
        recurrenceRule: !isBackfilled && isRecurring ? JSON.stringify(recurrenceRule) : null,
        isImportant,
        isUrgent,
        categoryId,
      };

      const newTask = await api.createProjectTask(selectedProjectId, payload);
      toast.success(isBackfilled ? "补录完成" : "新建待办成功");

      if (newTask?.remindAt) {
        void syncTaskNotification(newTask as any);
      }

      setTitle("");
      setDescription("");
      setDueDate("");
      setRemindAt("");
      setIsImportant(null);
      setIsUrgent(null);
      setCategoryId(null);
      setIsBackfilled(false);
      setCompletedAt("");
      setIsRecurring(false);
      setRecurrenceRule({ type: "weekday" });

      window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
      window.dispatchEvent(new CustomEvent("super:workspace-changed"));
      window.dispatchEvent(new CustomEvent("super:project-search-changed", { detail: { query: "" } }));

      if (onCreated) onCreated();
      onClose();
    } catch (err: any) {
      console.error("Failed to create project task:", err);
      toast.error(err?.message || "创建待办失败");
    } finally {
      setSubmitting(false);
    }
  };

  const { visible: kbVisible } = useKeyboardVisible();
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** 入场动画结束后再聚焦，避免键盘高度与 spring 同时抢布局导致抖动 */
  const [enterDone, setEnterDone] = useState(false);

  // 桌面居中大弹窗；移动底部 sheet（原 md:hidden 导致 Web 端点「+」任务无界面）
  const isDesktop =
    typeof window !== "undefined" && window.innerWidth >= 768;
  const trapRef = useModalFocusTrap(isOpen && isDesktop, onClose);

  useEffect(() => {
    if (!isOpen) {
      setEnterDone(false);
      return;
    }
    // 桌面可立即聚焦；移动端等 enterDone
    if (isDesktop) {
      const t = window.setTimeout(() => {
        titleInputRef.current?.focus({ preventScroll: true });
      }, 80);
      return () => window.clearTimeout(t);
    }
  }, [isOpen, isDesktop]);

  useEffect(() => {
    if (!isOpen || isDesktop || !enterDone) return;
    const t = window.setTimeout(() => {
      titleInputRef.current?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(t);
  }, [isOpen, isDesktop, enterDone]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex justify-center select-text p-0 md:p-6",
            isDesktop ? "items-center" : "items-end",
          )}
          /* 移动端：遮罩底边抬到键盘上方。勿对 bottom 做 CSS transition——
             会与 sheet 入场动画叠在一起产生「闪几下」的抖动。 */
          style={
            !isDesktop
              ? {
                  bottom: "var(--keyboard-height, 0px)",
                }
              : undefined
          }
        >
          {/* Backdrop */}
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Panel */}
          <Motion.div
            initial={
              isDesktop
                ? { opacity: 0, scale: 0.96, y: 12 }
                : { y: "100%" }
            }
            animate={
              isDesktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }
            }
            exit={
              isDesktop
                ? { opacity: 0, scale: 0.98, y: 8 }
                : { y: "100%" }
            }
            transition={isDesktop ? springs.modal : springs.sheet}
            onAnimationComplete={() => {
              if (isOpen && !isDesktop) setEnterDone(true);
            }}
            onClick={(e) => e.stopPropagation()}
            ref={trapRef as React.RefObject<HTMLDivElement>}
            className={cn(
              "relative bg-app-elevated flex flex-col overflow-hidden shadow-2xl text-tx-primary z-10",
              isDesktop
                ? "w-full max-w-lg max-h-[min(88vh,720px)] rounded-2xl border border-app-border"
                : "w-full rounded-t-3xl border-t border-app-border",
            )}
            style={
              isDesktop
                ? undefined
                : {
                    // 吃满遮罩高度（遮罩 bottom 已贴键盘），顶到状态栏下，
                    // 避免键盘弹起时上方露出背后「新任务」顶栏。
                    height: "100%",
                    maxHeight: "100%",
                    paddingBottom: kbVisible
                      ? 12
                      : "calc(var(--safe-area-bottom) + 16px)",
                  }
            }
            role="dialog"
            aria-modal="true"
            aria-label="新建任务"
          >
            {/* Top Pull Handle — 仅移动 */}
            {!isDesktop && (
              <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />
            )}

            {/* Header */}
            <div
              className={cn(
                "px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0",
                isDesktop && "pt-4 rounded-t-2xl",
              )}
            >
              <span className="w-6" />
              <h3 className="text-base font-bold text-tx-primary">新建任务</h3>
              <button
                onClick={onClose}
                className="p-1 hover:bg-app-hover rounded-full text-tx-tertiary hover:text-tx-primary transition-colors active:scale-95"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content：min-h-0 保证 flex 子项可滚；minHeight 防键盘压扁 */}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4"
              style={{
                WebkitOverflowScrolling: "touch",
                minHeight: "min(40vh, 280px)",
              }}
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <Loader2 size={24} className="animate-spin text-accent-primary" />
                  <span className="text-xs text-tx-tertiary">正在加载...</span>
                </div>
              ) : (
                <>
                  {/* Task Title Input — 聚焦由 enterDone 延迟触发，勿 autoFocus */}
                  <div className="border border-app-border focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/20 rounded-xl px-3 py-1 bg-app-surface transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out">
                    <input
                      ref={titleInputRef}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="输入任务标题..."
                      className="w-full bg-transparent border-none outline-none py-1.5 text-sm font-medium focus:ring-0 placeholder:text-tx-tertiary"
                      enterKeyHint="done"
                    />
                  </div>

                  {/* Project Selector Row */}
                  <div className="flex items-center justify-between py-1 border-b border-app-border/40">
                    <div className="flex items-center gap-2 text-tx-secondary">
                      <Folder size={16} />
                      <span className="text-xs font-semibold">所属项目</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsProjectDrawerOpen(true)}
                      className="flex items-center gap-1 bg-transparent border-none text-xs font-semibold text-tx-primary outline-none py-1.5 focus:ring-0 cursor-pointer text-right max-w-[200px] active:opacity-70"
                    >
                      <span className="truncate">
                        {projects.find((p) => p.id === selectedProjectId)?.name || "选择项目"}
                      </span>
                      <ChevronDown size={14} className="text-tx-tertiary shrink-0" />
                    </button>
                  </div>

                  {/* Assignee Selector Row */}
                  <div className="flex items-center justify-between py-1 border-b border-app-border/40">
                    <div className="flex items-center gap-2 text-tx-secondary">
                      <User size={16} />
                      <span className="text-xs font-semibold">指派给</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsAssigneeDrawerOpen(true)}
                      className="flex items-center gap-1 bg-transparent border-none text-xs font-semibold text-tx-primary outline-none py-1.5 focus:ring-0 cursor-pointer text-right max-w-[200px] active:opacity-70"
                    >
                      <span className="truncate">
                        {assigneeId === currentUserId
                          ? "我自己"
                          : members.find((m) => m.userId === assigneeId)?.displayName ||
                            members.find((m) => m.userId === assigneeId)?.username ||
                            "未分配"}
                      </span>
                      <ChevronDown size={14} className="text-tx-tertiary shrink-0" />
                    </button>
                  </div>

                  {/* 四象限（主决策维度） */}
                  <div className="py-2 border-b border-app-border/40 space-y-1.5">
                    <span className="text-xs font-semibold text-tx-secondary">四象限（可选）</span>
                    <QuadrantPicker
                      isImportant={isImportant}
                      isUrgent={isUrgent}
                      onChange={({ isImportant: imp, isUrgent: urg }) => {
                        setIsImportant(imp);
                        setIsUrgent(urg);
                      }}
                    />
                  </div>

                  {/* 事务分类 */}
                  <div className="py-2 border-b border-app-border/40 space-y-1.5">
                    <span className="text-xs font-semibold text-tx-secondary">
                      事务分类 <span className="font-normal text-tx-tertiary">（可选）</span>
                    </span>
                    <TaskCategoryPicker
                      value={categoryId}
                      onChange={setCategoryId}
                      className="w-full"
                    />
                  </div>

                  {/* Due Date & Reminder Date Columns */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-tx-secondary block">截止日期</label>
                      <SleekDatePicker
                        value={dueDate}
                        onChange={handleDueDateChange}
                        placeholder="添加截止日期"
                        className="w-full"
                        variant="mobile-form"
                        showTime={true}
                      />
                    </div>
                    {(dueDate || isRecurring) && !isBackfilled && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-tx-secondary block">提醒设置</label>
                        <ReminderOffsetPicker
                          value={reminderOffsetValue}
                          unit={reminderOffsetUnit}
                          onChangeValue={setReminderOffsetValue}
                          onChangeUnit={setReminderOffsetUnit}
                        />
                      </div>
                    )}
                  </div>

                  {/* 事后补录 */}
                  <div className="rounded-xl border border-app-border/50 bg-app-sidebar/30 p-3 space-y-2.5">
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isBackfilled}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setIsBackfilled(on);
                          if (on) {
                            setCompletedAt(
                              completedAt ||
                                (dueDate ? dueDate.slice(0, 10) : format(new Date(), "yyyy-MM-dd")),
                            );
                            setIsRecurring(false);
                          } else {
                            setCompletedAt("");
                          }
                        }}
                        className="mt-0.5 w-4 h-4 rounded accent-accent-primary shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-tx-primary">事后补录</span>
                        <span className="block text-[11px] text-tx-tertiary mt-0.5 leading-snug">
                          已做完再记进系统。完成数按实际完成日；复盘「创建数」不计补录。
                        </span>
                      </span>
                    </label>
                    {isBackfilled && (
                      <div className="pl-6 space-y-1.5">
                        <label className="text-[11px] font-bold text-tx-secondary block">实际完成日</label>
                        <SleekDatePicker
                          value={completedAt}
                          onChange={(val) => {
                            setCompletedAt(val || "");
                            if (!dueDate && val) handleDueDateChange(val);
                          }}
                          placeholder="选择实际完成日"
                          className="w-full"
                          variant="mobile-form"
                          showTime={false}
                        />
                      </div>
                    )}
                  </div>

                  {/* Recurrence — 补录不展示 */}
                  {!isBackfilled && (
                    <div className="border-t border-app-border/40 pt-4 mt-1">
                      <RecurrenceConfigurator
                        isRecurring={isRecurring}
                        onChangeRecurring={setIsRecurring}
                        rule={recurrenceRule}
                        onChangeRule={setRecurrenceRule}
                      />
                    </div>
                  )}

                  {/* Detailed Description */}
                  
                  <div className="space-y-1.5 relative">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-tx-secondary block">详细描述</label>
                      <button
                        type="button"
                        onClick={() => setShowOCRModal(true)}
                        className="text-[11px] flex items-center gap-1 text-tx-secondary hover:text-accent-primary transition-colors"
                        title="提取图片文字"
                      >
                        <ScanText size={12} />
                        <span>OCR 提取文字</span>
                      </button>
                    </div>

                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="输入任务描述信息（支持Markdown及@提及）..."
                      rows={4}
                      className="w-full p-3 text-xs rounded-xl border border-app-border focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 bg-app-surface text-tx-primary outline-none transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out placeholder:text-tx-tertiary resize-none focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="px-5 pt-3 flex gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-app-border bg-app-surface text-sm font-semibold text-tx-secondary active:scale-[0.98] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out hover:bg-app-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={submitting || loading || !title.trim()}
                className="flex-1 py-3 rounded-xl bg-accent-primary text-sm font-semibold text-white active:scale-[0.98] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shadow-md disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                <span>完成</span>
              </button>
            </div>

            {/* Project Selector — 移动 bottom sheet / 桌面嵌套居中面板 */}
                        <BottomSheet
              open={isProjectDrawerOpen}
              onClose={() => setIsProjectDrawerOpen(false)}
              title="选择所属项目"
              maxHeight="min(60dvh, 100%)"
              zClassName="z-[110]"
            >
              <div className="px-4 py-2 space-y-1">
                {projects.map((p) => {
                  const isSelected = p.id === selectedProjectId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setIsProjectDrawerOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold min-h-[44px] transition-transform duration-press ease-out active:scale-[0.99]",
                        isSelected ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary",
                      )}
                    >
                      <span>{p.name}</span>
                      {isSelected && <Check size={16} className="text-accent-primary font-bold" />}
                    </button>
                  );
                })}
              </div>
            </BottomSheet>


            {/* Assignee Selector */}
                        <BottomSheet
              open={isAssigneeDrawerOpen}
              onClose={() => setIsAssigneeDrawerOpen(false)}
              title="选择负责人"
              maxHeight="min(60dvh, 100%)"
              zClassName="z-[110]"
            >
              <div className="px-4 py-2 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setAssigneeId("");
                    setIsAssigneeDrawerOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold min-h-[44px]",
                    !assigneeId ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary",
                  )}
                >
                  未指定
                </button>
                {(members || []).map((u: any) => {
                  const id = u.userId || u.id;
                  const name = u.displayName || u.username || id;
                  const isSelected = assigneeId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setAssigneeId(id);
                        setIsAssigneeDrawerOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold min-h-[44px]",
                        isSelected ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary",
                      )}
                    >
                      <span>{name}</span>
                      {isSelected && <Check size={16} className="text-accent-primary" />}
                    </button>
                  );
                })}
              </div>
            </BottomSheet>

          </Motion.div>
        </div>
      )}
    
      {/* 提取图片文字弹窗 */}
      <OCRModal
        isOpen={showOCRModal}
        onClose={() => setShowOCRModal(false)}
        onInsert={(text) => {
          setDescription(description + (description ? "\n" : "") + text);
        }}
      />
    </AnimatePresence>
  );
}
