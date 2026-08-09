import { Play, Pause } from "lucide-react";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

import { Plan, Project, ProjectGroup, ProjectMember, ProjectStage, ProjectTask } from "@/types";
import { PullToRefresh } from "@/components/PullToRefresh";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn, detectSuMention } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import {
  Plus, Briefcase, Star, Search, Filter, Loader2,
  ChevronRight, ChevronDown, ChevronLeft, AlertCircle, ArrowLeft, MoreVertical, Edit2, Trash2, Eye, EyeOff, FolderOpen,
  CheckCircle2, Clock, Globe, Lock, Check, Grid, List as ListIcon, MessageSquare,
  Bookmark, Award, Circle, Bell, X, User, UserPlus, Maximize2, Menu, LayoutGrid
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { format } from "date-fns";
import { syncTaskNotification } from "@/hooks/useCapacitor";
import { useScrollHideBars } from "@/hooks/useScrollHideBars";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import SleekDatePicker from "@/components/common/SleekDatePicker";



// Import sub-views
import TaskDetailModal from "./TaskDetailModal";
const TaskAnalytics = React.lazy(() => import("./TaskAnalytics"));
const MyTasksBoard = React.lazy(() => import("./tasks/MyTasksBoard"));
const ProjectDetailShellLazy = React.lazy(() => import("./tasks/ProjectDetailShell"));
const WorkspaceCalendarViewLazy = React.lazy(() => import("./tasks/WorkspaceCalendarView"));
const PlanCenter = React.lazy(() => import("./PlanCenter"));
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
} from "@/components/common/FeedbackStates";
import MobileChromeHeader, { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";
import { Motion } from "@/components/common/Motion";
import { springs } from "@/lib/motion";
import { BottomSheet } from "@/components/common/BottomSheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const PRESET_COVERS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
  "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
];

const compressImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 400;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7)); // JPEG with 70% quality
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const ScrollContainer = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className }, ref) => {
    if (window.innerWidth < 768) {
      return (
        <div ref={ref} className={cn("overflow-y-auto min-h-0", className)}>
          {children}
        </div>
      );
    }
    return (
      <ScrollArea ref={ref} className={className}>
        {children}
      </ScrollArea>
    );
  }
);
ScrollContainer.displayName = "ScrollContainer";

