import React, { useState, useEffect } from "react";
import { X, Folder, User, Flag, Calendar, Loader2, ChevronDown, Check, ScanText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api, getCurrentWorkspace } from "@/lib/api";
import { Project, ProjectMember, Tag } from "@/types";
import { toast } from "@/lib/toast";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import RecurrenceConfigurator, { RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import OCRModal from "@/components/OCRModal";

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
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isProjectDrawerOpen, setIsProjectDrawerOpen] = useState(false);
  const [isAssigneeDrawerOpen, setIsAssigneeDrawerOpen] = useState(false);

  const workspaceId = getCurrentWorkspace();
  const isIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

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
      // 1. Get stages of project to find the first stageId (fallback to "进行中")
      const stages = await api.getProjectStages(selectedProjectId);
      let stageId = "";
      if (stages.length === 0) {
        const newStage = await api.createProjectStage(selectedProjectId, { name: "进行中" });
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
        isRecurring: isRecurring ? 1 : 0,
        recurrenceRule: isRecurring ? JSON.stringify(recurrenceRule) : null,
      };

      // 3. Create project task
      await api.createProjectTask(selectedProjectId, payload);
      toast.success("新建待办成功");

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

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-end justify-center select-text md:hidden"
          style={{ bottom: isIOS ? "var(--keyboard-height, 0px)" : "0px" }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal Panel */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="relative w-full bg-app-elevated rounded-t-3xl border-t border-app-border flex flex-col overflow-hidden shadow-2xl text-tx-primary"
            style={{ 
              maxHeight: "92%",
              paddingBottom: "calc(var(--safe-area-bottom) + 16px)"
            }}
          >
            {/* Top Pull Handle Indicator */}
            <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />

            {/* Header */}
            <div className="px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0">
              <span className="w-6" /> {/* Placeholder to balance title centering */}
              <h3 className="text-base font-bold text-tx-primary">新建任务</h3>
              <button
                onClick={onClose}
                className="p-1 hover:bg-app-hover rounded-full text-tx-tertiary hover:text-tx-primary transition-colors active:scale-95"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <Loader2 size={24} className="animate-spin text-accent-primary" />
                  <span className="text-xs text-tx-tertiary">正在加载...</span>
                </div>
              ) : (
                <>
                  {/* Task Title Input */}
                  <div className="border border-app-border focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/20 rounded-xl px-3 py-1 bg-app-surface transition-all">
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="输入任务标题..."
                      className="w-full bg-transparent border-none outline-none py-1.5 text-sm font-medium focus:ring-0 placeholder:text-tx-tertiary"
                      autoFocus
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
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-tx-secondary block">提醒日期</label>
                      <SleekDatePicker
                        value={remindAt}
                        onChange={(v) => setRemindAt(v)}
                        placeholder="添加提醒日期"
                        className="w-full"
                        variant="mobile-form"
                        showTime={true}
                      />
                    </div>
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

            {/* Project Selector Drawer */}
            <AnimatePresence>
              {isProjectDrawerOpen && (
                <div 
                  className="fixed inset-0 z-[110] flex items-end justify-center md:hidden"
                  style={{ bottom: isIOS ? "var(--keyboard-height, 0px)" : "0px" }}
                >
                  {/* Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsProjectDrawerOpen(false)}
                    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  />
                  {/* Drawer Content */}
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 220 }}
                    className="relative w-full bg-app-elevated rounded-t-3xl border-t border-app-border flex flex-col overflow-hidden shadow-2xl text-tx-primary z-10"
                    style={{ 
                      maxHeight: "60%",
                      paddingBottom: "calc(var(--safe-area-bottom) + 16px)"
                    }}
                  >
                    {/* Handle */}
                    <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />
                    {/* Header */}
                    <div className="px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0">
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
                    {/* List */}
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
                              isSelected ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary"
                            )}
                          >
                            <span>{p.name}</span>
                            {isSelected && <Check size={16} className="text-accent-primary font-bold" />}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Assignee Selector Drawer */}
            <AnimatePresence>
              {isAssigneeDrawerOpen && (
                <div 
                  className="fixed inset-0 z-[110] flex items-end justify-center md:hidden"
                  style={{ bottom: isIOS ? "var(--keyboard-height, 0px)" : "0px" }}
                >
                  {/* Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsAssigneeDrawerOpen(false)}
                    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  />
                  {/* Drawer Content */}
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 220 }}
                    className="relative w-full bg-app-elevated rounded-t-3xl border-t border-app-border flex flex-col overflow-hidden shadow-2xl text-tx-primary z-10"
                    style={{ 
                      maxHeight: "60%",
                      paddingBottom: "calc(var(--safe-area-bottom) + 16px)"
                    }}
                  >
                    {/* Handle */}
                    <div className="w-12 h-1 bg-app-border/60 rounded-full mx-auto my-3 shrink-0" />
                    {/* Header */}
                    <div className="px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0">
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
                    {/* List */}
                    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                      {/* Option 1: Myself */}
                      <button
                        type="button"
                        onClick={() => {
                          setAssigneeId(currentUserId);
                          setIsAssigneeDrawerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left text-sm font-semibold transition-all active:scale-[0.99]",
                          assigneeId === currentUserId ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary"
                        )}
                      >
                        <span>我自己</span>
                        {assigneeId === currentUserId && <Check size={16} className="text-accent-primary font-bold" />}
                      </button>
                      {/* Other members */}
                      {members.filter(m => m.userId !== currentUserId).map((m) => {
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
                              isSelected ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-app-hover text-tx-primary"
                            )}
                          >
                            <span>{name}</span>
                            {isSelected && <Check size={16} className="text-accent-primary font-bold" />}
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
