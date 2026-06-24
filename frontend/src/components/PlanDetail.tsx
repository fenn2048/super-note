import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plan, Milestone, Project, AuditLog, UserPublicInfo, User } from "@/types";
import { api, getCurrentWorkspace } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { 
  ArrowLeft, Plus, Calendar, Loader2, X, CheckCircle2, 
  Clock, AlertCircle, Trash2, Edit, CheckSquare, Settings, 
  Compass, Link, Unlink, ExternalLink, RefreshCw, Milestone as MilestoneIcon,
  MessageSquare, UserCheck, ArrowRight, ListTodo
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { confirm as confirmDialog } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { format, parseISO } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

interface PlanDetailProps {
  planId: string;
  onBack: () => void;
}

export default function PlanDetail({ planId, onBack }: PlanDetailProps) {
  const { t, i18n } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [workspaceId, setWorkspaceId] = useState(getCurrentWorkspace());

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBackground, setEditBackground] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editParticipants, setEditParticipants] = useState<string[]>([]);
  const [editMilestones, setEditMilestones] = useState<Array<{ id?: string; name: string; description: string; startDate: string; endDate: string; status: "pending" | "in_progress" | "completed" }>>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    api.getMe().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  // Load plan and details
  const loadPlanDetail = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPlan(planId);
      setPlan(data);
      
      // Load logs
      setLoadingLogs(true);
      const logs = await api.getTargetAuditLogs("plan", planId);
      setAuditLogs(logs);

      // Load all workspace projects for selection
      const wsProjects = await api.getProjects(workspaceId || undefined);
      // Filter out special personal/family todo projects which cannot be associated with plans
      const filteredProjects = wsProjects.filter(p => p.name !== "个人TODO" && p.name !== "家庭TODO");
      setAllProjects(filteredProjects);
    } catch (e) {
      console.error("Failed to load plan detail:", e);
      toast.error("加载计划详情失败");
    } finally {
      setLoading(false);
      setLoadingLogs(false);
    }
  }, [planId, workspaceId]);

  useEffect(() => {
    loadPlanDetail();
  }, [loadPlanDetail]);

  // Load workspace members for editor
  useEffect(() => {
    if (showEditModal) {
      if (workspaceId) {
        api.getWorkspaceMembers(workspaceId)
          .then(setWorkspaceMembers)
          .catch(() => setWorkspaceMembers([]));
      } else if (currentUser) {
        setWorkspaceMembers([{
          userId: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName || currentUser.username,
          avatarUrl: currentUser.avatarUrl
        }]);
      }
    }
  }, [showEditModal, workspaceId, currentUser]);

  // Handle plan status change
  const handlePlanStatusChange = async (newStatus: "pending" | "in_progress" | "completed") => {
    if (!plan) return;
    if (newStatus === plan.status) return;

    const confirmMsg = newStatus === "completed" 
      ? t("sidebar.planStatusConfirmCompleted")
      : newStatus === "pending"
      ? t("sidebar.planStatusConfirmPending")
      : t("sidebar.planStatusConfirmInProgress");

    const ok = await confirmDialog({
      title: t("sidebar.updateStatusTitle"),
      description: confirmMsg,
    });
    if (!ok) return;

    try {
      await api.updatePlan(planId, { status: newStatus });
      toast.success("计划状态已更新");
      loadPlanDetail();
    } catch (err: any) {
      toast.error(err?.message || "更新计划状态失败");
    }
  };

  // Handle milestone status change
  const handleMilestoneStatusChange = async (milestoneId: string, milestoneName: string, newStatus: "pending" | "in_progress" | "completed") => {
    const confirmMsg = newStatus === "completed"
      ? t("sidebar.milestoneStatusConfirmCompleted", { name: milestoneName })
      : newStatus === "pending"
      ? t("sidebar.milestoneStatusConfirmPending", { name: milestoneName })
      : t("sidebar.milestoneStatusConfirmInProgress", { name: milestoneName });
    const ok = await confirmDialog({
      title: t("sidebar.updateStatusTitle"),
      description: confirmMsg,
    });
    if (!ok) return;

    try {
      await api.updateMilestoneStatus(milestoneId, newStatus);
      toast.success("里程碑状态已更新");
      loadPlanDetail();
    } catch (err: any) {
      toast.error(err?.message || "更新里程碑状态失败");
    }
  };

  // Associate project to a milestone
  const handleAssociateProject = async (milestoneId: string, projectId: string) => {
    try {
      await api.updateProject(projectId, { milestoneId });
      toast.success("成功关联项目到里程碑");
      loadPlanDetail();
    } catch (err: any) {
      toast.error(err?.message || "关联项目失败");
    }
  };

  // Dissociate project from a milestone
  const handleDissociateProject = async (projectId: string) => {
    const ok = await confirmDialog({
      title: t("sidebar.dissociateProjectTitle"),
      description: t("sidebar.dissociateProjectConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.updateProject(projectId, { milestoneId: null });
      toast.success("成功取消关联");
      loadPlanDetail();
    } catch (err: any) {
      toast.error(err?.message || "取消关联失败");
    }
  };

  // Navigate to project board
  const handleNavigateToProject = (projectId: string) => {
    const filter = { type: "detail", projectId };
    actions.setViewMode("projects");
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  // Open Edit Modal and prefill data
  const handleOpenEditModal = () => {
    if (!plan) return;
    setEditName(plan.name);
    setEditBackground(plan.background || "");
    setEditGoal(plan.goal || "");
    setEditDetails(plan.details || "");
    setEditStartDate(plan.startDate || "");
    setEditEndDate(plan.endDate || "");
    setEditParticipants(plan.participants?.map(p => p.userId) || []);
    setEditMilestones(plan.milestones?.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description || "",
      startDate: m.startDate || "",
      endDate: m.endDate || "",
      status: m.status
    })) || []);
    setShowEditModal(true);
  };

  // Submit Edit Plan Form
  const handleUpdatePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast.error("计划名称不能为空");
      return;
    }

    try {
      const payload = {
        name: editName,
        background: editBackground,
        goal: editGoal,
        details: editDetails,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
        participants: editParticipants,
        milestones: editMilestones
      };
      await api.updatePlan(planId, payload);
      toast.success("计划更新成功");
      setShowEditModal(false);
      loadPlanDetail();
    } catch (err: any) {
      toast.error(err?.message || "更新计划失败");
    }
  };

  // Edit Modal Milestone Management
  const handleAddEditMilestone = () => {
    setEditMilestones([...editMilestones, { name: "", description: "", startDate: "", endDate: "", status: "pending" }]);
  };

  const handleRemoveEditMilestone = (index: number) => {
    setEditMilestones(editMilestones.filter((_, i) => i !== index));
  };

  const handleEditMilestoneChange = (index: number, field: string, value: string) => {
    const updated = [...editMilestones];
    updated[index] = { ...updated[index], [field]: value };
    setEditMilestones(updated);
  };

  const toggleEditParticipant = (userId: string) => {
    if (editParticipants.includes(userId)) {
      setEditParticipants(editParticipants.filter(id => id !== userId));
    } else {
      setEditParticipants([...editParticipants, userId]);
    }
  };

  // Delete Plan
  const handleDeletePlan = async () => {
    const ok = await confirmDialog({
      title: t("sidebar.deletePlanTitle"),
      description: t("sidebar.deletePlanConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePlan(planId);
      toast.success("计划已删除");
      onBack();
    } catch (err: any) {
      toast.error(err?.message || "删除计划失败");
    }
  };

  // Get project lists that are eligible for association (exclude projects already assigned to milestones in this plan)
  const unassociatedProjects = useMemo(() => {
    const associatedIds = new Set(
      plan?.milestones?.flatMap(m => m.projects?.map(p => p.id) || []) || []
    );
    return allProjects.filter(p => !associatedIds.has(p.id));
  }, [allProjects, plan]);

  // Labels and Styles helpers
  const getStatusLabel = (status: string) => {
    if (status === "completed") return "已完成";
    if (status === "in_progress") return "进行中";
    return "待启动";
  };

  const getStatusStyle = (status: string) => {
    if (status === "completed") return "bg-green-50 text-green-700 border-green-200/50";
    if (status === "in_progress") return "bg-indigo-50 text-indigo-700 border-indigo-200/50";
    return "bg-stone-100 text-stone-600 border-stone-200/50";
  };

  const getStatusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} className="text-green-600 shrink-0" />;
    if (status === "in_progress") return <Clock size={12} className="text-indigo-600 shrink-0" />;
    return <AlertCircle size={12} className="text-stone-500 shrink-0" />;
  };

  const getAuditActionText = (action: string, details: string) => {
    if (action === "create_plan") return "创建了计划";
    if (action === "plan_update") return "修改了计划信息";
    if (action === "plan_status_update") return `手动修改了计划状态`;
    if (action === "plan_status_auto_update") return `系统自动触发了计划状态变更`;
    if (action === "milestone_status_update") return `手动修改了里程碑状态`;
    if (action === "milestone_status_auto_update") return `系统自动更新了里程碑状态`;
    if (action === "project_status_update") return `修改了项目状态`;
    if (action === "project_status_auto_update") return `里程碑更新自动修改了项目状态`;
    return details || action;
  };

  if (loading || !plan) {
    return (
      <div className="flex h-full items-center justify-center bg-app-bg text-tx-secondary">
        <Loader2 size={32} className="animate-spin text-accent-primary" />
      </div>
    );
  }

  // Calculate stats
  const completedMilestones = plan.milestones?.filter(m => m.status === "completed").length || 0;
  const totalMilestones = plan.milestones?.length || 0;
  const progressPercentage = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 overflow-y-auto">
      {/* Header */}
      <div 
        className="h-14 px-4 border-b border-app-border flex items-center justify-between shrink-0 select-none bg-app-sidebar/20"
        style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
      >
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-1 hover:bg-app-hover rounded-lg text-tx-secondary hover:text-tx-primary transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Compass size={18} className="text-accent-primary shrink-0" />
            <h1 className="text-sm font-bold text-tx-primary truncate max-w-[200px] md:max-w-xs">{plan.name}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleOpenEditModal}
            variant="outline"
            className="h-8 text-xs font-semibold px-3 rounded-lg border-app-border hover:bg-app-hover flex items-center gap-1.5"
          >
            <Edit size={14} />
            <span>编辑</span>
          </Button>
          <Button
            onClick={handleDeletePlan}
            variant="ghost"
            className="h-8 text-xs font-semibold px-3 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-1.5"
          >
            <Trash2 size={14} />
            <span>删除</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Background, Goal, Details & Logs (2 Columns wide on lg) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Background and Goal Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Background Card */}
            <div className="p-4 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-2">
              <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                <Compass size={13} className="text-accent-primary" />
                <span>计划背景</span>
              </h3>
              <p className="text-xs text-tx-secondary leading-relaxed min-h-[50px] whitespace-pre-wrap">
                {plan.background || <span className="text-tx-tertiary italic">暂无背景说明</span>}
              </p>
            </div>

            {/* Goal Card */}
            <div className="p-4 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-2">
              <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare size={13} className="text-accent-primary" />
                <span>达成目标</span>
              </h3>
              <p className="text-xs text-tx-secondary leading-relaxed min-h-[50px] whitespace-pre-wrap">
                {plan.goal || <span className="text-tx-tertiary italic">暂无目标描述</span>}
              </p>
            </div>
          </div>

          {/* Plan Details Card (Markdown support) */}
          <div className="p-6 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-4">
            <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider border-b border-app-border/40 pb-2">
              计划大纲详情
            </h3>
            <div className="prose prose-sm max-w-none text-tx-secondary leading-relaxed dark:prose-invert">
              {plan.details ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {plan.details}
                </ReactMarkdown>
              ) : (
                <p className="text-xs text-tx-tertiary italic">暂无大纲详情</p>
              )}
            </div>
          </div>

          {/* Modification History Logs */}
          <div className="p-6 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
              <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider">
                修改与状态日志
              </h3>
              <button 
                onClick={loadPlanDetail}
                className="p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-tx-primary transition-colors"
                title="刷新日志"
              >
                <RefreshCw size={12} className={cn(loadingLogs && "animate-spin")} />
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-tx-tertiary italic">暂无任何修改记录</p>
            ) : (
              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2.5 text-xs text-tx-secondary">
                    {/* User Avatar */}
                    <div className="w-6 h-6 rounded-full bg-accent-primary/20 shrink-0 flex items-center justify-center text-[10px] font-bold text-accent-primary uppercase border border-app-border">
                      {log.avatarUrl ? (
                        <img src={log.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        (log.displayName || log.username || "U").slice(0, 1)
                      )}
                    </div>
                    {/* Log Details */}
                    <div className="flex-1 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-tx-primary">{log.displayName || log.username}</span>
                        <span className="text-[10px] text-tx-tertiary font-mono">
                          {format(parseISO(log.createdAt + (log.createdAt.endsWith("Z") ? "" : "Z")), "yyyy-MM-dd HH:mm", { locale: dateLocale })}
                        </span>
                      </div>
                      <p className="text-[11px] text-tx-secondary leading-normal bg-app-bg/50 px-2 py-1 rounded border border-app-border/20">
                        {getAuditActionText(log.action, log.details)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Meta details, milestones & status (1 Column wide on lg) */}
        <div className="space-y-6">
          
          {/* Plan Meta / Status Info */}
          <div className="p-4 border border-app-border bg-app-sidebar/20 rounded-2xl space-y-4 shadow-sm">
            {/* Status Dropdown */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-tx-tertiary uppercase">计划状态</span>
              <div className="relative">
                <select
                  value={plan.status}
                  onChange={(e) => handlePlanStatusChange(e.target.value as any)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border outline-none cursor-pointer ${getStatusStyle(plan.status)}`}
                >
                  <option value="pending">待启动</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已完成</option>
                </select>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-tx-tertiary font-mono">
                <span className="flex items-center gap-0.5">
                  <MilestoneIcon size={10} />
                  里程碑总进度
                </span>
                <span>{completedMilestones}/{totalMilestones} ({progressPercentage}%)</span>
              </div>
              <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            {/* Date range */}
            <div className="flex items-center justify-between text-xs text-tx-secondary py-1 border-t border-app-border/40 pt-3">
              <span className="text-tx-tertiary flex items-center gap-1">
                <Calendar size={13} />
                <span>计划周期</span>
              </span>
              <span className="font-mono text-tx-primary">
                {plan.startDate || "-"} ~ {plan.endDate || "-"}
              </span>
            </div>

            {/* Participants */}
            <div className="space-y-2 border-t border-app-border/40 pt-3">
              <span className="text-xs text-tx-tertiary block font-semibold">参与人员 ({plan.participants?.length || 0})</span>
              <div className="flex flex-wrap gap-1.5">
                {plan.participants?.map((u) => (
                  <div 
                    key={u.userId}
                    className="flex items-center gap-1 px-2 py-1 rounded-xl bg-app-bg border border-app-border text-[10px] text-tx-secondary"
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-accent-primary/20 shrink-0 flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        u.displayName?.slice(0, 1) || u.username.slice(0, 1)
                      )}
                    </div>
                    <span className="truncate max-w-[80px]">{u.displayName || u.username}</span>
                  </div>
                ))}
                {(!plan.participants || plan.participants.length === 0) && (
                  <span className="text-[10px] text-tx-tertiary italic">无参与人员</span>
                )}
              </div>
            </div>
          </div>

          {/* Milestones and Projects */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1">
              <MilestoneIcon size={14} className="text-accent-primary" />
              <span>里程碑与项目关联</span>
            </h3>

            {plan.milestones?.map((ms, index) => (
              <div key={ms.id} className="p-4 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-3">
                {/* Milestone Title & Status */}
                <div className="flex items-start justify-between border-b border-app-border/30 pb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-accent-primary/10 text-accent-primary font-bold px-1.5 py-0.5 rounded font-mono shrink-0">
                        M{index + 1}
                      </span>
                      <h4 className="font-bold text-xs text-tx-primary truncate">{ms.name}</h4>
                    </div>
                    {ms.description && (
                      <p className="text-[10px] text-tx-tertiary mt-1 line-clamp-1">{ms.description}</p>
                    )}
                  </div>
                  
                  {/* Milestone Status Dropdown */}
                  <select
                    value={ms.status}
                    onChange={(e) => handleMilestoneStatusChange(ms.id, ms.name, e.target.value as any)}
                    className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border outline-none cursor-pointer ${getStatusStyle(ms.status)}`}
                  >
                    <option value="pending">待启动</option>
                    <option value="in_progress">进行中</option>
                    <option value="completed">已完成</option>
                  </select>
                </div>

                {/* Milestone Period */}
                <div className="flex items-center gap-1 text-[9px] text-tx-tertiary font-mono">
                  <Calendar size={10} />
                  <span>{ms.startDate || "-"}</span>
                  <span>~</span>
                  <span>{ms.endDate || "-"}</span>
                </div>

                {/* Associated Projects list */}
                <div className="space-y-2 pt-1">
                  <span className="text-[10px] text-tx-tertiary block font-bold">对应项目：</span>
                  {ms.projects && ms.projects.length > 0 ? (
                    <div className="space-y-1.5">
                      {ms.projects.map((proj) => {
                        const total = proj.totalTasksCount || 0;
                        const completed = proj.completedTasksCount || 0;
                        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
                        
                        return (
                          <div 
                            key={proj.id}
                            className="p-2 border border-app-border bg-app-bg hover:bg-app-hover rounded-xl flex items-center justify-between gap-2 transition-colors"
                          >
                            <div 
                              onClick={() => handleNavigateToProject(proj.id)}
                              className="flex-1 min-w-0 cursor-pointer group/proj"
                            >
                              <div className="flex items-center gap-1.5">
                                <ListTodo size={11} className="text-accent-primary shrink-0" />
                                <span className="text-xs font-bold text-tx-primary group-hover/proj:text-accent-primary truncate block">
                                  {proj.name}
                                </span>
                              </div>
                              {/* progress bar */}
                              <div className="mt-1 flex items-center gap-1.5">
                                <div className="flex-1 h-1 bg-app-hover rounded-full overflow-hidden">
                                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                                </div>
                                <span className="text-[9px] text-tx-tertiary font-mono">{progress}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusStyle(proj.status || "pending")}`}>
                                {getStatusLabel(proj.status || "pending")}
                              </span>
                              <button
                                onClick={() => handleDissociateProject(proj.id)}
                                className="p-1 hover:bg-red-50 text-tx-tertiary hover:text-red-500 rounded transition-colors"
                                title="取消关联"
                              >
                                <Unlink size={11} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-tx-tertiary italic bg-app-bg/30 p-2 rounded-xl border border-dashed border-app-border/40 text-center">
                      无关联项目，除个人/家庭TODO外其他项目必须对应一个里程碑
                    </p>
                  )}
                </div>

                {/* Associate project dropdown */}
                {unassociatedProjects.length > 0 && (
                  <div className="pt-1 flex items-center gap-1">
                    <span className="text-[9px] text-tx-tertiary shrink-0">关联项目：</span>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAssociateProject(ms.id, e.target.value);
                          e.target.value = "";
                        }
                      }}
                      className="flex-1 text-[10px] border border-app-border bg-app-bg rounded p-1 outline-none text-tx-secondary"
                    >
                      <option value="">-- 选择要关联的项目 --</option>
                      {unassociatedProjects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}

            {(!plan.milestones || plan.milestones.length === 0) && (
              <div className="p-6 border border-app-border border-dashed bg-app-sidebar/5 rounded-2xl text-center text-tx-tertiary">
                <MilestoneIcon size={24} className="mx-auto mb-1 opacity-50" />
                <p className="text-xs font-semibold">暂无里程碑</p>
                <p className="text-[10px]">点击上方“编辑”添加计划里程碑</p>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Edit Plan Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-app-sidebar border border-app-border rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-tx-primary">编辑计划</h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleUpdatePlanSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">计划名称</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="例如：2026年技术平台架构升级计划…"
                  className="h-10 text-xs border-app-border w-full rounded-xl"
                  required
                />
              </div>

              {/* Background & Goal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">计划背景</label>
                  <Textarea
                    value={editBackground}
                    onChange={(e) => setEditBackground(e.target.value)}
                    placeholder="为什么要启动这个计划？"
                    className="min-h-[80px] text-xs border-app-border w-full rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">达成目标</label>
                  <Textarea
                    value={editGoal}
                    onChange={(e) => setEditGoal(e.target.value)}
                    placeholder="这个计划达成的效果与关键指标是什么？"
                    className="min-h-[80px] text-xs border-app-border w-full rounded-xl"
                  />
                </div>
              </div>

              {/* Start & End Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">开始时间</label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full h-10 px-3 text-xs border border-app-border rounded-xl bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">截止时间</label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full h-10 px-3 text-xs border border-app-border rounded-xl bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                  />
                </div>
              </div>

              {/* Participants */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">参与人</label>
                <div className="flex flex-wrap gap-2 p-3 border border-app-border rounded-xl bg-app-bg max-h-36 overflow-y-auto">
                  {workspaceMembers.map((u) => {
                    const active = editParticipants.includes(u.userId);
                    return (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => toggleEditParticipant(u.userId)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all ${
                          active 
                            ? "bg-accent-primary text-white border-accent-primary" 
                            : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover"
                        }`}
                      >
                        {u.displayName || u.username}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Milestones Manager */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">计划里程碑</label>
                  <Button
                    type="button"
                    onClick={handleAddEditMilestone}
                    variant="ghost"
                    className="h-6 text-[10px] text-accent-primary hover:text-accent-primary/80 flex items-center gap-1"
                  >
                    <Plus size={10} />
                    添加里程碑
                  </Button>
                </div>

                <div className="space-y-3">
                  {editMilestones.map((ms, index) => (
                    <div key={index} className="p-4 border border-app-border bg-app-bg/50 rounded-xl space-y-3 relative">
                      <button
                        type="button"
                        onClick={() => handleRemoveEditMilestone(index)}
                        className="absolute top-2 right-2 p-1 text-tx-tertiary hover:text-red-500 rounded-lg hover:bg-app-hover transition-colors"
                      >
                        <X size={12} />
                      </button>

                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">里程碑 {index + 1} 名称</label>
                        <Input
                          value={ms.name}
                          onChange={(e) => handleEditMilestoneChange(index, "name", e.target.value)}
                          placeholder="例如：Phase 1 架构设计完成"
                          className="h-8 text-xs border-app-border w-full rounded-lg"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">里程碑描述</label>
                        <Textarea
                          value={ms.description}
                          onChange={(e) => handleEditMilestoneChange(index, "description", e.target.value)}
                          placeholder="里程碑产出与交付物是什么…"
                          className="min-h-[50px] text-xs border-app-border w-full rounded-lg"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-tx-tertiary uppercase block mb-1">开始时间</label>
                          <input
                            type="date"
                            value={ms.startDate}
                            onChange={(e) => handleEditMilestoneChange(index, "startDate", e.target.value)}
                            className="w-full h-8 px-2 text-[11px] border border-app-border rounded-lg bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-tx-tertiary uppercase block mb-1">截止时间</label>
                          <input
                            type="date"
                            value={ms.endDate}
                            onChange={(e) => handleEditMilestoneChange(index, "endDate", e.target.value)}
                            className="w-full h-8 px-2 text-[11px] border border-app-border rounded-lg bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Markdown Details */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">计划正文详情 (Markdown)</label>
                <Textarea
                  value={editDetails}
                  onChange={(e) => setEditDetails(e.target.value)}
                  placeholder="# 计划大纲..."
                  className="min-h-[160px] text-xs border-app-border w-full rounded-xl font-mono leading-relaxed"
                />
              </div>

              {/* Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-app-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowEditModal(false)}
                  className="h-9 px-4 rounded-xl text-xs hover:bg-app-hover"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  className="h-9 px-4 rounded-xl text-xs bg-accent-primary text-white hover:bg-accent-primary/95"
                >
                  保存修改
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
