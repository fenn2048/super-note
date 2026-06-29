import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plan, Project, AuditLog, User, WorkspaceMember } from "@/types";
import { api, getCurrentWorkspace } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAppActions } from "@/store/AppContext";
import { 
  ArrowLeft, Plus, Calendar, Loader2, X, Trash2, Edit, CheckSquare,
  Compass, Unlink, RefreshCw, Milestone as MilestoneIcon,
  ListTodo
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

  const actions = useAppActions();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [workspaceId] = useState(getCurrentWorkspace());

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBackground, setEditBackground] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editParticipants, setEditParticipants] = useState<string[]>([]);
  const [editMilestones, setEditMilestones] = useState<Array<{ id?: string; name: string; description: string; startDate: string; endDate: string; status: "pending" | "in_progress" | "completed" | "paused" }>>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
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
      toast.error(t("plans.loadFailed"));
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
          userId: currentUser.id, workspaceId: "", role: "owner", joinedAt: "", email: "",
          username: currentUser.username,
          displayName: currentUser.displayName || null,
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
      toast.success(t("sidebar.planStatusSuccess"));
      loadPlanDetail();
    } catch (err: any) {
      toast.error((err as any)?.message || t("sidebar.planStatusFail"));
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
      toast.success(t("sidebar.milestoneStatusSuccess"));
      loadPlanDetail();
    } catch (err: any) {
      toast.error((err as any)?.message || t("sidebar.milestoneStatusFail"));
    }
  };

  // Associate project to a milestone
  const handleAssociateProject = async (milestoneId: string, projectId: string) => {
    try {
      await api.updateProject(projectId, { milestoneId });
      toast.success(t("sidebar.associateSuccess"));
      loadPlanDetail();
    } catch (err: any) {
      toast.error((err as any)?.message || t("sidebar.associateFail"));
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
      toast.success(t("sidebar.dissociateSuccess"));
      loadPlanDetail();
    } catch (err: any) {
      toast.error((err as any)?.message || t("sidebar.dissociateFail"));
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
      toast.error(t("plans.nameRequired"));
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
      toast.success(t("plans.updateSuccess"));
      setShowEditModal(false);
      loadPlanDetail();
    } catch (err: any) {
      toast.error((err as any)?.message || t("plans.updateFailed"));
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
      toast.success(t("common.deleteSuccess"));
      onBack();
    } catch (err: any) {
      toast.error((err as any)?.message || t("sidebar.deletePlanFail"));
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
    if (status === "completed") return t("plans.statusCompleted");
    if (status === "in_progress") return t("plans.statusInProgress");
    return t("plans.statusToStart");
  };

  const getStatusStyle = (status: string) => {
    if (status === "completed") return "bg-green-50 text-green-700 border-green-200/50";
    if (status === "in_progress") return "bg-indigo-50 text-indigo-700 border-indigo-200/50";
    return "bg-stone-100 text-stone-600 border-stone-200/50";
  };

  /* const getStatusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} className="text-green-600 shrink-0" />;
    if (status === "in_progress") return <Clock size={12} className="text-indigo-600 shrink-0" />;
    return <AlertCircle size={12} className="text-stone-500 shrink-0" />;
  }; */

  const getAuditActionText = (action: string, details: string) => {
    if (action === "create_plan") return t("plans.logs.create_plan");
    if (action === "plan_update") return t("plans.logs.plan_update");
    if (action === "plan_status_update") return t("plans.logs.plan_status_update");
    if (action === "plan_status_auto_update") return t("plans.logs.plan_status_auto_update");
    if (action === "milestone_status_update") return t("plans.logs.milestone_status_update");
    if (action === "milestone_status_auto_update") return t("plans.logs.milestone_status_auto_update");
    if (action === "project_status_update") return t("plans.logs.project_status_update");
    if (action === "project_status_auto_update") return t("plans.logs.project_status_auto_update");
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
            <span>{t("sidebar.edit")}</span>
          </Button>
          <Button
            onClick={handleDeletePlan}
            variant="ghost"
            className="h-8 text-xs font-semibold px-3 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-1.5"
          >
            <Trash2 size={14} />
            <span>{t("common.delete")}</span>
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
                <span>{t("plans.background")}</span>
              </h3>
              <p className="text-xs text-tx-secondary leading-relaxed min-h-[50px] whitespace-pre-wrap">
                {plan.background || <span className="text-tx-tertiary italic">{t("sidebar.noBackground")}</span>}
              </p>
            </div>

            {/* Goal Card */}
            <div className="p-4 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-2">
              <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare size={13} className="text-accent-primary" />
                <span>{t("plans.goal")}</span>
              </h3>
              <p className="text-xs text-tx-secondary leading-relaxed min-h-[50px] whitespace-pre-wrap">
                {plan.goal || <span className="text-tx-tertiary italic">{t("sidebar.noGoal")}</span>}
              </p>
            </div>
          </div>

          {/* Plan Details Card (Markdown support) */}
          <div className="p-6 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-4">
            <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider border-b border-app-border/40 pb-2">
              {t("sidebar.planOutline")}
            </h3>
            <div className="prose prose-sm max-w-none text-tx-secondary leading-relaxed dark:prose-invert">
              {plan.details ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {plan.details}
                </ReactMarkdown>
              ) : (
                <p className="text-xs text-tx-tertiary italic">{t("sidebar.noOutline")}</p>
              )}
            </div>
          </div>

          {/* Modification History Logs */}
          <div className="p-6 border border-app-border bg-app-sidebar/10 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
              <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider">
                {t("sidebar.activityLog")}
              </h3>
              <button 
                onClick={loadPlanDetail}
                className="p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-tx-primary transition-colors"
                title={t("sidebar.refreshLogs")}
              >
                <RefreshCw size={12} className={cn(loadingLogs && "animate-spin")} />
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-tx-tertiary italic">{t("sidebar.noActivity")}</p>
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
              <span className="text-xs font-semibold text-tx-tertiary uppercase">{t("sidebar.planStatus")}</span>
              <div className="relative">
                <select
                  value={plan.status}
                  onChange={(e) => handlePlanStatusChange(e.target.value as any)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border outline-none cursor-pointer ${getStatusStyle(plan.status)}`}
                >
                  <option value="pending">{t("plans.statusToStart")}</option>
                  <option value="in_progress">{t("plans.statusInProgress")}</option>
                  <option value="completed">{t("plans.statusCompleted")}</option>
                </select>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-tx-tertiary font-mono">
                <span className="flex items-center gap-0.5">
                  <MilestoneIcon size={10} />
                  {t("sidebar.totalProgress")}
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
                <span>{t("sidebar.planCycle")}</span>
              </span>
              <span className="font-mono text-tx-primary">
                {plan.startDate || "-"} ~ {plan.endDate || "-"}
              </span>
            </div>

            {/* Participants */}
            <div className="space-y-2 border-t border-app-border/40 pt-3">
              <span className="text-xs text-tx-tertiary block font-semibold">{t("sidebar.memberCount", { count: plan.participants?.length || 0 })}</span>
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
                        (u.displayName || u.username).slice(0, 1)
                      )}
                    </div>
                    <span className="truncate max-w-[80px]">{u.displayName || u.username}</span>
                  </div>
                ))}
                {(!plan.participants || plan.participants.length === 0) && (
                  <span className="text-[10px] text-tx-tertiary italic">{t("sidebar.noMembers")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Milestones and Projects */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1">
              <MilestoneIcon size={14} className="text-accent-primary" />
              <span>{t("sidebar.milestonesAndProjects")}</span>
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
                    <option value="pending">{t("plans.statusToStart")}</option>
                    <option value="in_progress">{t("plans.statusInProgress")}</option>
                    <option value="completed">{t("plans.statusCompleted")}</option>
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
                  <span className="text-[10px] text-tx-tertiary block font-bold">{t("sidebar.relatedProject")}</span>
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
                                title={t("sidebar.removeAssociation")}
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
                      {t("sidebar.noRelatedProject")}
                    </p>
                  )}
                </div>

                {/* Associate project dropdown */}
                {unassociatedProjects.length > 0 && (
                  <div className="pt-1 flex items-center gap-1">
                    <span className="text-[9px] text-tx-tertiary shrink-0">{t("sidebar.relatedProject")}</span>
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
                      <option value="">{t("sidebar.selectProject")}</option>
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
                <p className="text-xs font-semibold">{t("common.empty")}</p>
                <p className="text-[10px]">{t("sidebar.addMilestonesHint")}</p>
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
              <h2 className="text-sm font-bold text-tx-primary">{t("plans.editPlan")}</h2>
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
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.name")}</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={t("plans.namePlaceholder")}
                  className="h-10 text-xs border-app-border w-full rounded-xl"
                  required
                />
              </div>

              {/* Background & Goal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.background")}</label>
                  <Textarea
                    value={editBackground}
                    onChange={(e) => setEditBackground(e.target.value)}
                    placeholder={t("plans.backgroundPlaceholder")}
                    className="min-h-[80px] text-xs border-app-border w-full rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.goal")}</label>
                  <Textarea
                    value={editGoal}
                    onChange={(e) => setEditGoal(e.target.value)}
                    placeholder={t("plans.goalPlaceholder")}
                    className="min-h-[80px] text-xs border-app-border w-full rounded-xl"
                  />
                </div>
              </div>

              {/* Start & End Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.startDate")}</label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full h-10 px-3 text-xs border border-app-border rounded-xl bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.endDate")}</label>
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
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.participants")}</label>
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
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.milestones")}</label>
                  <Button
                    type="button"
                    onClick={handleAddEditMilestone}
                    variant="ghost"
                    className="h-6 text-[10px] text-accent-primary hover:text-accent-primary/80 flex items-center gap-1"
                  >
                    <Plus size={10} />
                    {t("plans.addMilestone")}
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
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">{t("plans.milestoneName", { index: index + 1 })}</label>
                        <Input
                          value={ms.name}
                          onChange={(e) => handleEditMilestoneChange(index, "name", e.target.value)}
                          placeholder={t("plans.milestonePlaceholder")}
                          className="h-8 text-xs border-app-border w-full rounded-lg"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">{t("plans.milestoneDescription")}</label>
                        <Textarea
                          value={ms.description}
                          onChange={(e) => handleEditMilestoneChange(index, "description", e.target.value)}
                          placeholder={t("plans.descriptionPlaceholder")}
                          className="min-h-[50px] text-xs border-app-border w-full rounded-lg"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-tx-tertiary uppercase block mb-1">{t("plans.startDate")}</label>
                          <input
                            type="date"
                            value={ms.startDate}
                            onChange={(e) => handleEditMilestoneChange(index, "startDate", e.target.value)}
                            className="w-full h-8 px-2 text-[11px] border border-app-border rounded-lg bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-tx-tertiary uppercase block mb-1">{t("plans.endDate")}</label>
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
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.details")}</label>
                <Textarea
                  value={editDetails}
                  onChange={(e) => setEditDetails(e.target.value)}
                  placeholder={t("plans.detailsPlaceholder")}
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
                  {t("plans.cancel")}
                </Button>
                <Button
                  type="submit"
                  className="h-9 px-4 rounded-xl text-xs bg-accent-primary text-white hover:bg-accent-primary/95"
                >
                  {t("plans.save")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
