import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  ListTodo,
  FileText,
  Loader2,
  ChevronRight,
  ChevronDown,
  Bell,
  Clock,
  Sparkles,
  Copy,
  Check,
  X,
  ShieldCheck,
  ShieldAlert,
  Link,
} from "lucide-react";
import { api, setCurrentWorkspace, getServerUrl, getCurrentWorkspace } from "@/lib/api";
import { useApp, useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import type { Diary, Task, NoteListItem, Workspace, WorkspaceInvite, User } from "@/types";
import { haptic, syncTaskNotification } from "@/hooks/useCapacitor";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";

// ---------------------------------------------------------------------------
// 快捷卡片
// ---------------------------------------------------------------------------
function QuickStatCard({
  icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex items-center gap-3 p-4 rounded-xl border border-app-border/60 bg-app-surface/50 transition-all",
        onClick ? "hover:bg-app-hover hover:border-app-border cursor-pointer active:scale-[0.98]" : "",
      )}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + "15", color }}
      >
        {icon}
      </div>
      <div className="text-left">
        <div className="text-lg font-bold text-tx-primary tabular-nums">{value}</div>
        <div className="text-[11px] text-tx-tertiary">{label}</div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 条目组件
// ---------------------------------------------------------------------------
function DiaryEntry({ item, onClick }: { item: Diary; onClick: () => void }) {
  const moodEmoji: Record<string, string> = {
    happy: "😊", excited: "🥳", peaceful: "😌", thinking: "🤔",
    tired: "😴", sad: "😢", angry: "😤", sick: "🤒",
    love: "🥰", cool: "😎", laugh: "🤣", shock: "😱",
  };
  const emoji = moodEmoji[item.mood] || "";
  const date = item.createdAt.slice(0, 16).replace("T", " ");
  const hasVoice = item.voice && (typeof item.voice === 'object' ? (item.voice as any)?.id : true);

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-app-border/30 last:border-0 hover:bg-app-hover/30 transition-colors cursor-pointer"
    >
      <div className="text-base leading-none mt-0.5 shrink-0">{emoji || "📝"}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-tx-primary leading-relaxed line-clamp-2 break-words">
          {item.contentText || (hasVoice ? <span className="text-tx-tertiary">[语音]</span> : item.images?.length ? <span className="text-tx-tertiary">[图片]</span> : "")}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-tx-tertiary">{date}</span>
          {item.creatorName && (
            <span className="text-[10px] text-tx-tertiary">· {item.creatorName}</span>
          )}
        </div>
      </div>
      <ChevronRight size={14} className="text-tx-tertiary/40 mt-1 shrink-0" />
    </button>
  );
}

function TaskItem({
  item,
  onToggle,
  onClick,
}: {
  item: Task;
  onToggle: (id: string, e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const dueDate = item.dueDate ? new Date(item.dueDate).toLocaleDateString("zh-CN") : "";
  const isOverdue = item.dueDate && new Date(item.dueDate) < new Date() && !item.isCompleted;

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-app-border/30 last:border-0 hover:bg-app-hover/30 transition-colors cursor-pointer"
    >
      <div
        onClick={(e) => onToggle(item.id, e)}
        className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 transition-all active:scale-[0.9] hover:scale-110",
          item.isCompleted
            ? "border-green-500 bg-green-500 text-white"
            : isOverdue
              ? "border-red-400"
              : "border-tx-tertiary/40",
        )}
      >
        {item.isCompleted && <span className="text-[9px]">✓</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-xs text-tx-primary", item.isCompleted && "line-through text-tx-tertiary")}>
          {item.title}
        </p>
        {dueDate && (
          <span className={cn("text-[10px] mt-0.5", isOverdue ? "text-red-500" : "text-tx-tertiary")}>
            {isOverdue ? "已逾期 · " : ""}{dueDate}
          </span>
        )}
      </div>
      <ChevronRight size={14} className="text-tx-tertiary/40 mt-1 shrink-0" />
    </button>
  );
}

