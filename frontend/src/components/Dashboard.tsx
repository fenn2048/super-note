import { useState, useEffect, useCallback, useRef } from "react";
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
  Wallet,
} from "lucide-react";
import { api, setCurrentWorkspace, getServerUrl, getCurrentWorkspace } from "@/lib/api";
import { useApp, useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import type { Book, Diary, Task, NoteListItem, Workspace, WorkspaceInvite, User } from "@/types";
import { haptic, syncTaskNotification } from "@/hooks/useCapacitor";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import { useScrollHideBars } from "@/hooks/useScrollHideBars";
import { renderDiaryContent } from "./DiaryCenter";
import DashboardQuickActions from "@/components/dashboard/DashboardQuickActions";
import { isModuleAllowedByPack } from "@/lib/modulePack";
import { LoadingBlock, EmptyState, EmptyActionButton } from "@/components/common/FeedbackStates";
import PageHeader from "@/components/layout/PageHeader";
import ContentCanvas from "@/components/layout/ContentCanvas";
import ReadingDashboard from "@/components/books/ReadingDashboard";
import { setLibraryTab } from "@/lib/navigation.config";

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
        "flex items-center gap-3 p-4 rounded-card border border-app-border/70 bg-app-elevated shadow-xs transition-all duration-fast ease-soft",
        onClick ? "hover:bg-app-hover hover:shadow-sm hover:border-app-border cursor-pointer active:scale-[0.98]" : "",
      )}
    >
      <div
        className="w-11 h-11 rounded-card flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + "18", color }}
      >
        {icon}
      </div>
      <div className="text-left min-w-0">
        <div className="text-xl font-bold text-tx-primary tabular-nums tracking-tight leading-none">{value}</div>
        <div className="text-[11px] text-tx-tertiary mt-1 font-medium">{label}</div>
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
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const placeholder = target.closest(".iframe-placeholder-wrapper") as HTMLDivElement | null;
        if (placeholder) {
          e.preventDefault();
          e.stopPropagation();
          const src = placeholder.getAttribute("data-src") || "";
          const iframe = document.createElement("iframe");
          iframe.src = src;
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.style.border = "none";
          iframe.setAttribute("allowfullscreen", "true");
          try {
            const attrsStr = placeholder.getAttribute("data-attrs") || "{}";
            const attrs = JSON.parse(attrsStr);
            Object.keys(attrs).forEach((key) => {
              if (key !== "src" && key !== "style") {
                iframe.setAttribute(key, attrs[key]);
              }
            });
          } catch (err) {
            console.error(err);
          }
          placeholder.innerHTML = "";
          placeholder.appendChild(iframe);
          placeholder.style.cursor = "default";
        } else {
          onClick();
        }
      }}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-app-border/30 last:border-0 hover:bg-app-hover/30 transition-colors cursor-pointer"
    >
      <div className="text-base leading-none mt-0.5 shrink-0">{emoji || "📝"}</div>
      <div className="flex-1 min-w-0">
        {item.contentText ? (
          <div
            className="diary-rendered-content prose prose-sm dark:prose-invert max-w-none text-xs text-tx-primary leading-relaxed break-words line-clamp-3 overflow-hidden"
            dangerouslySetInnerHTML={{ __html: renderDiaryContent(item.contentText) }}
          />
        ) : (
          <p className="text-xs text-tx-primary leading-relaxed line-clamp-2 break-words">
            {hasVoice ? <span className="text-tx-tertiary">[语音]</span> : item.images?.length ? <span className="text-tx-tertiary">[图片]</span> : ""}
          </p>
        )}
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
        <p className={cn("text-xs text-tx-primary", item.isCompleted ? "line-through text-tx-tertiary" : (item.status === "paused" ? "opacity-60" : ""))}>
          {item.title}
          {item.status === "paused" && (
            <span className="ml-2 px-1 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] rounded border border-amber-500/20 font-bold">
              已暂停
            </span>
          )}
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
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [readingBooks, setReadingBooks] = useState<Book[]>([]);
  const [stats, setStats] = useState({ diaryCount: 0, taskPending: 0, noteCount: 0 });
  const [financeOverview, setFinanceOverview] = useState<{
    year: string;
    month: number;
    ledgers: Array<{
      id: string;
      title: string;
      icon: string | null;
      hasPassword: boolean;
      locked: boolean;
      monthIncomeMinor?: number;
      monthExpenseMinor?: number;
      monthNetMinor?: number;
    }>;
  } | null>(null);
  const [greeting, setGreeting] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  /** 当前工作区 id（state 化，监听切换事件，避免仅读 localStorage 时 UI 不刷新） */
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getCurrentWorkspace());

  const currentWorkspace =
    (currentWorkspaceId
      ? workspaces.find((w) => w.id === currentWorkspaceId)
      : null) || null;

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

  // 加载用户信息（昵称修改后通过 super:profile-updated 刷新）
  useEffect(() => {
    const loadMe = () => {
      api.getMe()
        .then((user) => setCurrentUser(user))
        .catch(() => {});
    };
    loadMe();
    window.addEventListener("super:profile-updated", loadMe);
    return () => window.removeEventListener("super:profile-updated", loadMe);
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
      setCurrentWorkspaceId(ws.id);
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
      // P1 收尾：/api/tasks 已代理到 project_tasks，统一用 getTasks 即可，避免双重计数
      const [diaryData, tasksData, notesData, fin, booksData] = await Promise.all([
        api.getDiaryTimeline(undefined, 5).catch(() => ({ items: [] as Diary[], hasMore: false, nextCursor: null })),
        api.getTasks("all").catch(() => [] as Task[]),
        api.getNotes({ sortBy: "updatedAt", sortOrder: "desc", limit: "5", isTrashed: "0" }).catch(() => [] as NoteListItem[]),
        isModuleAllowedByPack("finance")
          ? api.finance.financeOverview().catch(() => null)
          : Promise.resolve(null),
        // 首页「阅读中」：拉书库列表（ReadingDashboard 内按最近更新排序）
        isModuleAllowedByPack("books") || isModuleAllowedByPack("library")
          ? api.books.list({}).catch(() => [] as Book[])
          : Promise.resolve([] as Book[]),
      ]);

      const diaryItems = diaryData.items || [];
      setDiaries(diaryItems);
      setTasks(tasksData || []);
      setNotes(notesData || []);
      setFinanceOverview(fin);
      setReadingBooks(Array.isArray(booksData) ? booksData : []);

      const pendingSoon = (tasksData || []).filter(
        (t: Task) =>
          !t.isCompleted &&
          t.dueDate &&
          new Date(t.dueDate) <= new Date(Date.now() + 3 * 86400000),
      );

      setStats({
        diaryCount: diaryItems.length,
        taskPending: pendingSoon.length,
        noteCount: (notesData || []).length,
      });
    } catch (e) {
      console.error("Dashboard load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 从首页打开某本书：进资料库书库 Tab 并触发全局打开事件 */
  const handleOpenBookFromHome = useCallback(
    (bookHash: string) => {
      haptic.light();
      setLibraryTab("books");
      actions.setViewMode("library");
      actions.setMobileView("list");
      window.dispatchEvent(new CustomEvent("super:open-book", { detail: { bookHash } }));
    },
    [actions],
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const handleWorkspaceChanged = (e: Event) => {
      const id = (e as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
      setCurrentWorkspaceId(
        typeof id === "string" ? id : getCurrentWorkspace(),
      );
      api.getWorkspaces().then(setWorkspaces).catch(() => {});
      loadDashboard();
    };
    window.addEventListener("super:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("super:workspace-changed", handleWorkspaceChanged);
  }, [loadDashboard]);


  // 近期待办（/api/tasks 兼容层 → project_tasks）
  const upcomingTasks = (() => {
    return (tasks || [])
      .filter(
        (t) =>
          !t.isCompleted &&
          t.dueDate &&
          new Date(t.dueDate) <= new Date(Date.now() + 3 * 86400000),
      )
      .map((t) => ({ ...t, __source: "task" as const }))
      .slice(0, 5);
  })();

  const handleToggleTask = async (
    id: string,
    e: React.MouseEvent,
    _source: "task" | "project" = "task",
  ) => {
    e.stopPropagation();
    haptic.light();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, isCompleted: t.isCompleted ? 0 : 1 } : t,
      ),
    );
    try {
      const updated = await api.toggleTask(id);
      syncTaskNotification(updated);
      window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
      api
        .getTaskStats()
        .then((s) => {
          setStats((prev) => ({
            ...prev,
            taskPending: s.pending ?? prev.taskPending,
          }));
        })
        .catch(console.error);
      loadDashboard();
    } catch {
      loadDashboard();
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
    // 方案 A：进入项目「我的任务」
    sessionStorage.setItem("super:pending-navigate", JSON.stringify({
      sourceType: "task",
      sourceId: taskId,
    }));
    sessionStorage.setItem(
      "super-active-project-filter",
      JSON.stringify({ type: "my-tasks" }),
    );
    actions.setViewMode("projects");
    window.dispatchEvent(
      new CustomEvent("super:project-filter-changed", {
        detail: { type: "my-tasks" },
      }),
    );
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
    // 与全局 CreateMenu / FAB 同一路径：打开说说撰写
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("super:quick-new-diary"));
    }, 80);
  };

  const handleQuickAddTask = () => {
    haptic.light();
    actions.setViewMode("projects");
    const filter = { type: "my-tasks" };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
    // 打开与 CreateMenu 一致的任务创建
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("super:quick-new-task"));
    }, 80);
  };

  const homeScrollRef = useRef<HTMLDivElement>(null);
  useScrollHideBars(homeScrollRef, true, [loading, hasWorkspaces]);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-app-bg">
      {/* 首页顶栏：移动端统一 Chrome；桌面 PageHeader */}
      <MobileChromeHeader
        variant="root"
        title="首页"
        right={<WorkspaceSwitcher variant="header" />}
      />
      <div className="hidden md:block shrink-0">
        <PageHeader
          title="首页"
          actions={<WorkspaceSwitcher variant="header" />}
          className="bg-app-elevated/40"
        />
      </div>

      <ContentCanvas
        scrollRef={homeScrollRef}
        maxWidthClass="max-w-[720px]"
        className="sm:px-6"
        flush
      >
        <div className="px-4 sm:px-0 py-2 sm:py-4 space-y-6">
          {/* ===== 欢迎区域 ===== */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3.5 mb-1">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-400 flex items-center justify-center shadow-accent">
                <Sparkles size={22} className="text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-tx-primary leading-tight tracking-tight">
                  {greeting} {currentUser?.displayName || currentUser?.username || ""} 👋
                </h1>
                <p className="text-xs sm:text-sm text-tx-tertiary mt-1">
                  {currentWorkspace
                    ? `当前空间：${[currentWorkspace.icon, currentWorkspace.name].filter(Boolean).join(" ")}`
                    : hasWorkspaces
                      ? "选择一个空间开始协作"
                      : "目前只有你一个人，创建家庭空间邀请家人吧"}
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
              className="rounded-window border border-app-border/60 bg-app-elevated shadow-sm p-4 sm:p-5"
            >
              <DashboardQuickActions
                onCreateNote={handleQuickCreateNote}
                onWriteSays={handleQuickWriteSays}
                onAddTask={handleQuickAddTask}
              />
            </motion.div>
          )}

          {/* ===== 书籍「阅读中」仪表盘（桌面 + 移动首页共用） ===== */}
          {(isModuleAllowedByPack("books") || isModuleAllowedByPack("library")) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.06 }}
              className="rounded-window border border-app-border/60 bg-app-elevated shadow-sm p-4 sm:p-5"
            >
              <ReadingDashboard
                books={readingBooks}
                onOpenBook={handleOpenBookFromHome}
                variant="section"
              />
            </motion.div>
          )}

          {/* ===== 本月记账摘要 ===== */}
          {isModuleAllowedByPack("finance") && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 }}
            >
              <button
                type="button"
                onClick={() => {
                  actions.setViewMode("finance");
                  actions.setMobileView("list");
                }}
                className="w-full text-left rounded-window border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-4 sm:p-5 hover:border-emerald-500/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <Wallet size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-tx-primary">本月记账</div>
                      <div className="text-[11px] text-tx-tertiary">
                        {financeOverview
                          ? `${financeOverview.year}年${financeOverview.month}月 · ${financeOverview.ledgers.length} 个账本`
                          : "进入记账"}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-tx-tertiary shrink-0" />
                </div>
                {(() => {
                  const open = (financeOverview?.ledgers || []).filter((l) => !l.locked);
                  if (!open.length) {
                    return (
                      <p className="text-xs text-tx-tertiary">
                        {(financeOverview?.ledgers?.length || 0) > 0
                          ? "账本已锁定，点击进入解锁查看收支"
                          : "创建账本后可在此查看本月收支"}
                      </p>
                    );
                  }
                  const income = open.reduce((s, l) => s + (l.monthIncomeMinor || 0), 0);
                  const expense = open.reduce((s, l) => s + (l.monthExpenseMinor || 0), 0);
                  const fmt = (m: number) => (m / 100).toFixed(2);
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-app-bg/50 px-2 py-2">
                        <div className="text-[10px] text-tx-tertiary">收入</div>
                        <div className="text-sm font-semibold text-emerald-600 tabular-nums">¥{fmt(income)}</div>
                      </div>
                      <div className="rounded-lg bg-app-bg/50 px-2 py-2">
                        <div className="text-[10px] text-tx-tertiary">支出</div>
                        <div className="text-sm font-semibold text-rose-500 tabular-nums">¥{fmt(expense)}</div>
                      </div>
                      <div className="rounded-lg bg-app-bg/50 px-2 py-2">
                        <div className="text-[10px] text-tx-tertiary">结余</div>
                        <div className="text-sm font-semibold text-tx-primary tabular-nums">
                          ¥{fmt(income - expense)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </button>
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
              value={tasks.length}
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
            <LoadingBlock label="加载工作台…" />
          ) : (
            <div className="space-y-6">
              {/* 最近说说 */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="rounded-window border border-app-border/60 bg-app-elevated shadow-xs overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/40 bg-app-surface/30">
                  <h2 className="text-xs font-semibold text-tx-primary flex items-center gap-2">
                    <MessageCircle size={14} className="text-violet-500" />
                    最新说说
                  </h2>
                  <button
                    onClick={() => actions.setViewMode("diary")}
                    className="text-[11px] font-medium text-accent-primary hover:underline"
                  >
                    查看全部
                  </button>
                </div>
                {diaries.length === 0 ? (
                  <EmptyState
                    icon={MessageCircle}
                    title="还没有说说"
                    description="去记录今天的生活吧"
                    action={
                      <EmptyActionButton onClick={handleQuickWriteSays}>
                        <MessageCircle size={14} />
                        写说说
                      </EmptyActionButton>
                    }
                    className="py-8"
                  />
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
                className="rounded-window border border-app-border/60 bg-app-elevated shadow-xs overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/40 bg-app-surface/30">
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
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-tx-tertiary mb-3">最近 3 天没有到期的待办 ✨</p>
                    <button
                      type="button"
                      onClick={handleQuickAddTask}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent-primary/10 text-accent-primary text-xs font-semibold active:scale-[0.98]"
                    >
                      <ListTodo size={14} />
                      加待办
                    </button>
                  </div>
                  ) : (
                  upcomingTasks.map((item: any) => (
                    <TaskItem
                      key={item.id}
                      item={item}
                      onToggle={(id, e) => handleToggleTask(id, e)}
                      onClick={() => handleTaskClick(item.id)}
                    />
                  ))
                )}
              </motion.div>

              {/* 最近编辑的笔记 */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
                className="rounded-window border border-app-border/60 bg-app-elevated shadow-xs overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border/40 bg-app-surface/30">
                  <h2 className="text-xs font-semibold text-tx-primary flex items-center gap-2">
                    <FileText size={14} className="text-amber-500" />
                    最近编辑
                  </h2>
                  <button
                    onClick={() => actions.setViewMode("all")}
                    className="text-[11px] font-medium text-accent-primary hover:underline"
                  >
                    查看全部
                  </button>
                </div>
                {notes.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="还没有笔记"
                    action={
                      <EmptyActionButton onClick={handleQuickCreateNote}>
                        <FileText size={14} />
                        记笔记
                      </EmptyActionButton>
                    }
                    className="py-8"
                  />
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

          {/* 数据备份状态 */}
          {hasWorkspaces && !loading && (
            <BackupStatusCard />
          )}
        </div>
      </ContentCanvas>

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