export default function ProjectCenter() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  /** BottomSheet portals to body — CSS md:hidden cannot hide it; gate with JS */
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const projDescRef = useRef<HTMLTextAreaElement>(null);

  /** 编辑项目弹窗可滚动 body，用于滚到成员区 */
  const projEditScrollRef = useRef<HTMLDivElement>(null);


  const [showMobileRoleSelector, setShowMobileRoleSelector] = useState(false);
  /** 我的任务 / 项目列表滚动区：下滚隐栏，内容可占满原 Tab 区 */
  const projectsScrollRef = useRef<HTMLDivElement>(null);

  // Make workspaceId a reactive state
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Navigation Filter State (synced with Sidebar / 底栏任务入口)
  // 默认 my-tasks：移动底栏「任务」语义是待办列表，不是项目网格
  // 「事务分类」已并入「任务复盘」面板
  const [activeFilter, setActiveFilter] = useState<{ type: string; groupId?: string; projectId?: string }>(() => {
    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      const parsed = val ? JSON.parse(val) : { type: "my-tasks" };
      if (parsed?.type === "task-categories") {
        try {
          sessionStorage.setItem("super-analytics-panel", "categories");
          sessionStorage.setItem("super-active-project-filter", JSON.stringify({ type: "analytics" }));
        } catch { /* ignore */ }
        return { type: "analytics" };
      }
      return parsed?.type ? parsed : { type: "my-tasks" };
    } catch {
      return { type: "my-tasks" };
    }
  });

  // Current active project details
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);
  const [detailTab, setDetailTab] = useState<"kanban" | "list" | "discussion" | "calendar" | "gantt" | "overview">("kanban");
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Global Aggregated Views
  const [wsMembers, setWsMembers] = useState<any[]>([]);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchMode, setProjectSearchMode] = useState<"AND" | "OR">("AND");
  const [selectedProjectTagId, setSelectedProjectTagId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [centerActiveTask, setCenterActiveTask] = useState<ProjectTask | null>(null);

  // 移动端：项目网格下滚隐藏底栏与 FAB（我的任务由 MyTasksBoard 自理）
  useScrollHideBars(
    projectsScrollRef,
    activeFilter.type !== "my-tasks" &&
      activeFilter.type !== "detail" &&
      activeFilter.type !== "plans" &&
      activeFilter.type !== "calendar" &&
      activeFilter.type !== "analytics",
    [activeFilter.type, projects.length],
  );

  // 监听来自全局的任务打开事件
  useEffect(() => {
    const handleOpenTask = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const taskId = customEvent.detail;
      if (taskId) {
        if (activeFilter.type === "detail" && detailTab === "kanban") {
          setActiveTaskId(taskId);
        } else {
          try {
            const taskDetails = await api.getProjectTask(taskId);
            setCenterActiveTask(taskDetails);
          } catch (err) {
            console.error("Failed to load task details:", err);
            toast.error("加载任务详情失败");
          }
        }
      }
    };
    window.addEventListener("super:open-project-task", handleOpenTask);
    return () => window.removeEventListener("super:open-project-task", handleOpenTask);
  }, [activeFilter.type, detailTab]);

  // 监听来自 Sidebar 的任务搜索状态变化
  useEffect(() => {
    const handleProjectSearchChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ query: string }>;
      if (customEvent.detail?.query !== undefined) {
        setProjectSearchQuery(customEvent.detail.query);
      }
    };
    window.addEventListener("super:project-search-changed", handleProjectSearchChange);
    return () => window.removeEventListener("super:project-search-changed", handleProjectSearchChange);
  }, []);





  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  // Create/Edit form fields
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projCover, setProjCover] = useState(PRESET_COVERS[0]);
  const [projStart, setProjStart] = useState("");
  const [projEnd, setProjEnd] = useState("");
  const [projVisibility, setProjVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [projGroupId, setProjGroupId] = useState<string | null>(null);
  const [projPlanId, setProjPlanId] = useState<string | null>(null);
  const [projMilestoneId, setProjMilestoneId] = useState<string | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  /** 编辑项目时的成员列表 */
  const [projMembers, setProjMembers] = useState<ProjectMember[]>([]);
  const [projMembersLoading, setProjMembersLoading] = useState(false);
  const [projMemberBusy, setProjMemberBusy] = useState(false);
  const [projAddUserId, setProjAddUserId] = useState("");
  /** 编辑中项目是否为个人TODO（禁止加人） */
  const [editingIsPersonalTodo, setEditingIsPersonalTodo] = useState(false);
  const [editingOwnerId, setEditingOwnerId] = useState<string>("");
  /** 添加成员：搜索关键词 + 候选列表 */
  const [memberSearchQ, setMemberSearchQ] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<
    Array<{ userId: string; username: string; displayName?: string | null; email?: string | null; avatarUrl?: string | null }>
  >([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);

  // Star / Favorite toggle helper
  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let updated: string[];
    if (isFavorite(id)) {
      updated = favorites.filter((fav) => fav !== id);
    } else {
      updated = [...favorites, id];
    }
    setFavorites(updated);
    localStorage.setItem("super-fav-projects", JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("super:project-favorite-toggled"));
  };

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const u = await api.getMe();
      setCurrentUserId(u.id);

      const favs = JSON.parse(localStorage.getItem("super-fav-projects") || "[]");
      setFavorites(favs);

      const gs = await api.getProjectGroups(workspaceId);
      setGroups(gs);
      const plans = await api.getPlans(workspaceId);
      setAvailablePlans(plans);

      let ps = await api.getProjects(workspaceId, "active");

      // 任何工作区都要有自己的个人TODO（owner=自己、PRIVATE、不挂 workspace）
      // 后端 list/login 也会 ensure；这里再兜底一次，避免旧后端或缓存导致缺失
      const hasPersonalTodo = ps.some(
        (p) =>
          p.name === "个人TODO" &&
          (!p.workspaceId || p.workspaceId === ""),
      );
      if (!hasPersonalTodo) {
        try {
          await api.createProject({
            name: "个人TODO",
            description: "个人待办事项项目",
            cover: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            workspaceId: null,
            visibility: "PRIVATE",
          });
          ps = await api.getProjects(workspaceId, "active");
        } catch (createErr) {
          console.error("Failed to auto-create 个人TODO:", createErr);
        }
      }

      setProjects(ps);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Sync state filter from Sidebar / 底栏；挂载时再读 sessionStorage，
  // 避免冷启动懒加载时错过 openTasksEntry 派发的事件。
  useEffect(() => {
    const normalizeFilter = (raw: { type: string; groupId?: string; projectId?: string }) => {
      if (raw?.type === "task-categories") {
        try {
          sessionStorage.setItem("super-analytics-panel", "categories");
        } catch { /* ignore */ }
        window.dispatchEvent(
          new CustomEvent("super:analytics-panel", { detail: { panel: "categories" } }),
        );
        return { type: "analytics" };
      }
      return raw;
    };

    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      if (val) {
        const parsed = JSON.parse(val);
        if (parsed?.type) setActiveFilter(normalizeFilter(parsed));
      }
    } catch { /* ignore */ }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setActiveFilter(normalizeFilter(customEvent.detail));
      }
    };
    window.addEventListener("super:project-filter-changed", handler);
    return () => window.removeEventListener("super:project-filter-changed", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ tagId?: string | null }>;
      setSelectedProjectTagId(customEvent.detail?.tagId ?? null);
    };
    window.addEventListener("super:project-tag-filter-changed", handler);
    return () => window.removeEventListener("super:project-tag-filter-changed", handler);
  }, []);

  // Listen to workspace change events to reload data reactively
  useEffect(() => {
    const handleWorkspaceChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const wsId = customEvent.detail?.workspaceId || getCurrentWorkspace();
      setWorkspaceId(wsId);
    };
    window.addEventListener("super:workspace-changed", handleWorkspaceChange);
    return () => window.removeEventListener("super:workspace-changed", handleWorkspaceChange);
  }, []);

  // Listen to projects-refreshed events to reload dashboard dynamically
  useEffect(() => {
    const handleRefresh = () => {
      fetchDashboard();
    };
    window.addEventListener("super:projects-refreshed", handleRefresh);
    return () => window.removeEventListener("super:projects-refreshed", handleRefresh);
  }, [fetchDashboard]);

  // Fetch Project Details when activeFilter changes or selection is made
  useEffect(() => {
    if (activeFilter.type === "detail" && activeFilter.projectId) {
      setLoadingDetail(true);
      Promise.all([
        api.getProject(activeFilter.projectId),
        api.getProjectStages(activeFilter.projectId),
      ])
        .then(([proj, stages]) => {
          setSelectedProject(proj);
          setProjectStages(stages);
        })
        .catch((err) => {
          console.error(err);
          toast.error("加载项目详情失败");
          // Revert to dashboard
          sessionStorage.setItem("super-active-project-filter", JSON.stringify({ type: "all" }));
          window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: { type: "all" } }));
        })
        .finally(() => setLoadingDetail(false));
    } else {
      setSelectedProject(null);
      setProjectStages([]);
    }
  }, [activeFilter]);

  // Load workspace members
  useEffect(() => {
    if (workspaceId && workspaceId !== "personal") {
      api.getWorkspaceMembers(workspaceId)
        .then((members) => {
          setWsMembers(members);
        })
        .catch(console.error);
    } else {
      setWsMembers([]);
    }
  }, [workspaceId]);

  // 编辑弹窗：合并「工作区成员 + 用户搜索」作为添加候选（可按关键词过滤）
  useEffect(() => {
    if (!showCreateModal || !isEditingProject || editingIsPersonalTodo) {
      setMemberCandidates([]);
      setMemberSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMemberSearchLoading(true);
      const q = memberSearchQ.trim();
      const fromWs = (wsMembers || []).map((w: any) => ({
        userId: String(w.userId || w.id || ""),
        username: w.username || "",
        displayName: w.displayName ?? null,
        email: w.email ?? null,
        avatarUrl: w.avatarUrl ?? null,
      })).filter((c) => c.userId);

      const me = currentUserId;
      const matchQ = (name: string, username: string, email?: string | null) => {
        if (!q) return true;
        const s = q.toLowerCase();
        return (
          (name || "").toLowerCase().includes(s) ||
          (username || "").toLowerCase().includes(s) ||
          (email || "").toLowerCase().includes(s)
        );
      };

      api
        .searchUsers(q)
        .then((users) => {
          if (cancelled) return;
          const fromSearch = (users || []).map((u) => ({
            userId: u.id,
            username: u.username,
            displayName: u.displayName,
            email: (u as any).email ?? null,
            avatarUrl: u.avatarUrl,
          }));
          const map = new Map<string, (typeof fromWs)[0]>();
          for (const c of [...fromWs, ...fromSearch]) {
            if (!c.userId || c.userId === me) continue;
            if (!matchQ(c.displayName || "", c.username, c.email)) continue;
            if (!map.has(c.userId)) map.set(c.userId, c);
          }
          setMemberCandidates(Array.from(map.values()));
        })
        .catch(() => {
          if (cancelled) return;
          // 搜索失败时至少展示工作区成员
          setMemberCandidates(
            fromWs.filter(
              (c) =>
                c.userId !== me &&
                matchQ(c.displayName || "", c.username, c.email),
            ),
          );
        })
        .finally(() => {
          if (!cancelled) setMemberSearchLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    showCreateModal,
    isEditingProject,
    editingIsPersonalTodo,
    wsMembers,
    currentUserId,
    memberSearchQ,
  ]);

  const triggerStatsRefresh = () => {
    try {
      window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
    } catch {}
  };

  const refreshCurrentView = async () => {
    if (activeFilter.type === "detail" && activeFilter.projectId) {
      try {
        const stages = await api.getProjectStages(activeFilter.projectId);
        setProjectStages(stages);
      } catch (err) {
        console.error(err);
      }
    }
    // calendar 视图自管 refresh（WorkspaceCalendarView）
  };

  const taskMatchesProjectFilters = (task: ProjectTask) => {
    const query = projectSearchQuery.trim().toLowerCase();
    if (query) {
      const terms = query.split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        const matches = terms.map((term) => {
          if (term.startsWith("#")) {
            const tagSearch = term.substring(1);
            return task.tags?.some((tag) => tag.name.toLowerCase().includes(tagSearch)) || false;
          } else {
            const title = task.title?.toLowerCase() || "";
            const description = task.description?.toLowerCase() || "";
            const projectName = ((task as any).projectName || "").toLowerCase();
            return title.includes(term) || description.includes(term) || projectName.includes(term);
          }
        });
        
        if (projectSearchMode === "AND") {
          if (!matches.every(Boolean)) return false;
        } else {
          if (!matches.some(Boolean)) return false;
        }
      }
    }
    if (selectedProjectTagId) {
      if (!task.tags?.some((tag) => tag.id === selectedProjectTagId)) {
        return false;
      }
    }
    return true;
  };



  const filteredProjectStages = useMemo(() => {
    if (!projectSearchQuery && !selectedProjectTagId) {
      return projectStages;
    }
    return projectStages
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks?.filter(taskMatchesProjectFilters),
      }))
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks || [],
      }));
  }, [projectStages, projectSearchQuery, selectedProjectTagId, projectSearchMode]);

  const selectProject = (id: string) => {
    const filter = { type: "detail", projectId: id };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  const closeProjectDetail = () => {
    const filter = { type: "all" };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  const handleOpenCreateModal = () => {
    setIsEditingProject(false);
    setEditingProjectId(null);
    setProjName("");
    setProjDesc("");
    setProjCover(PRESET_COVERS[0]);
    setProjStart("");
    setProjEnd("");
    setProjVisibility("PRIVATE");
    if (activeFilter.type === "group" && activeFilter.groupId) {
      setProjGroupId(activeFilter.groupId);
    } else {
      setProjGroupId(null);
    }
    setProjPlanId(null);
    setProjMilestoneId(null);
    setProjMembers([]);
    setProjAddUserId("");
    setEditingIsPersonalTodo(false);
    setEditingOwnerId("");
    setShowCreateModal(true);
  };

  const resolveMeId = useCallback(async (): Promise<string> => {
    if (currentUserId) return currentUserId;
    try {
      const u = await api.getMe();
      setCurrentUserId(u.id);
      return u.id;
    } catch {
      return "";
    }
  }, [currentUserId]);

  const isProjectOwner = useMemo(() => {
    if (!currentUserId) return false;
    if (editingOwnerId && currentUserId === editingOwnerId) return true;
    return projMembers.some(
      (m) => m.userId === currentUserId && (m.role === "owner" || (m as any).role === "admin"),
    );
  }, [currentUserId, editingOwnerId, projMembers]);

  const loadProjectMembers = async (projectId: string) => {
    setProjMembersLoading(true);
    try {
      const me = await resolveMeId();
      const full = await api.getProject(projectId);
      let members = [...(full.members || [])];
      // 兜底：owner 不在 members 表时补上，便于展示与权限判断
      const ownerId = full.ownerId || "";
      if (ownerId && !members.some((m) => m.userId === ownerId)) {
        members = [
          {
            userId: ownerId,
            role: "owner",
            username: full.ownerName || "owner",
            displayName: full.ownerDisplayName || null,
            avatarUrl: null,
          },
          ...members,
        ];
      }
      setProjMembers(members);
      setEditingOwnerId(ownerId || me);
      setEditingIsPersonalTodo(
        full.name === "个人TODO" && (!full.workspaceId || full.workspaceId === ""),
      );
      if (selectedProject?.id === projectId) {
        setSelectedProject({ ...full, members });
      }
    } catch (err) {
      console.error(err);
      toast.error("加载项目成员失败");
    } finally {
      setProjMembersLoading(false);
    }
  };

  const handleAddProjectMember = async (userId?: string) => {
    const targetUserId = userId || projAddUserId;
    if (!editingProjectId || !targetUserId || projMemberBusy) return;
    if (editingIsPersonalTodo) {
      toast.error("个人TODO 仅自己可见，不可添加成员");
      return;
    }
    const me = await resolveMeId();
    if (!me) {
      toast.error("无法识别当前用户，请刷新后重试");
      return;
    }
    if (editingOwnerId && me !== editingOwnerId && !isProjectOwner) {
      toast.error("仅项目所有者可添加成员");
      return;
    }
    setProjMemberBusy(true);
    try {
      await api.addProjectMember(editingProjectId, targetUserId, "member");
      toast.success("已添加成员");
      setProjAddUserId("");
      setMemberSearchQ("");
      await loadProjectMembers(editingProjectId);
    } catch (err: any) {
      toast.error(err?.message || "添加成员失败");
    } finally {
      setProjMemberBusy(false);
    }
  };

  const handleRemoveProjectMember = async (memberUserId: string, label: string) => {
    if (!editingProjectId || projMemberBusy) return;
    if (memberUserId === editingOwnerId) {
      toast.error("不能移除项目所有者");
      return;
    }
    const me = await resolveMeId();
    // 所有者可移除他人；成员可自行退出
    if (me !== editingOwnerId && me !== memberUserId && !isProjectOwner) {
      toast.error("无权移除该成员");
      return;
    }
    if (!confirm(`确定将「${label}」移出项目吗？`)) return;
    setProjMemberBusy(true);
    try {
      await api.removeProjectMember(editingProjectId, memberUserId);
      toast.success(me === memberUserId ? "已退出项目" : "已移除成员");
      await loadProjectMembers(editingProjectId);
    } catch (err: any) {
      toast.error(err?.message || "移除成员失败");
    } finally {
      setProjMemberBusy(false);
    }
  };

  useEffect(() => {
    const handleTrigger = () => {
      handleOpenCreateModal();
    };
    window.addEventListener("super:create-project-trigger", handleTrigger);

    if (sessionStorage.getItem("super-pending-create-project") === "1") {
      sessionStorage.removeItem("super-pending-create-project");
      handleOpenCreateModal();
    }

    return () => {
      window.removeEventListener("super:create-project-trigger", handleTrigger);
    };
  }, [workspaceId, activeFilter]);

  const handleOpenEditModal = (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingProject(true);
    setEditingProjectId(proj.id);
    setProjName(proj.name);
    setProjDesc(proj.description || "");
    setProjCover(proj.cover || PRESET_COVERS[0]);
    setProjStart(proj.startDate ? proj.startDate.split("T")[0] : "");
    setProjEnd(proj.endDate ? proj.endDate.split("T")[0] : "");
    setProjVisibility(proj.visibility);
    setProjGroupId(proj.groupId);
    setProjMilestoneId(proj.milestoneId || null);
    // Find planId from milestone
    const plan = availablePlans.find(p => p.milestones?.some(m => m.id === proj.milestoneId));
    setProjPlanId(plan ? plan.id : null);
    setProjMembers(proj.members || []);
    setProjAddUserId("");
    setMemberSearchQ("");
    setEditingOwnerId(proj.ownerId || "");
    setEditingIsPersonalTodo(
      proj.name === "个人TODO" && (!proj.workspaceId || proj.workspaceId === ""),
    );
    setShowCreateModal(true);
    void resolveMeId();
    // 列表项可能不带 members，再拉一次完整详情
    void loadProjectMembers(proj.id);
    // 打开后滚到「项目成员」，避免表单过长时底部成员区不可见
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        const root = projEditScrollRef.current;
        const members = document.getElementById("project-edit-members");
        if (members && root) {
          members.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if (root) {
          root.scrollTop = root.scrollHeight;
        }
      }, 80);
    });
  };

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await compressImageToBase64(file);
      setProjCover(base64);
    } catch (err) {
      console.error(err);
      toast.error("读取封面图片失败");
    }
  };

  const handleCreateOrEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim()) {
      toast.error("项目名称不能为空");
      return;
    }

    const payload = {
      name: projName.trim(),
      description: projDesc.trim(),
      cover: projCover,
      startDate: projStart ? new Date(projStart).toISOString() : null,
      endDate: projEnd ? new Date(projEnd).toISOString() : null,
      visibility: projVisibility,
      groupId: projGroupId,
      milestoneId: projMilestoneId,
    };

    try {
      if (isEditingProject && editingProjectId) {
        await api.updateProject(editingProjectId, payload);
        toast.success("编辑成功");
      } else {
        await api.createProject(payload);
        toast.success("创建成功");
      }
      setShowCreateModal(false);
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "操作项目失败");
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除此项目吗？")) return;
    try {
      await api.deleteProject(id);
      toast.success("删除成功");
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "删除项目失败");
    }
  };

  const handleToggleTaskComplete = async (taskId: string, currentCompleted: number) => {
    try {
      const isCompleted = currentCompleted === 1 ? 0 : 1;
      const progress = isCompleted === 1 ? 100 : 0;
      const payload: any = { isCompleted, progress };

      // 项目详情内：用当前选中项目；否则从详情缓存任务取 projectId
      let taskProjId = selectedProject?.id || centerActiveTask?.projectId;
      if (taskProjId && centerActiveTask?.id !== taskId) {
        // centerActiveTask 可能是别的任务；优先 selectedProject
        taskProjId = selectedProject?.id || taskProjId;
      }

      if (taskProjId) {
        const stages = await api.getProjectStages(taskProjId);
        if (isCompleted === 1) {
          let completedStage = stages.find(s => s.name === "已完成");
          if (!completedStage) {
            completedStage = await api.createProjectStage(taskProjId, { name: "已完成" });
          }
          payload.stageId = completedStage.id;
          payload.status = "completed";
        } else {
          // 重新打开 → 待启动（需再次点「开始」才记 in_progress，复盘更准）
          let notStarted =
            stages.find((s) => s.name === "待启动") ||
            stages.find((s) => s.name === "待规划");
          if (!notStarted) {
            notStarted = await api.createProjectStage(taskProjId, { name: "待启动" });
          }
          payload.stageId = notStarted.id;
          payload.status = "pending";
        }
      }

      const updated = await api.updateProjectTask(taskId, payload);
      triggerStatsRefresh();

      // 周期任务：后端返回 nextOccurrence 时立刻调度本地通知并提示
      const nextOcc = (updated as any)?.nextOccurrence;
      if (nextOcc) {
        if (nextOcc.remindAt) {
          void syncTaskNotification(nextOcc as any);
        }
        const dueLabel = (nextOcc.endDate || nextOcc.dueDate || "").toString().slice(0, 10);
        toast.success(dueLabel ? `已生成下期任务（${dueLabel}）` : "已生成下期任务");
      } else if (
        isCompleted === 1 &&
        (updated as any)?.isRecurring &&
        (updated as any)?.recurrence &&
        !(updated as any).recurrence.created &&
        (updated as any).recurrence.reason &&
        (updated as any).recurrence.reason !== "not_recurring" &&
        (updated as any).recurrence.reason !== "past_recurrence_end"
      ) {
        toast.error(`周期任务未能生成下期：${(updated as any).recurrence.reason}`);
      }

      // Re-fetch project details stages
      if (selectedProject) {
        const stages = await api.getProjectStages(selectedProject.id);
        setProjectStages(stages);
      }
      // Re-fetch aggregated views if active
      if (activeFilter.type === "my-tasks") {
        /* my-tasks 由 MyTasksBoard 自刷新 */
      }

      // We must fully refresh current view to properly get generated tasks if it's recurring.
      refreshCurrentView();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "操作失败");
    }
  };



  const handleTogglePauseProject = async (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = proj.status === "paused" ? "in_progress" : "paused";
    try {
      await api.updateProject(proj.id, { status: newStatus });
      toast.success(newStatus === "paused" ? "已暂停项目" : "已恢复项目");
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "操作失败");
    }
  };


  // Filter projects by group selected in Sidebar
  const filteredProjects = useMemo(() => {
    if (activeFilter.type === "group" && activeFilter.groupId) {
      return projects.filter((p) => p.groupId === activeFilter.groupId);
    }
    return projects;
  }, [projects, activeFilter]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-bg select-none">
      {/* 1. Project Detail View */}
      {/* 1. Project Detail View */}
      {selectedProject ? (
        <React.Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={22} className="animate-spin text-accent-primary" />
            </div>
          }
        >
        <ProjectDetailShellLazy
          project={selectedProject}
          filteredStages={filteredProjectStages}
          loadingDetail={loadingDetail}
          detailTab={detailTab}
          setDetailTab={setDetailTab}
          wsMembers={wsMembers}
          isFavorite={isFavorite(selectedProject.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedProject.id, e)}
          onClose={closeProjectDetail}
          onEdit={(e) =>
            handleOpenEditModal(
              selectedProject,
              (e || ({ stopPropagation: () => {} } as React.MouseEvent)),
            )
          }
          onToggleTaskComplete={handleToggleTaskComplete}
          activeTaskId={activeTaskId}
          onClearActiveTaskId={() => setActiveTaskId(null)}
          onRefreshStages={async () => {
            const stages = await api.getProjectStages(selectedProject.id);
            setProjectStages(stages);
          }}
          onRefresh={refreshCurrentView}
        />
        </React.Suspense>
      ) : activeFilter.type === "plans" ? (
        /* 2a. Plans list (P1-2：并入任务壳，不再独立 viewMode) */
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-accent-primary" />
              </div>
            }
          >
            <PlanCenter />
          </React.Suspense>
        </div>
      ) : activeFilter.type === "analytics" ? (
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-accent-primary" />
              </div>
            }
          >
            <TaskAnalytics />
          </React.Suspense>
        </div>
      ) : activeFilter.type === "my-tasks" ? (
        <React.Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center min-h-0">
              <Loader2 size={22} className="animate-spin text-accent-primary" />
            </div>
          }
        >
          <MyTasksBoard
            projects={projects}
            currentUserId={currentUserId}
            workspaceId={workspaceId || ""}
            wsMembers={wsMembers}
            favorites={favorites}
            onOpenTask={(task) => setCenterActiveTask(task)}
          />
        </React.Suspense>
      ) : activeFilter.type === "calendar" ? (
        /* 3. Global workspace calendar（独立懒加载） */
        <React.Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center min-h-0">
              <Loader2 size={22} className="animate-spin text-accent-primary" />
            </div>
          }
        >
          <WorkspaceCalendarViewLazy
            projects={projects}
            workspaceId={workspaceId || ""}
            onBack={() => {
              const filter = { type: "my-tasks" };
              setActiveFilter(filter);
              try {
                sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
              } catch { /* ignore */ }
              window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
            }}
          />
        </React.Suspense>
      ) : (
        /* 4. Projects Dashboard Grid View */
        <div className="flex-1 flex flex-col h-full overflow-hidden select-text">
          {(() => {
            const gridTitle =
              activeFilter.type === "group"
                ? groups.find((g) => g.id === activeFilter.groupId)?.name
                : t("projects.myProjects") || "我的项目";
            const createBtn = (
              <Button
                onClick={handleOpenCreateModal}
                size="sm"
                className="font-semibold"
              >
                <Plus size={14} />
                <span>{t("projects.createProject") || "新建项目"}</span>
              </Button>
            );
            return (
              <>
                <MobileChromeHeader
                  variant="bare"
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Briefcase size={18} className="text-accent-primary shrink-0" />
                      {gridTitle}
                    </span>
                  }
                  right={createBtn}
                />
                <PageHeader
                  mdOnly
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Briefcase size={18} className="text-accent-primary" />
                      {gridTitle}
                    </span>
                  }
                  actions={createBtn}
                />
              </>
            );
          })()}

          {/* Project Cards Grid Scroll */}
          <ScrollContainer className="flex-1 min-h-0 p-4 md:p-6" ref={projectsScrollRef}>
            {loading ? (
              <LoadingBlock label={t("common.loading") || "加载中…"} />
            ) : filteredProjects.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title={t("projects.noProjects") || "暂无项目"}
                description={t("projects.noProjectsDesc") || "点击右上角「新建项目」开始吧！"}
                action={
                  <EmptyActionButton onClick={handleOpenCreateModal}>
                    <Plus size={14} />
                    {t("projects.createProject") || "新建项目"}
                  </EmptyActionButton>
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto pb-12">
                {filteredProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => selectProject(p.id)}
                    className="group/card border border-app-border hover:border-app-border/80 bg-app-sidebar/35 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-[transform,opacity,background-color,box-shadow,border-color] duration-panel flex flex-col cursor-pointer h-60"
                  >
                    {/* Project Cover Banner */}
                    <div
                      className="h-24 shrink-0 relative p-3 flex justify-between items-start"
                      style={{
                        background: p.cover || PRESET_COVERS[0],
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {/* Left Side: visibility status */}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-black/30 backdrop-blur-md text-white border border-white/10 select-none">
                        {p.visibility === "PUBLIC" ? <Globe size={10} /> : <Lock size={10} />}
                        <span>{p.visibility === "PUBLIC" ? "公开" : "私有"}</span>
                      </span>

                      {/* Right Side Card Controls */}
                      <div className="flex items-center gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleTogglePauseProject(p, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                          title={p.status === "paused" ? "恢复" : "暂停"}
                        >
                          {p.status === "paused" ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                        <button
                          onClick={(e) => toggleFavorite(p.id, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 hover:border-accent-primary/50 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                        >
                          <Star size={12} className={isFavorite(p.id) ? "fill-accent-primary text-accent-primary" : ""} />
                        </button>
                        <button
                          onClick={(e) => handleOpenEditModal(p, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(p.id, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-danger border border-white/10 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Card Content info */}
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div className="space-y-1">
                        <h3 className={cn("font-bold text-sm text-tx-primary truncate group-hover/card:text-accent-primary transition-colors", p.status === "paused" && "opacity-60")}>
                          {p.name}
                          {p.status === "paused" && (
                            <span className="ml-2 px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] rounded-md border border-amber-500/20">
                              已暂停
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-tx-tertiary line-clamp-2 leading-relaxed">
                          {p.description || t("projects.noDescription") || "暂无项目描述"}
                        </p>
                      </div>

                      {/* Progress bar info */}
                      <div className="space-y-2 pt-2 shrink-0">
                        <div className="flex items-center justify-between text-[10px] text-tx-tertiary font-bold font-mono">
                          <span>{t("projects.progress") || "进度"}</span>
                          <span>
                            {p.completedTasksCount || 0}/{p.totalTasksCount || 0}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-app-hover rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-primary rounded-full transition-[width] duration-panel ease-out"
                            style={{
                              width: `${
                                p.totalTasksCount && p.totalTasksCount > 0
                                  ? Math.round(((p.completedTasksCount || 0) / p.totalTasksCount) * 100)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollContainer>
        </div>
      )}

      {/* 5. Create / Edit Project Modal
          使用原生 overflow-y-auto（不用 Radix ScrollArea）：在 flex + max-h 弹窗里
          ScrollArea 常算不出高度，导致底部「项目成员」滚不到 / 被 footer 挡住。 */}
      {showCreateModal &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 select-text">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <form
            onSubmit={handleCreateOrEditProject}
            className="relative bg-app-card text-tx-primary w-full max-w-lg rounded-2xl border border-app-border shadow-2xl flex flex-col min-h-0 max-h-[min(90dvh,720px)] overflow-hidden animate-in scale-in duration-200"
          >
            {/* Header */}
            <div className="px-5 sm:px-6 py-3.5 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">
                {isEditingProject ? t("projects.editProject") || "编辑项目" : t("projects.createProject") || "新建项目"}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body：flex-1 + min-h-0 + overflow-y-auto 才能滚到成员区 */}
            <div
              ref={projEditScrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <div className="space-y-4 pb-2">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.name") || "项目名称"}</label>
                <Input
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder={t("projects.projNamePlaceholder") || "输入项目名称…"}
                  className="h-9 text-xs border-app-border"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.description") || "任务描述"}</label>
                <TextareaFormatToolbar
                  textareaRef={projDescRef}
                  value={projDesc}
                  onChange={setProjDesc}
                />
                <Textarea
                  ref={projDescRef}
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder={t("projects.projDescPlaceholder") || "输入任务描述信息…"}
                  className="text-xs leading-relaxed min-h-[72px] max-h-32 border-app-border rounded-xl"
                />
              </div>

              {/* Cover selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.cover") || "项目封面"}</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COVERS.map((cov, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setProjCover(cov)}
                      style={{ background: cov }}
                      className={`w-8 h-8 rounded-lg border transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out ${
                        projCover === cov ? "border-accent-primary scale-110 shadow-md" : "border-white/10"
                      }`}
                    />
                  ))}
                  <label className="w-8 h-8 rounded-lg border border-dashed border-app-border hover:border-app-border/80 flex items-center justify-center cursor-pointer text-tx-tertiary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0">
                    <Plus size={14} />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadCover}
                      className="hidden"
                    />
                  </label>
                </div>
                <div
                  className="w-full h-14 rounded-xl border border-app-border/60"
                  style={{ background: projCover, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              </div>

              {/* Date fields row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.startDate") || "开始时间"}</label>
                  <SleekDatePicker
                    value={projStart}
                    onChange={setProjStart}
                    className="w-full"
                    placeholder="选择开始时间"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.endDate") || "结束时间"}</label>
                  <SleekDatePicker
                    value={projEnd}
                    onChange={setProjEnd}
                    className="w-full"
                    placeholder="选择结束时间"
                  />
                </div>
              </div>

              {/* Group & Visibility */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.group") || "项目分组"}</label>
                  <select
                    value={projGroupId || ""}
                    onChange={(e) => setProjGroupId(e.target.value || null)}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                  >
                    <option value="">{t("projects.noGroup") || "不设分组"}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.visibility") || "可见范围"}</label>
                  <select
                    value={projVisibility}
                    onChange={(e) => setProjVisibility(e.target.value as any)}
                    disabled={editingIsPersonalTodo}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary disabled:opacity-50"
                  >
                    <option value="PRIVATE">{t("projects.private") || "私有：仅项目成员可见"}</option>
                    <option value="PUBLIC">{t("projects.public") || "公开：工作区全员可见"}</option>
                  </select>
                </div>
              </div>

              {/* Plan & Milestone Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">所属规划方案</label>
                  <select
                    value={projPlanId || ""}
                    onChange={(e) => {
                      setProjPlanId(e.target.value || null);
                      setProjMilestoneId(null);
                    }}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                  >
                    <option value="">不归属任何规划</option>
                    {availablePlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">归属里程碑</label>
                  <select
                    value={projMilestoneId || ""}
                    onChange={(e) => setProjMilestoneId(e.target.value || null)}
                    disabled={!projPlanId}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary disabled:opacity-50"
                  >
                    <option value="">不归属里程碑</option>
                    {projPlanId &&
                      availablePlans
                        .find((p) => p.id === projPlanId)
                        ?.milestones?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                  </select>
                </div>
              </div>

              {/* 项目成员管理（仅编辑已有项目时） */}
              {isEditingProject && editingProjectId && (
                <div
                  id="project-edit-members"
                  className="space-y-3 pt-3 border-t border-app-border scroll-mt-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                      <UserPlus size={13} className="text-accent-primary" />
                      {t("projects.members") || "项目成员"}
                      <span className="text-tx-tertiary font-normal normal-case">
                        ({projMembers.length})
                      </span>
                    </label>
                    {projMembersLoading && (
                      <Loader2 size={14} className="animate-spin text-tx-tertiary" />
                    )}
                  </div>

                  {editingIsPersonalTodo ? (
                    <p className="text-[11px] text-tx-tertiary leading-relaxed bg-app-hover/50 rounded-lg px-3 py-2">
                      「个人TODO」仅自己可见、不可添加/移除成员。请编辑其他协作项目来管理成员。
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1 max-h-52 overflow-y-auto overscroll-contain rounded-xl border border-app-border/60 bg-app-sidebar/20 p-1.5">
                        {projMembers.length === 0 && !projMembersLoading && (
                          <p className="text-[11px] text-tx-tertiary py-3 text-center">
                            {t("projects.noMembers") || "暂无成员"}
                          </p>
                        )}
                        {projMembers.map((m) => {
                          const label = m.displayName || m.username || m.userId;
                          const isOwnerRow =
                            m.role === "owner" || m.userId === editingOwnerId;
                          const canRemove =
                            !isOwnerRow &&
                            !!currentUserId &&
                            (isProjectOwner || currentUserId === m.userId);
                          return (
                            <div
                              key={m.userId}
                              className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-app-hover/70"
                            >
                              {m.avatarUrl ? (
                                <img
                                  src={m.avatarUrl}
                                  alt={label}
                                  className="w-8 h-8 rounded-full object-cover border border-app-border shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-accent-primary/15 text-accent-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                                  {(label || "?").slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-tx-primary truncate">
                                  {label}
                                  {m.userId === currentUserId && (
                                    <span className="ml-1 text-[10px] text-tx-tertiary font-normal">
                                      (我)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-tx-tertiary">
                                  {isOwnerRow
                                    ? t("projects.ownerRole") || "项目所有者"
                                    : t("projects.memberRole") || "成员"}
                                </div>
                              </div>
                              {canRemove && (
                                <button
                                  type="button"
                                  disabled={projMemberBusy}
                                  onClick={() =>
                                    void handleRemoveProjectMember(m.userId, label)
                                  }
                                  className="px-2 py-1 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                  title={
                                    currentUserId === m.userId
                                      ? "退出项目"
                                      : "移除成员"
                                  }
                                >
                                  {currentUserId === m.userId ? "退出" : "移除"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isProjectOwner ? (
                        <div className="space-y-2 rounded-xl border border-app-border/60 p-3 bg-app-elevated">
                          <div className="text-[11px] font-semibold text-tx-secondary">
                            添加成员
                          </div>
                          <div className="relative">
                            <Search
                              size={13}
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary"
                            />
                            <Input
                              value={memberSearchQ}
                              onChange={(e) => setMemberSearchQ(e.target.value)}
                              placeholder="搜索用户名 / 昵称…"
                              className="h-9 pl-8 text-xs border-app-border"
                              disabled={projMemberBusy}
                            />
                            {memberSearchLoading && (
                              <Loader2
                                size={13}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-tx-tertiary"
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={projAddUserId}
                              onChange={(e) => setProjAddUserId(e.target.value)}
                              className="sleek-select flex-1 h-9 px-3 text-xs text-tx-secondary min-w-0"
                              disabled={projMemberBusy}
                            >
                              <option value="">
                                {memberCandidates.filter(
                                  (c) =>
                                    !projMembers.some((pm) => pm.userId === c.userId),
                                ).length === 0
                                  ? "输入关键词搜索用户…"
                                  : "选择要添加的用户…"}
                              </option>
                              {memberCandidates
                                .filter(
                                  (c) =>
                                    !projMembers.some((pm) => pm.userId === c.userId),
                                )
                                .map((c) => {
                                  const name =
                                    c.displayName || c.username || c.userId;
                                  return (
                                    <option key={c.userId} value={c.userId}>
                                      {name}
                                      {c.username && c.displayName
                                        ? ` (@${c.username})`
                                        : ""}
                                    </option>
                                  );
                                })}
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!projAddUserId || projMemberBusy}
                              onClick={() => void handleAddProjectMember()}
                              className="text-xs shrink-0 bg-accent-primary hover:bg-accent-primary/95 text-white h-9"
                            >
                              {projMemberBusy ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <>
                                  <UserPlus size={13} className="mr-1" />
                                  添加
                                </>
                              )}
                            </Button>
                          </div>
                          {/* 快捷点击候选 */}
                          {memberCandidates.filter(
                            (c) =>
                              !projMembers.some((pm) => pm.userId === c.userId),
                          ).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {memberCandidates
                                .filter(
                                  (c) =>
                                    !projMembers.some(
                                      (pm) => pm.userId === c.userId,
                                    ),
                                )
                                .slice(0, 8)
                                .map((c) => (
                                  <button
                                    key={c.userId}
                                    type="button"
                                    disabled={projMemberBusy}
                                    onClick={() => {
                                      setProjAddUserId(c.userId);
                                      void handleAddProjectMember(c.userId);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border border-app-border bg-app-hover/40 hover:bg-accent-primary/10 hover:border-accent-primary/40 text-tx-secondary hover:text-tx-primary transition-colors disabled:opacity-50"
                                  >
                                    <UserPlus size={11} />
                                    {c.displayName || c.username}
                                  </button>
                                ))}
                            </div>
                          )}
                          {!memberSearchLoading &&
                            memberCandidates.filter(
                              (c) =>
                                !projMembers.some((pm) => pm.userId === c.userId),
                            ).length === 0 && (
                              <p className="text-[10px] text-tx-tertiary">
                                {memberSearchQ.trim()
                                  ? "未找到匹配用户，请换个关键词"
                                  : "输入用户名搜索系统用户，或从工作区成员中选择"}
                              </p>
                            )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-tx-tertiary px-1">
                          {currentUserId
                            ? "仅项目所有者可以添加/移除其他成员。你可在上方退出项目。"
                            : "正在识别当前用户…"}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-3 border-t border-app-border bg-app-sidebar/30 flex justify-end gap-2 shrink-0 safe-area-pb">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateModal(false)}
                className="text-xs"
              >
                {t("common.cancel") || "取消"}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="text-xs bg-accent-primary hover:bg-accent-primary/95 text-white"
              >
                {t("common.save") || "确认"}
              </Button>
            </div>
          </form>
        </div>,
        document.body,
      )}

      {centerActiveTask && (
        <TaskDetailModal
          task={centerActiveTask}
          wsMembers={wsMembers}
          onClose={() => setCenterActiveTask(null)}
          onRefresh={refreshCurrentView}
          showProjectName={true}
        />
      )}

    </div>
  );
}
