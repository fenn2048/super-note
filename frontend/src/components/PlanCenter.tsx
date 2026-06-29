import React, { useState, useEffect, useCallback } from "react";
import { Plan, User, WorkspaceMember } from "@/types";
import { api, getCurrentWorkspace } from "@/lib/api";
import { useTranslation } from "react-i18next";
import {
  Plus, Calendar, Compass, Loader2, X, FolderOpen, Play, Pause,
  Milestone as MilestoneIcon, CheckCircle2,
  Clock, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import PlanDetail from "./PlanDetail";

const PRESET_COVERS = [
  "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
];

export default function PlanCenter() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(getCurrentWorkspace());
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    api.getMe().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  // Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [planName, setPlanName] = useState("");
  const [background, setBackground] = useState("");
  const [goal, setGoal] = useState("");
  const [details, setDetails] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [milestones, setMilestones] = useState<Array<{ name: string; description: string; startDate: string; endDate: string }>>([]);

  // Workspace members
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    const handleWsChange = () => {
      setWorkspaceId(getCurrentWorkspace());
      setSelectedPlanId(null);
    };
    window.addEventListener("super:workspace-changed", handleWsChange);
    return () => window.removeEventListener("super:workspace-changed", handleWsChange);
  }, []);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPlans(workspaceId || undefined);
      setPlans(data);
    } catch (e) {
      console.error("Failed to load plans:", e);
      toast.error(t("plans.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  // Load workspace members
  useEffect(() => {
    if (workspaceId) {
      api.getWorkspaceMembers(workspaceId)
        .then(setMembers)
        .catch(() => setMembers([]));
    } else {
      if (currentUser) {
        setMembers([{
          userId: currentUser.id, workspaceId: "", role: "owner", joinedAt: "", email: "",
          username: currentUser.username,
          displayName: currentUser.displayName || null,
          avatarUrl: currentUser.avatarUrl
        }]);
      }
    }
  }, [workspaceId, currentUser]);

  // Event Listeners for Sidebar interaction
  useEffect(() => {
    const handleCreateTrigger = () => {
      setSelectedPlanId(null);
      handleOpenCreateModal();
    };
    const handleFilterChanged = () => {
      setSelectedPlanId(null);
      loadPlans();
    };

    window.addEventListener("super:create-plan-trigger", handleCreateTrigger);
    window.addEventListener("super:plan-filter-changed", handleFilterChanged);
    return () => {
      window.removeEventListener("super:create-plan-trigger", handleCreateTrigger);
      window.removeEventListener("super:plan-filter-changed", handleFilterChanged);
    };
  }, [loadPlans]);

  const handleOpenCreateModal = () => {
    setPlanName("");
    setBackground("");
    setGoal("");
    setDetails("");
    setStartDate("");
    setEndDate("");
    setSelectedParticipants(currentUser ? [currentUser.id] : []);
    setMilestones([]);
    setShowCreateModal(true);
  };

  const handleAddMilestone = () => {
    setMilestones([...milestones, { name: "", description: "", startDate: "", endDate: "" }]);
  };

  const handleRemoveMilestone = (index: number) => {
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const handleMilestoneChange = (index: number, field: string, value: string) => {
    const updated = [...milestones];
    updated[index] = { ...updated[index], [field]: value };
    setMilestones(updated);
  };

  const toggleParticipant = (userId: string) => {
    if (selectedParticipants.includes(userId)) {
      setSelectedParticipants(selectedParticipants.filter(id => id !== userId));
    } else {
      setSelectedParticipants([...selectedParticipants, userId]);
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planName.trim()) {
      toast.error(t("plans.nameRequired"));
      return;
    }

    try {
      const payload = {
        name: planName,
        background,
        goal,
        details,
        startDate: startDate || null,
        endDate: endDate || null,
        workspaceId: workspaceId || null,
        participants: selectedParticipants,
        milestones
      };
      await api.createPlan(payload);
      toast.success(t("plans.createSuccess"));
      setShowCreateModal(false);
      loadPlans();
    } catch (err: unknown) {
      toast.error((err as any)?.message || t("plans.createFailed"));
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === "paused") return "已暂停";
    if (status === "completed") return t("plans.statusCompleted");
    if (status === "in_progress") return t("plans.statusInProgress");
    return t("plans.statusToStart");
  };

  const getStatusStyle = (status: string) => {
    if (status === "paused") return "bg-amber-50 text-amber-700 border-amber-200/50";
    if (status === "completed") return "bg-green-50 text-green-700 border-green-200/50";
    if (status === "in_progress") return "bg-indigo-50 text-indigo-700 border-indigo-200/50";
    return "bg-stone-100 text-stone-600 border-stone-200/50";
  };

  const getStatusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} className="text-green-600 shrink-0" />;
    if (status === "in_progress") return <Clock size={12} className="text-indigo-600 shrink-0" />;
    if (status === "paused") return <Pause size={12} className="text-amber-600 shrink-0" />;
    return <AlertCircle size={12} className="text-stone-500 shrink-0" />;
  };

  if (selectedPlanId) {
    return (
      <PlanDetail 
        planId={selectedPlanId} 
        onBack={() => {
          setSelectedPlanId(null);
          loadPlans();
        }} 
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 overflow-y-auto">
      {/* Header */}
      <div 
        className="h-14 px-4 border-b border-app-border flex items-center justify-between shrink-0 select-none bg-app-sidebar/20"
        style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
      >
        <div className="flex items-center gap-2">
          <Compass size={18} className="text-accent-primary shrink-0" />
          <h1 className="text-base font-bold text-tx-primary">{t("plans.title")}</h1>
        </div>
        <Button
          onClick={handleOpenCreateModal}
          className="h-8 text-xs font-semibold px-3 rounded-lg bg-accent-primary hover:bg-accent-primary/95 text-white flex items-center gap-1.5"
        >
          <Plus size={14} />
          <span>{t("plans.newPlan")}</span>
        </Button>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 min-h-0 p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent-primary" />
          </div>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary h-full">
            <FolderOpen size={48} className="stroke-1 mb-2 opacity-50" />
            <p className="text-sm font-semibold">{t("plans.noPlans")}</p>
            <p className="text-xs max-w-xs">{t("plans.noPlansDesc")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto pb-12">
            {plans.map((p) => {
              const completedMilestones = p.completedMilestones || 0;
              const totalMilestones = p.totalMilestones || 0;
              const progressPercentage = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPlanId(p.id)}
                  className="group/card border border-app-border hover:border-app-border/80 bg-app-sidebar/35 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col cursor-pointer h-64 justify-between"
                >
                  {/* Top Cover Banner */}
                  <div
                    className="h-20 shrink-0 relative p-3 flex justify-between items-center"
                    style={{
                      background: PRESET_COVERS[p.name.length % PRESET_COVERS.length],
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStatusStyle(p.status)} backdrop-blur-md`}>
                      {getStatusIcon(p.status)}
                      <span>{getStatusLabel(p.status)}</span>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newStatus = p.status === "paused" ? "in_progress" : "paused";
                          api.updatePlan(p.id, { status: newStatus }).then(() => loadPlans());
                        }}
                        className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 transition-all"
                        title={p.status === "paused" ? "恢复" : "暂停"}
                      >
                        {p.status === "paused" ? <Play size={10} /> : <Pause size={10} />}
                      </button>
                    </div>
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm text-tx-primary truncate group-hover/card:text-accent-primary transition-colors">
                        {p.name}
                      </h3>
                      {p.goal && (
                        <p className="text-xs text-tx-secondary line-clamp-2 leading-relaxed">
                          {t("plans.goal")}: {p.goal}
                        </p>
                      )}
                    </div>

                    {/* Progress details */}
                    <div className="space-y-2 pt-2 shrink-0">
                      <div className="flex items-center justify-between text-[10px] text-tx-tertiary font-bold font-mono">
                        <span className="flex items-center gap-0.5">
                          <MilestoneIcon size={10} />
                          {t("plans.milestoneProgress")}
                        </span>
                        <span>
                          {completedMilestones}/{totalMilestones} ({progressPercentage}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-app-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent-primary rounded-full transition-all duration-500"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    </div>

                    {/* Timeline dates & members */}
                    <div className="flex items-center justify-between pt-3 border-t border-app-border/40 text-[10px] text-tx-tertiary font-mono">
                      <div className="flex items-center gap-1">
                        <Calendar size={11} />
                        <span>{p.startDate || "-"}</span>
                        <span>~</span>
                        <span>{p.endDate || "-"}</span>
                      </div>

                      {/* Participants */}
                      <div className="flex items-center -space-x-1.5 overflow-hidden">
                        {p.participants?.slice(0, 3).map((u) => (
                          <div 
                            key={u.userId}
                            className="w-4 h-4 rounded-full bg-accent-primary/20 border border-app-sidebar shrink-0 flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase"
                            title={u.displayName || u.username}
                          >
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                              (u.displayName || u.username).slice(0, 1)
                            )}
                          </div>
                        ))}
                        {p.participants && p.participants.length > 3 && (
                          <span className="text-[8px] pl-1 text-tx-tertiary shrink-0">+{p.participants.length - 3}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-app-sidebar border border-app-border rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-tx-primary">{t("plans.createPlan")}</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleCreatePlan} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Plan Name */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.name")}</label>
                <Input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
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
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    placeholder={t("plans.backgroundPlaceholder")}
                    className="min-h-[80px] text-xs border-app-border w-full rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.goal")}</label>
                  <Textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
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
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-10 px-3 text-xs border border-app-border rounded-xl bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.endDate")}</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-10 px-3 text-xs border border-app-border rounded-xl bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                  />
                </div>
              </div>

              {/* Participants Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.participants")}</label>
                <div className="flex flex-wrap gap-2 p-3 border border-app-border rounded-xl bg-app-bg max-h-36 overflow-y-auto">
                  {members.map((u) => {
                    const active = selectedParticipants.includes(u.userId);
                    return (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => toggleParticipant(u.userId)}
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
                    onClick={handleAddMilestone}
                    variant="ghost"
                    className="h-6 text-[10px] text-accent-primary hover:text-accent-primary/80 flex items-center gap-1"
                  >
                    <Plus size={10} />
                    {t("plans.addMilestone")}
                  </Button>
                </div>

                <div className="space-y-3">
                  {milestones.map((ms, index) => (
                    <div key={index} className="p-4 border border-app-border bg-app-bg/50 rounded-xl space-y-3 relative">
                      <button
                        type="button"
                        onClick={() => handleRemoveMilestone(index)}
                        className="absolute top-2 right-2 p-1 text-tx-tertiary hover:text-red-500 rounded-lg hover:bg-app-hover transition-colors"
                      >
                        <X size={12} />
                      </button>

                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">{t("plans.milestoneName", { index: index + 1 })}</label>
                        <Input
                          value={ms.name}
                          onChange={(e) => handleMilestoneChange(index, "name", e.target.value)}
                          placeholder={t("plans.milestonePlaceholder")}
                          className="h-8 text-xs border-app-border w-full rounded-lg"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold text-tx-tertiary uppercase block">{t("plans.milestoneDescription")}</label>
                        <Textarea
                          value={ms.description}
                          onChange={(e) => handleMilestoneChange(index, "description", e.target.value)}
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
                            onChange={(e) => handleMilestoneChange(index, "startDate", e.target.value)}
                            className="w-full h-8 px-2 text-[11px] border border-app-border rounded-lg bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-tx-tertiary uppercase block mb-1">{t("plans.endDate")}</label>
                          <input
                            type="date"
                            value={ms.endDate}
                            onChange={(e) => handleMilestoneChange(index, "endDate", e.target.value)}
                            className="w-full h-8 px-2 text-[11px] border border-app-border rounded-lg bg-app-bg text-tx-primary outline-none focus:border-accent-primary"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Long Description (Markdown Details) */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">{t("plans.details")}</label>
                <Textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={t("plans.detailsPlaceholder")}
                  className="min-h-[160px] text-xs border-app-border w-full rounded-xl font-mono leading-relaxed"
                />
              </div>

              {/* Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-app-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreateModal(false)}
                  className="h-9 px-4 rounded-xl text-xs hover:bg-app-hover"
                >
                  {t("plans.cancel")}
                </Button>
                <Button
                  type="submit"
                  className="h-9 px-4 rounded-xl text-xs bg-accent-primary text-white hover:bg-accent-primary/95"
                >
                  {t("plans.createPlan")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
