/**
 * CommandPalette —— Cmd-K 全局搜索与命令控制弹窗
 * ----------------------------------------------------------------------------
 * 为什么不用 Sidebar 搜索框？
 *   - Sidebar 搜索把结果灌回 NoteList 的"search 视图"，是 **持久化浏览** 语义；
 *     用户要继续阅读结果列表，视图会切走，要手动切回来。
 *   - Cmd-K 是 **即用即走** 语义：快速跳转，跳完即关；保持当前 viewMode 不变。
 *   - 二者各司其职。Sidebar 搜索 = 筛选浏览；Cmd-K = 跳转导航。
 *
 * 触发来源：
 *   1) macOS 原生 "搜索" 菜单项（menu:search → useDesktopMenuBridge → onOpenSearch）
 *   2) Dock 右键 "搜索笔记"（dock:search）
 *   3) 键盘 Cmd/Ctrl+K（本组件自己监听 window keydown）
 *
 * 新增升级功能：
 *   - 支持静态/系统级别指令，整合至单列表导航 (DisplayItems)；
 *   - 支持一键快捷新建笔记、说说、待办（触发 App 顶层事件）；
 *   - 支持一键切换明暗主题 (next-themes) 和外观皮肤 (useSkin)；
 *   - 列表键盘及鼠标高亮无缝适配。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search as SearchIcon,
  FileText,
  Loader2,
  NotebookPen,
  ListTodo,
  Home,
  Briefcase,
  Bell,
  Settings,
  Palette,
  Moon,
  Sun,
  Sidebar as SidebarIcon,
  Book,
  BookOpen as BookOpenIcon,
} from "lucide-react";
import { useAppActions } from "@/store/AppContext";
import { api } from "@/lib/api";
import type { SearchResult } from "@/types";
import { useSkin } from "@/hooks/useSkin";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  type: "command";
  title: string;
  subtitle?: string;
  shortcut?: string;
  icon: React.ComponentType<any>;
  handler: () => void;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200/60 dark:bg-amber-400/30 text-inherit rounded px-0.5">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

function parseNLPTask(query: string) {
  let title = query.trim();
  let assignee: string | null = null;
  let tag: string | null = null;
  let dateStr: string | null = null;

  // Extract /date (e.g. /今天, /明天, /2026-07-05, /7-5)
  const dateMatch = title.match(/\/(\S+)/);
  if (dateMatch) {
    dateStr = dateMatch[1];
    title = title.replace(dateMatch[0], "").trim();
  }

  // Extract #tag
  const tagMatch = title.match(/#(\S+)/);
  if (tagMatch) {
    tag = tagMatch[1];
    title = title.replace(tagMatch[0], "").trim();
  }

  // Extract @assignee
  const assigneeMatch = title.match(/@(\S+)/);
  if (assigneeMatch) {
    assignee = assigneeMatch[1];
    title = title.replace(assigneeMatch[0], "").trim();
  }

  // Map dateStr to actual Date
  let dueDate: string | null = null;
  if (dateStr) {
    if (dateStr === "今天" || dateStr === "today") {
      dueDate = new Date().toISOString().slice(0, 10);
    } else if (dateStr === "明天" || dateStr === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      dueDate = d.toISOString().slice(0, 10);
    } else {
      try {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          dueDate = parsed.toISOString().slice(0, 10);
        }
      } catch (e) {}
    }
  }

  return {
    title: title || "未命名任务",
    assignee,
    tag,
    dueDate
  };
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const actions = useAppActions();
  const { setSkin } = useSkin();
  const { theme, setTheme } = useTheme();

  const [query, setQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<{
    notes: Array<{ id: string; title: string; snippet?: string }>;
    diaries: Array<{ id: string; snippet: string }>;
    tasks: Array<{ id: string; title: string; projectName?: string }>;
    books: Array<{ bookHash: string; title?: string; author?: string }>;
  }>({ notes: [], diaries: [], tasks: [], books: [] });
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 全局命令列表定义
  const commands = useMemo<CommandItem[]>(() => {
    return [
      {
        id: "new-note",
        type: "command",
        title: "新建笔记",
        subtitle: "在当前选中的笔记本下快速创建一篇富文本笔记",
        shortcut: "Alt+N",
        icon: FileText,
        handler: () => {
          window.dispatchEvent(new CustomEvent("super:quick-new-note"));
        },
      },
      {
        id: "new-diary",
        type: "command",
        title: "新建说说",
        subtitle: "发布一段 Says 碎碎念说说或录音",
        icon: NotebookPen,
        handler: () => {
          window.dispatchEvent(new CustomEvent("super:quick-new-diary"));
        },
      },
      {
        id: "new-task",
        type: "command",
        title: "新建任务",
        subtitle: "在「我的任务」中创建一条任务（统一项目任务体系）",
        icon: ListTodo,
        handler: () => {
          // 方案 A：进入项目任务域；具体创建由 ProjectCenter / FAB 承接
          actions.setViewMode("projects");
          const filter = { type: "my-tasks" };
          sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
          window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
          window.dispatchEvent(new CustomEvent("super:quick-new-task"));
        },
      },
      {
        id: "go-home",
        type: "command",
        title: "前往 首页",
        subtitle: "切换到仪表盘、最近更新及提醒中心",
        icon: Home,
        handler: () => {
          actions.setViewMode("home");
        },
      },
      {
        id: "go-notes",
        type: "command",
        title: "前往 笔记库",
        subtitle: "切换到全部笔记的纵览与列表浏览视图",
        icon: FileText,
        handler: () => {
          actions.setViewMode("all");
          actions.setSelectedNotebook(null);
        },
      },
      {
        id: "go-diary",
        type: "command",
        title: "前往 说说墙",
        subtitle: "切换到 Says 说说卡片与日记中心",
        icon: NotebookPen,
        handler: () => {
          actions.setViewMode("diary");
        },
      },
      {
        id: "go-projects",
        type: "command",
        title: "前往 任务",
        subtitle: "我的任务与家庭项目看板（统一任务入口）",
        icon: Briefcase,
        handler: () => {
          actions.setViewMode("projects");
          const filter = { type: "my-tasks" };
          sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
          window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
        },
      },
      {
        id: "go-mentions",
        type: "command",
        title: "前往 消息盒子",
        subtitle: "查看与我相关的协作通知和提醒",
        icon: Bell,
        handler: () => {
          actions.setViewMode("mentions");
        },
      },
      {
        id: "open-settings",
        type: "command",
        title: "前往 系统设置",
        subtitle: "打开偏好配置、云端同步以及安全选项",
        shortcut: "Cmd+,",
        icon: Settings,
        handler: () => {
          window.dispatchEvent(new CustomEvent("super:open-settings", { detail: { tab: "appearance" } }));
        },
      },
      {
        id: "toggle-theme",
        type: "command",
        title: `切换 深色/浅色模式 (当前: ${theme === "dark" ? "深色" : "浅色"})`,
        subtitle: "快速切换颜色外观为深色或浅色",
        icon: theme === "dark" ? Sun : Moon,
        handler: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "toggle-sidebar",
        type: "command",
        title: "展开/收起 左侧主栏",
        subtitle: "折叠或展开笔记本和标签的侧边管理面板 (Zen Mode)",
        icon: SidebarIcon,
        handler: () => {
          actions.toggleSidebar();
        },
      },
      // 各种皮肤一键切换
      {
        id: "skin-claude",
        type: "command",
        title: "外观皮肤: Claude 风格",
        subtitle: "切换为温润乳沙色底色、书卷衬线体标题的 Claude 皮肤",
        icon: Palette,
        handler: () => {
          setSkin("claude");
        },
      },
      {
        id: "skin-obsidian",
        type: "command",
        title: "外观皮肤: Obsidian 风格",
        subtitle: "切换为高级深海幽蓝护眼的 Obsidian 暗色皮肤",
        icon: Palette,
        handler: () => {
          setSkin("obsidian");
        },
      },
      {
        id: "skin-eink",
        type: "command",
        title: "外观皮肤: 墨水屏风格",
        subtitle: "切换为护眼柔和纸质感墨水屏皮肤",
        icon: Palette,
        handler: () => {
          setSkin("eink");
        },
      },
      {
        id: "skin-mono",
        type: "command",
        title: "外观皮肤: Mono 黑白",
        subtitle: "切换为简约黑白灰极简大气皮肤",
        icon: Palette,
        handler: () => {
          setSkin("mono");
        },
      },

    ];
  }, [theme, setTheme, setSkin, actions]);

  // 合并计算出最终展示项 (DisplayItems) — 含全局多域搜索结果
  type Hit =
    | (CommandItem & { section?: string })
    | { id: string; type: "note"; title: string; snippet?: string; section: string }
    | { id: string; type: "diary"; title: string; snippet?: string; section: string }
    | { id: string; type: "task"; title: string; snippet?: string; section: string }
    | { id: string; type: "book"; title: string; snippet?: string; section: string; bookHash: string };

  const displayItems = useMemo((): Hit[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }

    const parsed = parseNLPTask(query);
    const nlpItem: CommandItem = {
      id: "nlp-create-task",
      type: "command" as const,
      title: `创建任务: "${parsed.title}"`,
      subtitle: `智能解析 ➔ 截止: ${parsed.dueDate || "无"} | 标签: ${parsed.tag || "无"}`,
      icon: ListTodo,
      handler: async () => {
        try {
          const tagIds: string[] = [];
          if (parsed.tag) {
            const allTags = await api.getTags();
            let matchedTag = allTags.find(t => t.name === parsed.tag);
            if (!matchedTag) {
              matchedTag = await api.createTag({ name: parsed.tag, color: "#a855f7" });
              const updatedTags = await api.getTags();
              actions.setTags(updatedTags);
            }
            tagIds.push(matchedTag.id);
          }

          const { createUnifiedTask } = await import("@/lib/taskEntry");
          await createUnifiedTask({
            title: parsed.title,
            dueDate: parsed.dueDate,
            priority: 2,
            tagIds,
          });

          toast.success("创建任务成功！");
          window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
          window.dispatchEvent(new CustomEvent("super:refresh-tasks"));
          window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
          onClose();
        } catch (err: any) {
          toast.error(err?.message || "创建任务失败");
        }
      }
    };

    const filteredCommands = commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q))
    );

    const noteItems: Hit[] = globalResults.notes.map((r) => ({
      id: r.id,
      type: "note" as const,
      title: r.title || "无标题笔记",
      snippet: r.snippet,
      section: "笔记",
    }));
    const diaryItems: Hit[] = globalResults.diaries.map((r) => ({
      id: r.id,
      type: "diary" as const,
      title: (r.snippet || "说说").slice(0, 40),
      snippet: r.snippet,
      section: "说说",
    }));
    const taskItems: Hit[] = globalResults.tasks.map((r) => ({
      id: r.id,
      type: "task" as const,
      title: r.title || "未命名任务",
      snippet: r.projectName,
      section: "任务",
    }));
    const bookItems: Hit[] = globalResults.books.map((r) => ({
      id: r.bookHash,
      type: "book" as const,
      title: r.title || "未命名书籍",
      snippet: r.author,
      section: "书库",
      bookHash: r.bookHash,
    }));

    return [nlpItem, ...filteredCommands, ...noteItems, ...diaryItems, ...taskItems, ...bookItems];
  }, [query, commands, globalResults, actions, onClose]);

  // 打开时：清空旧状态、focus 输入框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setGlobalResults({ notes: [], diaries: [], tasks: [], books: [] });
    setActiveIdx(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  // 关闭时：清理 pending 请求与 debounce
  useEffect(() => {
    if (open) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // query 变化 → debounce 200ms 请求
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (!q) {
      setGlobalResults({ notes: [], diaries: [], tasks: [], books: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      const my = new AbortController();
      abortRef.current?.abort();
      abortRef.current = my;
      try {
        const r = await api.searchGlobal(q);
        if (my.signal.aborted) return;
        setGlobalResults(r);
        setActiveIdx(0);
      } catch (err) {
        if (my.signal.aborted) return;
        console.warn("[CommandPalette] search failed:", err);
        setGlobalResults({ notes: [], diaries: [], tasks: [], books: [] });
      } finally {
        if (!my.signal.aborted) setLoading(false);
      }
    }, 200);
  }, [query, open]);

  // 全局 Cmd/Ctrl+K 触发逻辑
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) {
          window.dispatchEvent(new CustomEvent("super:open-command-palette"));
        }
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const activateHit = useCallback(
    async (hit: any) => {
      try {
        if (hit.type === "command") {
          hit.handler();
          onClose();
          return;
        }
        if (hit.type === "note") {
          const note = await api.getNote(hit.id);
          if (note) {
            actions.setActiveNote(note);
            actions.setViewMode("all");
            actions.setMobileView?.("editor");
          }
        } else if (hit.type === "diary") {
          actions.setViewMode("diary");
          window.dispatchEvent(new CustomEvent("super:open-diary", { detail: { id: hit.id } }));
        } else if (hit.type === "task") {
          const { openTasksEntry } = await import("@/lib/navigation.config");
          openTasksEntry();
          actions.setViewMode("projects");
          window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: hit.id }));
        } else if (hit.type === "book") {
          const { setLibraryTab } = await import("@/lib/navigation.config");
          setLibraryTab("books");
          actions.setViewMode("library");
          window.dispatchEvent(new CustomEvent("super:open-book", { detail: { bookHash: hit.bookHash || hit.id } }));
        }
      } catch (err) {
        console.error("[CommandPalette] activate failed:", err);
      } finally {
        onClose();
      }
    },
    [actions, onClose],
  );

  // 键盘操作响应
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!displayItems.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, displayItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = displayItems[activeIdx];
        if (hit) void activateHit(hit);
      }
    },
    [displayItems, activeIdx, activateHit],
  );

  // 滚动可视区同步
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, displayItems]);

  const body = useMemo(() => {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
        <div
          className="relative w-full max-w-[640px] bg-app-elevated border border-app-border rounded-xl shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="全局搜索与命令面板"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 输入框 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-app-border">
            <SearchIcon size={18} className="text-tx-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="搜索笔记 / 说说 / 任务 / 书库，或输入指令..."
              className="flex-1 bg-transparent outline-none text-sm text-tx-primary placeholder:text-tx-tertiary"
              autoComplete="off"
              spellCheck={false}
            />
            {loading && <Loader2 size={16} className="animate-spin text-tx-tertiary" />}
            <kbd className="hidden sm:inline-flex items-center px-1.5 h-5 rounded border border-app-border text-[10px] text-tx-tertiary">
              Esc
            </kbd>
          </div>

          {/* 选项结果列表 */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {displayItems.length === 0 && query.trim() && !loading && (
              <div className="px-4 py-6 text-center text-sm text-tx-tertiary">
                未找到与 &ldquo;{query}&rdquo; 匹配的项目或指令
              </div>
            )}
            {displayItems.map((item, idx) => {
              const isActive = idx === activeIdx;
              const isCommand = item.type === "command";
              const Icon = item.type === "command"
                ? item.icon
                : item.type === "task"
                  ? ListTodo
                  : item.type === "diary"
                    ? NotebookPen
                    : item.type === "book"
                      ? Book
                      : FileText;

              return (
                <button
                  key={item.id}
                  data-idx={idx}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    if (item.type === "command") {
                      item.handler();
                      onClose();
                    } else {
                      void activateHit(item);
                    }
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors",
                    isActive ? "bg-app-hover" : "hover:bg-app-hover/60"
                  )}
                >
                  <Icon size={16} className={cn("mt-0.5 shrink-0", isCommand ? "text-accent-primary" : "text-tx-tertiary")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-tx-primary truncate flex items-center justify-between">
                      <span>{highlight(item.title || "(无标题)", query)}</span>
                      {item.type === "command" && (
                        <span className="text-[10px] text-tx-tertiary px-1.5 py-0.5 rounded bg-app-surface border border-app-border uppercase font-mono shrink-0 ml-2">
                          {item.shortcut ? item.shortcut : "系统指令"}
                        </span>
                      )}
                    </div>
                    {item.type === "command" && item.subtitle && (
                      <div className="text-xs text-tx-tertiary truncate mt-0.5">
                        {highlight(item.subtitle, query)}
                      </div>
                    )}
                    {item.type === "note" && item.snippet && (
                      <div className="text-xs text-tx-tertiary truncate mt-0.5">
                        {highlight(item.snippet, query)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [open, query, loading, displayItems, activeIdx, onInputKeyDown, activateHit, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