function NoteItem({ item, onClick }: { item: NoteListItem; onClick: () => void }) {
  const date = item.updatedAt?.slice(0, 16).replace("T", " ") || item.createdAt?.slice(0, 16).replace("T", " ");

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-app-border/30 last:border-0 hover:bg-app-hover/30 transition-colors cursor-pointer"
    >
      <div className="w-5 h-5 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary mt-0.5 shrink-0">
        <FileText size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-tx-primary truncate">
          {item.title || "无标题笔记"}
        </p>
        <p className="text-[10px] text-tx-tertiary mt-0.5">{date}</p>
      </div>
      <ChevronRight size={14} className="text-tx-tertiary/40 mt-1 shrink-0" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 备份状态卡片
// ---------------------------------------------------------------------------
function BackupStatusCard() {
  const actions = useAppActions();
  const [status, setStatus] = useState<{
    lastBackupAt: string | null;
    autoBackupRunning: boolean;
    sameVolume: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.backup.status()
      .then((s) => setStatus({
        lastBackupAt: (s as any).lastBackupAt || null,
        autoBackupRunning: (s as any).autoBackupRunning || false,
        sameVolume: (s as any).sameVolume !== false,
      }))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !status) return null;

  const daysSinceLastBackup = status.lastBackupAt
    ? Math.floor((Date.now() - new Date(status.lastBackupAt).getTime()) / 86400000)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.35 }}
      className="flex items-center justify-between px-4 py-3 rounded-xl border border-app-border/40 bg-app-surface/20"
    >
      <div className="flex items-center gap-3">
        {daysSinceLastBackup !== null && daysSinceLastBackup < 7 ? (
          <ShieldCheck size={16} className="text-green-500" />
        ) : (
          <ShieldAlert size={16} className="text-amber-500" />
        )}
        <div>
          <p className="text-xs text-tx-primary font-medium">
            {status.autoBackupRunning ? "自动备份已开启" : "备份状态"}
          </p>
          <p className="text-[10px] text-tx-tertiary mt-0.5">
            {daysSinceLastBackup !== null
              ? `${daysSinceLastBackup} 天前备份`
              : status.autoBackupRunning
                ? "等待首次备份"
                : "未配置备份"}
            {status.sameVolume && " · 建议将备份存到不同磁盘"}
          </p>
        </div>
      </div>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("super:open-settings", { detail: { tab: "data" } }))}
        className="text-[10px] text-accent-primary hover:underline shrink-0"
      >
        ＞ 设置
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// 邀请码展示对话框
// ---------------------------------------------------------------------------
function InviteCodeDialog({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const serverUrl = getServerUrl() || window.location.origin;
  const joinLink = `${serverUrl.replace(/\/+$/, "")}/join?code=${code}`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinLink).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-app-elevated rounded-2xl shadow-2xl border border-app-border p-6 w-[400px] max-w-[90vw]"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-tx-primary flex items-center gap-2">
            🏠 家庭空间已创建
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-app-hover text-tx-tertiary flex items-center justify-center">
            <X size={15} />
          </button>
        </div>

        <p className="text-xs text-tx-secondary leading-relaxed mb-4">
          邀请家人加入，一起分享生活点滴、管理家庭待办。可以通过链接或邀请码加入。
        </p>

        {/* 分享链接 */}
        <div className="mb-3">
          <p className="text-[10px] text-tx-tertiary mb-1.5 font-medium">📎 分享链接</p>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-primary/5 border border-accent-primary/20">
            <Link size={14} className="text-accent-primary shrink-0" />
            <span className="flex-1 text-xs text-accent-primary truncate select-all">{joinLink}</span>
            <button
              onClick={handleCopyLink}
              className="w-8 h-8 rounded-lg bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 flex items-center justify-center transition-all shrink-0"
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* 邀请码 */}
        <div className="mb-4">
          <p className="text-[10px] text-tx-tertiary mb-1.5 font-medium">🔑 或输入邀请码</p>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-app-hover/50 border border-app-border">
            <code className="flex-1 text-center text-lg font-bold tracking-[0.3em] text-accent-primary select-all">
              {code}
            </code>
            <button
              onClick={handleCopyCode}
              className="w-8 h-8 rounded-lg bg-app-hover text-tx-secondary hover:bg-accent-primary/10 hover:text-accent-primary flex items-center justify-center transition-all shrink-0"
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleCopyLink}
            className="w-full py-2.5 rounded-xl bg-accent-primary text-white text-xs font-medium hover:bg-accent-primary/90 transition-all flex items-center justify-center gap-1.5"
          >
            {copiedLink ? "已复制链接！" : <><Link size={13} /> 复制分享链接</>}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl text-xs text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover transition-all"
          >
            开始使用
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard 主组件
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const { state } = useApp();
  const actions = useAppActions();
  const [loading, setLoading] = useState(true);
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectTasks, setProjectTasks] = useState<any[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [stats, setStats] = useState({ diaryCount: 0, taskPending: 0, noteCount: 0 });
  const [greeting, setGreeting] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const currentWorkspaceId = getCurrentWorkspace();
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId) || (workspaces.length > 0 ? workspaces[0] : null);

  const hasWorkspaces = workspaces.length > 0;
  const hasFamilyGroup = workspaces.some(w => w.name === "我的家庭" || w.icon === "🏠" || w.name.includes("家庭"));

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 6) setGreeting("夜深了");
    else if (hour < 9) setGreeting("早上好");
    else if (hour < 12) setGreeting("上午好");
    else if (hour < 14) setGreeting("中午好");
    else if (hour < 18) setGreeting("下午好");
    else setGreeting("晚上好");
  }, []);

  // 加载工作区列表
  useEffect(() => {
    api.getWorkspaces()
      .then((list) => setWorkspaces(list))
      .catch(() => {});
  }, []);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // 加载用户信息
  useEffect(() => {
    api.getMe()
      .then((user) => setCurrentUser(user))
      .catch(() => {});
  }, []);

  // 一键创建家庭空间
  const handleCreateFamily = useCallback(async () => {
    setCreating(true);
    try {
      const ws = await api.createWorkspace({
        name: "我的家庭",
        description: "一家人共享的笔记、说说和待办空间",
        icon: "🏠",
      });

      // 自动生成邀请码
      const invite = await api.createWorkspaceInvite(ws.id, {
        role: "editor",
        maxUses: 10,
      });

      setInviteCode(invite.code);
      setWorkspaces((prev) => [...prev, ws]);

      // 切换到新工作区
      setCurrentWorkspace(ws.id);
      window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: ws.id } }));

      toast.success("家庭空间创建成功！邀请家人加入吧");
      setCreating(false);
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
      setCreating(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [diaryData, tasksData, notesData, myProjectTasks] = await Promise.all([
        api.getDiaryTimeline(undefined, 5).catch(() => ({ items: [] as Diary[], hasMore: false, nextCursor: null })),
        api.getTasks("all").catch(() => [] as Task[]),
        api.getNotes({ sortBy: "updatedAt", sortOrder: "desc", limit: "5", isTrashed: "0" }).catch(() => [] as NoteListItem[]),
        api.getMyTasks().catch(() => [] as any[]),
      ]);

      const diaryItems = diaryData.items || [];
      setDiaries(diaryItems);
      setTasks(tasksData || []);
      setProjectTasks(myProjectTasks || []);
      setNotes(notesData || []);

      // 计算统计（合并普通任务与项目任务）
      const pendingTasksFromTasks = (tasksData || []).filter(
        (t: Task) => !t.isCompleted && t.dueDate && new Date(t.dueDate) <= new Date(Date.now() + 3 * 86400000),
      );
      const pendingFromProject = (myProjectTasks || []).filter(
        (pt: any) => pt.isCompleted === 0 && pt.endDate && new Date(pt.endDate) <= new Date(Date.now() + 3 * 86400000),
      );

      setStats({
        diaryCount: diaryItems.length,
        taskPending: pendingTasksFromTasks.length + pendingFromProject.length,
        noteCount: (notesData || []).length,
      });
    } catch (e) {
      console.error("Dashboard load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const handleWorkspaceChanged = () => {
      api.getWorkspaces().then(setWorkspaces).catch(() => {});
      loadDashboard();
    };
    window.addEventListener("super:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("super:workspace-changed", handleWorkspaceChanged);
  }, [loadDashboard]);


  // Combine simple tasks and project tasks for upcoming display
  const upcomingTasks = (() => {
    const soon = (tasks || []).filter(
      (t) => !t.isCompleted && t.dueDate && new Date(t.dueDate) <= new Date(Date.now() + 3 * 86400000),
    ).map((t) => ({ ...t, __source: "task" }));

    const projSoon = (projectTasks || []).filter(
      (pt) => pt.isCompleted === 0 && pt.endDate && new Date(pt.endDate) <= new Date(Date.now() + 3 * 86400000),
    ).map((pt) => ({
      id: pt.id,
      title: pt.title,
      isCompleted: pt.isCompleted,
      dueDate: pt.endDate || null,
      creatorName: pt.assigneeName || pt.assigneeDisplayName || pt.creatorId,
      __source: "project",
    } as Task & { __source: string }));

    return [...soon, ...projSoon].slice(0, 5);
  })();

  const handleToggleTask = async (id: string, e: React.MouseEvent, source: "task" | "project" = "task") => {
    e.stopPropagation(); // 阻止触发卡片点击跳转
    haptic.light();
    if (source === "task") {
      // 乐观更新
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, isCompleted: t.isCompleted ? 0 : 1 } : t)));
      try {
        const updated = await api.toggleTask(id);
        syncTaskNotification(updated);
        window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
        api.getTaskStats().then((s) => {
          setStats((prev) => ({ ...prev, taskPending: s.activeReminders || prev.taskPending }));
        }).catch(console.error);
      } catch {
        loadDashboard(); // 回滚
      }
    } else {
      // project task
      setProjectTasks((prev) => prev.map((pt) => (pt.id === id ? { ...pt, isCompleted: pt.isCompleted === 1 ? 0 : 1 } : pt)));
      try {
        const prev = projectTasks.find((p) => p.id === id);
        const currentCompleted = prev ? prev.isCompleted : 0;
        await api.updateProjectTask(id, { isCompleted: currentCompleted === 1 ? 0 : 1 });
        window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
        loadDashboard();
      } catch {
        loadDashboard();
      }
    }
  };

  const handleDiaryClick = (diaryId: string) => {
    haptic.light();
    sessionStorage.setItem("super:pending-navigate", JSON.stringify({
      sourceType: "diary",
      sourceId: diaryId,
    }));
    actions.setViewMode("diary");
    window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
  };

  const handleTaskClick = (taskId: string) => {
    haptic.light();
    sessionStorage.setItem("super:pending-navigate", JSON.stringify({
      sourceType: "task",
      sourceId: taskId,
    }));
    actions.setViewMode("tasks");
    window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
  };

  const handleNoteClick = async (noteId: string) => {
    haptic.light();
    sessionStorage.setItem("super:pending-navigate", JSON.stringify({
      sourceType: "note",
      sourceId: noteId,
    }));
    actions.setViewMode("all");
    window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
  };

  const handleQuickCreateNote = async () => {
    haptic.light();
    if (state.notebooks.length === 0) {
      try {
        const notebooks = await api.getNotebooks();
        actions.setNotebooks(notebooks);
        if (notebooks.length === 0) {
          toast.warning("请先在侧边栏创建一个笔记本");
          return;
        }
        await createNote(notebooks[0].id);
      } catch (err) {
        toast.warning("请先在侧边栏创建一个笔记本");
        return;
      }
    } else {
      const notebookId = state.selectedNotebookId || state.notebooks[0].id;
      await createNote(notebookId);
    }
  };

  const createNote = async (notebookId: string) => {
    try {
      const note = await api.createNote({ notebookId, title: "无标题笔记" });
      actions.setActiveNote(note);
      actions.setSelectedNotebook(notebookId);
      actions.setViewMode("notebook");
      actions.setMobileView("editor");
      actions.refreshNotebooks();
      toast.success("笔记已创建");
    } catch (err: any) {
      toast.error(err?.message || "创建笔记失败");
    }
  };

  const handleQuickWriteSays = () => {
    haptic.light();
    actions.setViewMode("diary");
  };

  const handleQuickAddTask = () => {
    haptic.light();
    actions.setViewMode("projects");
    const filter = { type: "my-tasks" };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-bg">
      {/* 首页顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-app-border/40 bg-app-surface/20 shrink-0 select-none" style={{ paddingTop: 'calc(var(--safe-area-top) + 4px)' }}>
        <span className="text-sm font-bold text-tx-primary">首页</span>
        <WorkspaceSwitcher variant="header" />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* ===== 欢迎区域 ===== */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
                <Sparkles size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-tx-primary leading-tight">
                  {greeting} {currentUser?.displayName || currentUser?.username || ""} 👋
                </h1>
                <p className="text-xs text-tx-tertiary mt-0.5">
                  {hasWorkspaces ? "选择一个空间开始协作" : "目前只有你一个人，创建家庭空间邀请家人吧"}
                </p>
              </div>
            </div>
          </motion.div>

          {/* ===== 快捷操作面板 ===== */}
          {hasWorkspaces && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className="rounded-2xl border border-app-border/40 bg-app-surface/20 p-4"
            >
              <h2 className="text-[11px] font-semibold text-tx-tertiary uppercase tracking-wider mb-3 px-1">
                快捷操作
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={handleQuickCreateNote}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-app-border/60 bg-app-surface/50 hover:bg-app-hover hover:border-app-border transition-all active:scale-[0.97] group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <FileText size={20} />
                  </div>
                  <span className="text-xs font-semibold text-tx-primary">记笔记</span>
                  <span className="text-[10px] text-tx-tertiary mt-0.5">记录创意想法</span>
                </button>

                <button
                  onClick={handleQuickWriteSays}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-app-border/60 bg-app-surface/50 hover:bg-app-hover hover:border-app-border transition-all active:scale-[0.97] group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <MessageCircle size={20} />
                  </div>
                  <span className="text-xs font-semibold text-tx-primary">写说说</span>
                  <span className="text-[10px] text-tx-tertiary mt-0.5">记录日常生活</span>
                </button>

                <button
                  onClick={handleQuickAddTask}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-app-border/60 bg-app-surface/50 hover:bg-app-hover hover:border-app-border transition-all active:scale-[0.97] group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <ListTodo size={20} />
                  </div>
                  <span className="text-xs font-semibold text-tx-primary">加待办</span>
                  <span className="text-[10px] text-tx-tertiary mt-0.5">管理计划日程</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ===== 创建家庭空间（无工作区时展示） ===== */}
          {!hasFamilyGroup && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-pink-500/5 p-6"
            >
              {/* 装饰背景 */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-pink-500/5 rounded-full translate-y-1/2 -translate-x-1/2" />

              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-2xl shadow-lg shadow-violet-500/20">
                    🏠
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-tx-primary">创建家庭空间</h2>
                    <p className="text-xs text-tx-tertiary mt-0.5">
                      与家人一起分享说说、管理待办、记录生活
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-4 mb-5">
                  <div className="text-center p-3 rounded-xl bg-white/30 dark:bg-white/5">
                    <div className="text-xl mb-1">📖</div>
                    <div className="text-[10px] text-tx-tertiary">家庭说说</div>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-white/30 dark:bg-white/5">
                    <div className="text-xl mb-1">✅</div>
                    <div className="text-[10px] text-tx-tertiary">共享待办</div>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-white/30 dark:bg-white/5">
                    <div className="text-xl mb-1">📝</div>
                    <div className="text-[10px] text-tx-tertiary">家庭笔记</div>
                  </div>
                </div>

                <button
                  onClick={handleCreateFamily}
                  disabled={creating}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 text-white text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
                >
                  {creating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {creating ? "正在创建..." : "一键创建家庭空间"}
                </button>
              </div>
            </motion.div>
          )}

          {/* ===== 状态卡片 ===== */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QuickStatCard
              icon={<MessageCircle size={18} />}
              label="近期待办"
              value={stats.taskPending}
              color="#8b5cf6"
              onClick={() => {
                haptic.light();
                actions.setViewMode("projects");
                const filter = { type: "my-tasks", status: "pending" };
                sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
                window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
              }}
            />
            <QuickStatCard
              icon={<ListTodo size={18} />}
              label="全部待办"
              value={tasks.length + projectTasks.length}
              color="#10b981"
              onClick={() => {
                haptic.light();
                actions.setViewMode("projects");
                const filter = { type: "my-tasks" };
                sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
                window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
              }}
            />
            <QuickStatCard
              icon={<FileText size={18} />}
              label="最近笔记"
              value={stats.noteCount}
              color="#f59e0b"
              onClick={() => actions.setViewMode("all")}
            />
            <QuickStatCard
              icon={<Bell size={18} />}
              label={state.unreadMentionCount > 0 ? `${state.unreadMentionCount} 条未读` : "消息"}
              value={state.unreadMentionCount}
              color="#ef4444"
              onClick={() => actions.setViewMode("mentions")}
            />
          </div>

          {/* ===== 内容列表（有工作区时展示） ===== */}
          {hasWorkspaces && (loading ? (
            <div className="flex justify-center py-16">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* 最近说说 */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="rounded-xl border border-app-border/60 bg-app-surface/30 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/30">
                  <h2 className="text-xs font-semibold text-tx-primary flex items-center gap-2">
                    <MessageCircle size={14} className="text-violet-500" />
                    最新说说
                  </h2>
                  <button
                    onClick={() => actions.setViewMode("diary")}
                    className="text-[10px] text-accent-primary hover:underline"
                  >
                    查看全部
                  </button>
                </div>
                {diaries.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-tx-tertiary">
                    还没有说说，去记录今天的生活吧
                  </div>
                ) : (
                  diaries.map((item) => (
                    <DiaryEntry
                      key={item.id}
                      item={item}
                      onClick={() => handleDiaryClick(item.id)}
                    />
                  ))
                )}
              </motion.div>

              {/* 即将到期待办 */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                className="rounded-xl border border-app-border/60 bg-app-surface/30 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/30">
                  <h2 className="text-xs font-semibold text-tx-primary flex items-center gap-2">
                    <Clock size={14} className="text-emerald-500" />
                    即将到期
                  </h2>
                  <button
                    onClick={() => {
                      haptic.light();
                      actions.setViewMode("projects");
                      const filter = { type: "my-tasks", status: "pending" };
                      sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
                      window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
                    }}
                    className="text-[10px] text-accent-primary hover:underline"
                  >
                    查看全部
                  </button>
                </div>
                {upcomingTasks.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-tx-tertiary">
                    最近 3 天没有到期的待办 ✨
                  </div>
                  ) : (
                  upcomingTasks.map((item: any) => (
                    <TaskItem
                      key={item.id}
                      item={item}
                      onToggle={(id, e) => handleToggleTask(id, e, item.__source === "project" ? "project" : "task")}
                      onClick={() => {
                        if (item.__source === "project") {
                          actions.setViewMode("projects");
                          window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: item.id }));
                        } else {
                          handleTaskClick(item.id);
                        }
                      }}
                    />
                  ))
                )}
              </motion.div>

              {/* 最近编辑的笔记 */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
                className="rounded-xl border border-app-border/60 bg-app-surface/30 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/30">
                  <h2 className="text-xs font-semibold text-tx-primary flex items-center gap-2">
                    <FileText size={14} className="text-amber-500" />
                    最近编辑
                  </h2>
                  <button
                    onClick={() => actions.setViewMode("all")}
                    className="text-[10px] text-accent-primary hover:underline"
                  >
                    查看全部
                  </button>
                </div>
                {notes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-tx-tertiary">
                    还没有笔记
                  </div>
                ) : (
                  notes.map((item) => (
                    <NoteItem
                      key={item.id}
                      item={item}
                      onClick={() => handleNoteClick(item.id)}
                    />
                  ))
                )}
              </motion.div>
            </div>
          ))}
        </div>
      </div>

      {/* 数据备份状态 */}
      {hasWorkspaces && !loading && (
        <BackupStatusCard />
      )}

      {/* 邀请码弹窗 */}
      <AnimatePresence>
        {inviteCode && (
          <InviteCodeDialog
            code={inviteCode}
            onClose={() => setInviteCode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
