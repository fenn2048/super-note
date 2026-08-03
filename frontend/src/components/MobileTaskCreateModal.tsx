import React, { useState, useEffect, useRef } from "react";
import { X, Folder, User, Flag, Calendar, Loader2, ChevronDown, Check, ScanText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api, getCurrentWorkspace } from "@/lib/api";
import { Project, ProjectMember, Tag } from "@/types";
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
  const [priority, setPriority] = useState<number>(2); // Default to Medium (2)
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

    setSubmitting(true);
    try {
      // 1. Get stages of project to find the first stageId (fallback to "待启动")
      const stages = await api.getProjectStages(selectedProjectId);
      let stageId = "";
      if (stages.length === 0) {
        const newStage = await api.createProjectStage(selectedProjectId, { name: "待启动" });
        stageId = newStage.id;
      } else {
        stageId = stages[0].id;
      }

      // 2. Prepare task payload
      const payload = {
        stageId,
        title: title.trim(),
        description: description.trim(),
        assigneeId: assigneeId || null,
        endDate: dueDate ? new Date(dueDate).toISOString() : null,
        priority,
        remindAt: remindAt || null,
        reminderOffsetValue,
        reminderOffsetUnit,
        isRecurring: isRecurring ? 1 : 0,
        recurrenceRule: isRecurring ? JSON.stringify(recurrenceRule) : null,
      };

      // 3. Create project task
      const newTask = await api.createProjectTask(selectedProjectId, payload);
      toast.success("新建待办成功");

      // 原生端立刻调度本地通知（此前移动端创建路径漏调，导致锁屏永远收不到提醒）
      if (newTask?.remindAt) {
        void syncTaskNotification(newTask as any);
      }

      // Reset form
      setTitle("");
      setDescription("");
      setDueDate("");
      setRemindAt("");
      setPriority(2);
      setIsRecurring(false);
      setRecurrenceRule({ type: "weekday" });

      // Dispatch event to sync list UI
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Panel */}
          <motion.div
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
            transition={
              isDesktop
                ? { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                : { type: "tween", duration: 0.28, ease: [0.22, 1, 0.36, 1] }
            }
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
                  <div className="border border-app-border focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/20 rounded-xl px-3 py-1 bg-app-surface transition-all">
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

                  {/* Priority Selector Row */}
                  <div className="flex items-center justify-between py-1 border-b border-app-border/40">
                    <div className="flex items-center gap-2 text-tx-secondary">
                      <Flag size={16} />
                      <span className="text-xs font-semibold">优先级</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[
                        { level: 3, label: "高", activeClass: "bg-red-500 text-white font-bold ring-2 ring-red-500/20", inactiveClass: "bg-red-500/10 border-red-500/20 text-red-500" },
                        { level: 2, label: "中", activeClass: "bg-amber-500 text-white font-bold ring-2 ring-amber-500/20", inactiveClass: "bg-amber-500/10 border-amber-500/20 text-amber-500" },
                        { level: 1, label: "低", activeClass: "bg-blue-500 text-white font-bold ring-2 ring-blue-500/20", inactiveClass: "bg-blue-500/10 border-blue-500/20 text-blue-500" },
                        { level: 0, label: "无", activeClass: "bg-zinc-500 text-white font-bold ring-2 ring-zinc-500/20", inactiveClass: "bg-zinc-500/10 border-zinc-500/20 text-tx-secondary" }
                      ].map((prio) => (
                        <button
                          key={prio.level}
                          type="button"
                          onClick={() => setPriority(prio.level)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border border-transparent ${
                            priority === prio.level ? prio.activeClass : prio.inactiveClass
                          }`}
                        >
                          {prio.label}
                        </button>
                      ))}
                    </div>
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
                    {(dueDate || isRecurring) && (
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

                  {/* Recurrence Configuration */}
                  <div className="border-t border-app-border/40 pt-4 mt-1">
                    <RecurrenceConfigurator
                      isRecurring={isRecurring}
                      onChangeRecurring={setIsRecurring}
                      rule={recurrenceRule}
                      onChangeRule={setRecurrenceRule}
                    />
                  </div>

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
                      className="w-full p-3 text-xs rounded-xl border border-app-border focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 bg-app-surface text-tx-primary outline-none transition-all placeholder:text-tx-tertiary resize-none focus:outline-none"
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
                className="flex-1 py-3 rounded-xl border border-app-border bg-app-surface text-sm font-semibold text-tx-secondary active:scale-[0.98] transition-all hover:bg-app-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={submitting || loading || !title.trim()}
                className="flex-1 py-3 rounded-xl bg-accent-primary text-sm font-semibold text-white active:scale-[0.98] transition-all shadow-md disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                <span>完成</span>
              </button>
            </div>

            {/* Project Selector — 移动 bottom sheet / 桌面嵌套居中面板 */}
            <AnimatePresence>
              {isProjectDrawerOpen && (
                <div
                  className={cn(
                    "absolute inset-0 z-[110] flex justify-center",
                    isDesktop ? "items-center p-4" : "items-end",
                  )}
                >
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsProjectDrawerOpen(false)}
                    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={isDesktop ? { opacity: 0, scale: 0.96 } : { y: "100%" }}
                    animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
                    exit={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 220 }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "relative bg-app-elevated flex flex-col overflow-hidden shadow-2xl text-tx-primary z-10",
                      isDesktop
                        ? "w-full max-w-sm max-h-[60%] rounded-2xl border border-app-border"
                        : "w-full rounded-t-3xl border-t border-app-border",
                    )}
                    style={
                      isDesktop
                        ? undefined
                        : {
                            maxHeight: "60%",
                            paddingBottom: "calc(var(--safe-area-bottom) + 16px)",
                          }
                    }
                  >
                    {!isDesktop && (
                      <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />
                    )}
                    <div
                      className={cn(
                        "px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0",
                        isDesktop && "pt-4",
                      )}
                    >
                      <span className="w-6" />
                      <h4 className="text-sm font-bold text-tx-primary">选择所属项目</h4>
                      <button
                        type="button"
                        onClick={() => setIsProjectDrawerOpen(false)}
                        className="p-1 hover:bg-app-hover rounded-full text-tx-tertiary hover:text-tx-primary transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
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
                              "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold transition-all active:scale-[0.99]",
                              isSelected
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "hover:bg-app-hover text-tx-primary",
                            )}
                          >
                            <span>{p.name}</span>
                            {isSelected && (
                              <Check size={16} className="text-accent-primary font-bold" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Assignee Selector */}
            <AnimatePresence>
              {isAssigneeDrawerOpen && (
                <div
                  className={cn(
                    "absolute inset-0 z-[110] flex justify-center",
                    isDesktop ? "items-center p-4" : "items-end",
                  )}
                >
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsAssigneeDrawerOpen(false)}
                    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={isDesktop ? { opacity: 0, scale: 0.96 } : { y: "100%" }}
                    animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
                    exit={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 220 }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "relative bg-app-elevated flex flex-col overflow-hidden shadow-2xl text-tx-primary z-10",
                      isDesktop
                        ? "w-full max-w-sm max-h-[60%] rounded-2xl border border-app-border"
                        : "w-full rounded-t-3xl border-t border-app-border",
                    )}
                    style={
                      isDesktop
                        ? undefined
                        : {
                            maxHeight: "60%",
                            paddingBottom: "calc(var(--safe-area-bottom) + 16px)",
                          }
                    }
                  >
                    {!isDesktop && (
                      <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />
                    )}
                    <div
                      className={cn(
                        "px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0",
                        isDesktop && "pt-4",
                      )}
                    >
                      <span className="w-6" />
                      <h4 className="text-sm font-bold text-tx-primary">选择指派给</h4>
                      <button
                        type="button"
                        onClick={() => setIsAssigneeDrawerOpen(false)}
                        className="p-1 hover:bg-app-hover rounded-full text-tx-tertiary hover:text-tx-primary transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAssigneeId(currentUserId);
                          setIsAssigneeDrawerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold transition-all active:scale-[0.99]",
                          assigneeId === currentUserId
                            ? "bg-accent-primary/10 text-accent-primary"
                            : "hover:bg-app-hover text-tx-primary",
                        )}
                      >
                        <span>我自己</span>
                        {assigneeId === currentUserId && (
                          <Check size={16} className="text-accent-primary font-bold" />
                        )}
                      </button>
                      {members
                        .filter((m) => m.userId !== currentUserId)
                        .map((m) => {
                          const isSelected = m.userId === assigneeId;
                          const name = m.displayName || m.username;
                          return (
                            <button
                              key={m.userId}
                              type="button"
                              onClick={() => {
                                setAssigneeId(m.userId);
                                setIsAssigneeDrawerOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold transition-all active:scale-[0.99]",
                                isSelected
                                  ? "bg-accent-primary/10 text-accent-primary"
                                  : "hover:bg-app-hover text-tx-primary",
                              )}
                            >
                              <span>{name}</span>
                              {isSelected && (
                                <Check size={16} className="text-accent-primary font-bold" />
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
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
