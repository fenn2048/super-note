import { EmojiPicker } from "./EmojiPicker";
import { useState, useEffect, useRef } from "react";
import { Project, ProjectDiscussion, ProjectTask, NoteListItem } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAppActions } from "@/store/AppContext";
import {
  Send, Smile, Image as ImageIcon, Link2, Link, X, MessageSquare,
  Bookmark, Briefcase, FileText, CheckCircle2, Circle, Loader2, Check, AlertTriangle,
  Sparkles, ArrowRight, Brain
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { cn, detectSuMention } from "@/lib/utils";
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";

interface ProjectDiscussionProps {
  project: Project;
  tasks: ProjectTask[];
}

/* ===== AI 操作类型 ===== */
interface AICreateOp { op: "create_task"; stageName: string; title: string; description?: string; }
interface AIUpdateOp { op: "update_task"; taskId: string; title?: string; description?: string; }
interface AIMoveOp   { op: "move_task"; taskId: string; toStage: string; }
interface AIDeleteOp { op: "delete_task"; taskId: string; }
type AIOp = AICreateOp | AIUpdateOp | AIMoveOp | AIDeleteOp;

interface AISuggestion {
  explanation: string;
  operations: AIOp[];
}

const AI_AVATAR = "🤖";
const AI_NAME = "AI 助手";

export function renderTextWithLinks(text: string) {
  if (!text) return "";
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      parts.push(
        <a 
          key={match.index} 
          href={match[2]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      parts.push(
        <a 
          key={match.index} 
          href={match[3]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {match[3]}
        </a>
      );
    }
    lastIndex = linkRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export default function ProjectDiscussionView({ project, tasks }: ProjectDiscussionProps) {
  const { t } = useTranslation();
  const actions = useAppActions();
  const [posts, setPosts] = useState<ProjectDiscussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  // AI 建议审批状态
  const [pendingSuggestion, setPendingSuggestion] = useState<AISuggestion | null>(null);
  const [executingOps, setExecutingOps] = useState(false);
  // AI 思考中状态
  const [aiThinking, setAiThinking] = useState(false);
  const [alwaysThink, setAlwaysThink] = useState(false);
  const [userQueryText, setUserQueryText] = useState("");

  // Autocomplete @mention states
  const [composerCursorPos, setComposerCursorPos] = useState(0);
  const composerMention = useMentionState(content, composerCursorPos);

  // Link card state
  const [linkedCards, setLinkedCards] = useState<Array<{ type: "task" | "note"; id: string; title: string }>>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkType, setLinkType] = useState<"task" | "note">("task");
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [notesList, setNotesList] = useState<NoteListItem[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Emojis state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);


  const fetchDiscussions = async () => {
    try {
      const data = await api.getProjectDiscussions(project.id);
      setPosts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiscussions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // 监听项目刷新事件
  useEffect(() => {
    const handler = () => { fetchDiscussions(); };
    window.addEventListener("super:projects-refreshed", handler);
    return () => window.removeEventListener("super:projects-refreshed", handler);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [posts, aiThinking]);

  useEffect(() => {
    if (!showLinkPicker) return;
    if (linkType === "note") {
      setLoadingNotes(true);
      api.getNotes()
        .then((data) => setNotesList(data))
        .catch(console.error)
        .finally(() => setLoadingNotes(false));
    } else {
      // 打开任务列表时也刷新项目数据
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    }
  }, [showLinkPicker, linkType]);

  /** 判断是否为 AI 消息 */
  function isAIPost(post: ProjectDiscussion): boolean {
    return post.content?.startsWith("**AI 助手**") || post.content?.startsWith(AI_AVATAR);
  }

  /** 从 AI 回复文本中提取 JSON 操作块 */
  function parseAIOperations(aiText: string): AIOp[] {
    try {
      const jsonMatch = aiText.match(/```json\s*(\[[\s\S]*?\])\s*```/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[1]);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(op =>
        ["create_task", "update_task", "move_task", "delete_task"].includes(op.op)
      ) as AIOp[];
    } catch {
      return [];
    }
  }

  /** 执行一条 AI 操作 */
  async function executeOperation(op: AIOp): Promise<string> {
    switch (op.op) {
      case "create_task": {
        const stages = await api.getProjectStages(project.id);
        let stage = stages.find(s => s.name === op.stageName);
        if (!stage) stage = stages[0];
        if (!stage) throw new Error("项目没有阶段");
        const created = await api.createProjectTask(project.id, {
          stageId: stage.id,
          title: op.title,
          description: op.description || "",
        });
        return `✅ 创建任务「${created.title}」[${op.stageName}]`;
      }
      case "update_task": {
        const changes: Record<string, any> = {};
        if (op.title !== undefined) changes.title = op.title;
        if (op.description !== undefined) changes.description = op.description;
        if (Object.keys(changes).length > 0) {
          await api.updateProjectTask(op.taskId, changes);
        }
        return `✅ 已更新任务 ${op.title ? `「${op.title}」` : op.taskId}`;
      }
      case "move_task": {
        const stages = await api.getProjectStages(project.id);
        const targetStage = stages.find(s => s.name === op.toStage);
        if (!targetStage) throw new Error(`找不到阶段「${op.toStage}」`);
        await api.updateProjectTask(op.taskId, { stageId: targetStage.id });
        return `✅ 任务已移至「${op.toStage}」`;
      }
      case "delete_task": {
        await api.deleteProjectTask(op.taskId);
        return `✅ 已删除任务`;
      }
    }
  }

  /** 执行所有已批准的操作 */
  const handleApproveSuggestion = async () => {
    if (!pendingSuggestion) return;
    setExecutingOps(true);
    const results: string[] = [];
    let hasError = false;
    for (const op of pendingSuggestion.operations) {
      try {
        const result = await executeOperation(op);
        results.push(result);
      } catch (err: any) {
        results.push(`❌ 操作失败: ${err.message || err}`);
        hasError = true;
      }
    }
    // 刷新项目数据
    window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    const resultContent = `**AI 助手** 🤖\n\n${pendingSuggestion.explanation}\n\n---\n**执行结果**\n${results.join("\n")}`;
    try {
      await api.createProjectDiscussion(project.id, {
        content: resultContent,
        linkedCards: [],
        images: [],
        attachments: [],
      });
      await fetchDiscussions();
    } catch { /* ignore */ }
    setPendingSuggestion(null);
    setExecutingOps(false);
    if (!hasError) toast.success("所有操作已执行完成");
    else toast.error("部分操作执行失败，请检查详情");
  };

  const handleRejectSuggestion = () => {
    setPendingSuggestion(null);
    toast.info("已拒绝 AI 建议");
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && linkedCards.length === 0) return;

    const rawContent = content.trim();
    const su = detectSuMention(rawContent);

    if (su.hasSu) {
      // 1) 立即显示用户消息
      const userMsg: ProjectDiscussion = {
        id: `user-${Date.now()}`,
        projectId: project.id,
        userId: "me",
        username: "我",
        displayName: "我",
        content: su.cleanText,
        linkedCards: [],
        images: [],
        attachments: [],
        createdAt: new Date().toISOString(),
      } as any;
      setPosts((prev) => [...prev, userMsg]);
      setUserQueryText(su.cleanText);
      setAiThinking(true);
      setContent("");

      // 2) 异步调用 AI
      let tasksContext = "";
      try {
        const stages = await api.getProjectStages(project.id);
        if (stages.length > 0) {
          const taskItems = stages.flatMap(s => (s.tasks || []).map(t => ({
            id: t.id,
            stage: s.name,
            title: t.title,
            assignee: (t as any).assigneeName || "未分配",
            priority: t.priority,
            endDate: t.endDate || "无截止日期",
            isCompleted: t.isCompleted,
            progress: t.progress || 0,
          })));
          if (taskItems.length > 0) {
            tasksContext = "\n## 项目任务列表\n" + taskItems.map(t =>
              `- id:${t.id} [${t.isCompleted ? "已完成" : "进行中"}] ${t.title} | 阶段:${t.stage} | 负责人:${t.assignee} | 优先级:${t.priority} | 截止:${t.endDate} | 进度:${t.progress}%`
            ).join("\n");
          }
        }
      } catch { /* ignore */ }

      const fullContext =
        `项目名称：${project.name}\n` +
        `项目描述：${project.description || "无"}\n` +
        tasksContext;
      const customPrompt =
        `你是一位资深项目管理专家，正在参与以下项目的讨论。\n\n` +
        `${fullContext}\n\n` +
        `请根据以上项目信息，回答用户的问题。你可以：\n` +
        `1. 分析、总结项目中的单条或多条任务\n` +
        `2. 对任务进行合并或拆解提出具体的操作建议\n` +
        `3. 分析任务之间的依赖关系，建议调整优先级或排序\n` +
        `4. 建议创建新任务、删除冗余任务、修改任务描述或负责人\n` +
        `5. 对项目进度、资源分配给出专家建议\n` +
        `6. 回答用户关于项目管理方面的任何问题\n\n` +
        `如果需要执行操作，请先给出文字分析，然后在回复末尾加上 JSON 代码块：\`\`\`json\n` +
        `包含操作数组，每项格式为 {\"op\":\"create_task|update_task|move_task|delete_task\", ...}\n` +
        `- create_task: {op:"create_task", stageName:"阶段名称", title:"任务标题", description:"描述"}\n` +
        `- update_task: {op:"update_task", taskId:"任务的id", title:"新标题", description:"新描述"}\n` +
        `- move_task: {op:"move_task", taskId:"任务的id", toStage:"目标阶段名称"}\n` +
        `- delete_task: {op:"delete_task", taskId:"任务的id"}\n` +
        `\`\`\`\n\n` +
        `用户 review 后可以选择执行或拒绝这些操作。\n\n` +
        `注意：任务 id 已在任务列表中给出，请直接引用正确的 id。`;

      try {
        const aiTempPostId = `ai-temp-${Date.now()}`;
        const aiTempMsg: ProjectDiscussion = {
          id: aiTempPostId,
          projectId: project.id,
          userId: "ai",
          username: AI_NAME,
          displayName: AI_NAME,
          content: `**AI 助手** 🤖\n\n`,
          linkedCards: [],
          images: [],
          attachments: [],
          createdAt: new Date().toISOString(),
        } as any;
        setPosts((prev) => [...prev, aiTempMsg]);

        let accumulatedReply = "";
        const aiReply = await api.aiChat(
          "custom",
          su.cleanText,
          fullContext,
          (chunk) => {
            accumulatedReply += chunk;
            setPosts((prev) =>
              prev.map((p) =>
                p.id === aiTempPostId
                  ? { ...p, content: `**AI 助手** 🤖\n\n${accumulatedReply}` }
                  : p
              )
            );
          },
          customPrompt,
          alwaysThink ? true : undefined
        );

        const ops = parseAIOperations(aiReply);

        setAiThinking(false);
        setPosts((prev) => prev.filter((p) => p.id !== aiTempPostId));

        if (ops.length > 0) {
          const explanation = aiReply.replace(/```json[\s\S]*```/, "").trim();
          setPendingSuggestion({ explanation, operations: ops });
        } else {
          const aiPost = await api.createProjectDiscussion(project.id, {
            content: `**AI 助手** 🤖\n\n${aiReply}`,
            linkedCards: [],
            images: [],
            attachments: [],
          });
          setPosts((prev) => [...prev, aiPost]);
        }
      } catch (err: any) {
        setAiThinking(false);
        setPosts((prev) => prev.filter((p) => p.id && !p.id.startsWith("ai-temp-")));
        // 显示错误消息
        const errorPost: ProjectDiscussion = {
          id: `ai-error-${Date.now()}`,
          projectId: project.id,
          userId: "ai",
          username: AI_NAME,
          displayName: AI_NAME,
          content: `**AI 助手** 🤖\n\n抱歉，AI 回复失败：${err?.message || "未知错误"}`,
          linkedCards: [],
          images: [],
          attachments: [],
          createdAt: new Date().toISOString(),
        } as any;
        setPosts((prev) => [...prev, errorPost]);
      }
      return;
    }

    setSending(true);
    try {
      const newPost = await api.createProjectDiscussion(project.id, {
        content: rawContent,
        linkedCards,
        images: [],
        attachments: [],
      });
      setPosts((prev) => [...prev, newPost]);
      setContent("");
      setLinkedCards([]);
      setShowEmojiPicker(false);
    } catch (err: any) {
      toast.error(err?.message || "发布讨论失败");
    } finally {
      setSending(false);
    }
  };

  const addEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleLinkCardSelect = (item: { id: string; title: string }) => {
    if (linkedCards.some((c) => c.id === item.id && c.type === linkType)) {
      toast.info("已经关联了该卡片");
      return;
    }
    setLinkedCards((prev) => [...prev, { type: linkType, id: item.id, title: item.title }]);
    setShowLinkPicker(false);
    setLinkSearchQuery("");
  };

  const removeLinkedCard = (id: string, type: "task" | "note") => {
    setLinkedCards((prev) => prev.filter((c) => !(c.id === id && c.type === type)));
  };

  const filteredTasks = tasks.filter((t) =>
    t.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

  const filteredNotes = notesList.filter((n) =>
    n.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

  const handleCardClick = (card: { type: "task" | "note"; id: string; title: string }) => {
    if (card.type === "note") {
      actions.setSelectedNotebook(null);
      actions.setViewMode("all");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("super:open-note", { detail: card.id }));
      }, 50);
    } else {
      window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: card.id }));
    }
  };

  const opLabel = (op: AIOp): string => {
    switch (op.op) {
      case "create_task": return `创建任务「${op.title}」到 ${op.stageName}`;
      case "update_task": {
        const changes: string[] = [];
        if (op.title) changes.push(`标题→${op.title}`);
        if (op.description) changes.push(`描述→${op.description?.slice(0, 20)}…`);
        return `修改任务 ${changes.join(", ")}`;
      }
      case "move_task": return `移动任务到「${op.toStage}」`;
      case "delete_task": return `删除任务`;
    }
  };

  /** 渲染消息头像 */
  function renderAvatar(post: ProjectDiscussion) {
    if (isAIPost(post)) {
      return (
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 shrink-0 flex items-center justify-center text-sm">
          {AI_AVATAR}
        </div>
      );
    }
    if (post.avatarUrl) {
      return (
        <img
          src={post.avatarUrl}
          alt={post.displayName || post.username}
          className="w-9 h-9 rounded-full border border-app-border shrink-0 object-cover"
        />
      );
    }
    return (
      <div className="w-9 h-9 rounded-full bg-accent-primary/10 border border-app-border shrink-0 flex items-center justify-center text-xs font-bold text-accent-primary uppercase select-none">
        {(post.displayName || post.username || "?").slice(0, 1)}
      </div>
    );
  }

  /** 渲染消息发送者名称 */
  function renderAuthor(post: ProjectDiscussion) {
    if (isAIPost(post)) {
      return (
        <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
          {AI_NAME}
        </span>
      );
    }
    if (post.userId === "me") {
      return (
        <span className="text-xs font-bold text-tx-primary">
          我
        </span>
      );
    }
    return (
      <span className="text-xs font-bold text-tx-primary">
        {post.displayName || post.username}
      </span>
    );
  }

  return (
    <div className="flex flex-col h-full bg-app-bg pb-20 relative">
      {/* Scrollable Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent-primary" />
          </div>
        ) : posts.length === 0 && !pendingSuggestion && !aiThinking ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary h-full">
            <MessageSquare size={48} className="stroke-1 mb-2 opacity-50" />
            <p className="text-sm font-semibold">{t("projects.noDiscussions") || "暂无讨论内容"}</p>
            <p className="text-xs max-w-xs">{t("projects.noDiscussionsDesc") || "在下方输入框中发布讨论、@成员或关联卡片"}</p>
          </div>
        ) : (
          <>
            {posts.map((post) => (
              <div key={post.id} className="flex items-start gap-3 group/post animate-in fade-in duration-fast">
                {renderAvatar(post)}
                <div className="flex-1 space-y-1.5 max-w-[85%]">
                  <div className="flex items-baseline gap-2">
                    {renderAuthor(post)}
                    <span className="text-[10px] text-tx-tertiary font-mono">
                      {new Date(post.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={cn(
                    "border rounded-2xl px-4 py-2.5 text-xs shadow-sm leading-relaxed whitespace-pre-wrap",
                    isAIPost(post)
                      ? "bg-gradient-to-br from-violet-50 to-pink-50 dark:from-violet-500/5 dark:to-pink-500/5 border-violet-200/50 dark:border-violet-500/20 text-tx-secondary"
                      : "bg-app-sidebar border-app-border text-tx-secondary"
                  )}>
                    {renderTextWithLinks(post.content)}
                    {post.linkedCards && post.linkedCards.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-app-border/40 flex flex-wrap gap-2">
                        {post.linkedCards.map((card) => (
                          <div
                            key={card.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-app-hover border border-app-border hover:bg-app-active/50 transition-colors cursor-pointer select-none"
                            onClick={() => handleCardClick(card)}
                          >
                            {card.type === "note" ? (
                              <FileText size={12} className="text-accent-primary shrink-0" />
                            ) : (
                              <Briefcase size={12} className="text-amber-500 shrink-0" />
                            )}
                            <span className="text-[10px] font-semibold text-tx-secondary truncate max-w-[150px]">
                              {card.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* AI 思考中 loading */}
            {aiThinking && (
              <div className="flex items-start gap-3 animate-in fade-in duration-200">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 shrink-0 flex items-center justify-center text-sm">
                  {AI_AVATAR}
                </div>
                <div className="flex-1 max-w-[85%]">
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                      {AI_NAME}
                    </span>
                  </div>
                  <div className="bg-gradient-to-br from-violet-50 to-pink-50 dark:from-violet-500/5 dark:to-pink-500/5 border border-violet-200/50 dark:border-violet-500/20 rounded-2xl px-4 py-3 text-xs shadow-sm flex items-center gap-2.5">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-violet-500/70 text-[11px] font-medium">AI 正在思考...</span>
                  </div>
                </div>
              </div>
            )}

            {/* AI 建议审批卡片 */}
            {pendingSuggestion && (
              <div className="flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-fast">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 shrink-0 flex items-center justify-center text-sm">
                  {AI_AVATAR}
                </div>
                <div className="flex-1 max-w-[85%] space-y-2">
                  <div className="bg-app-sidebar border border-violet-500/30 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-bold text-violet-600 dark:text-violet-400 mb-1.5 flex items-center gap-1.5">
                      <Sparkles size={13} />
                      AI 建议
                    </div>
                    <div className="text-xs text-tx-secondary leading-relaxed whitespace-pre-wrap mb-3">
                      {pendingSuggestion.explanation}
                    </div>
                    <div className="space-y-1 mb-3">
                      {pendingSuggestion.operations.map((op, i) => (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-app-bg border border-app-border/60 text-[11px] text-tx-secondary">
                          {op.op === "create_task" && <FileText size={12} className="text-green-500 shrink-0" />}
                          {op.op === "update_task" && <Briefcase size={12} className="text-amber-500 shrink-0" />}
                          {op.op === "move_task" && <ArrowRight size={12} className="text-blue-500 shrink-0" />}
                          {op.op === "delete_task" && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                          <span className="truncate">{opLabel(op)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleApproveSuggestion}
                        disabled={executingOps}
                        className="h-7 text-xs px-3 bg-green-600 hover:bg-green-700 text-white"
                      >
                        {executingOps ? (
                          <Loader2 size={12} className="animate-spin mr-1" />
                        ) : (
                          <Check size={12} className="mr-1" />
                        )}
                        批准执行
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRejectSuggestion}
                        disabled={executingOps}
                        className="h-7 text-xs px-3"
                      >
                        拒绝
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Linked Cards preview */}
      {linkedCards.length > 0 && (
        <div className="px-4 py-2 bg-app-sidebar border-t border-app-border flex flex-wrap gap-2 shrink-0 select-none">
          {linkedCards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-app-hover border border-app-border text-[10px] text-tx-secondary font-semibold"
            >
              {card.type === "note" ? (
                <FileText size={11} className="text-accent-primary shrink-0" />
              ) : (
                <Briefcase size={11} className="text-amber-500 shrink-0" />
              )}
              <span className="truncate max-w-[120px]">{card.title}</span>
              <button
                type="button"
                onClick={() => removeLinkedCard(card.id, card.type)}
                className="p-0.5 hover:bg-app-active rounded text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Emojis Selector Bar */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 left-4 bg-app-elevated border border-app-border rounded-xl shadow-xl z-20 select-none animate-in slide-in-from-bottom-2 duration-200">
          <EmojiPicker
            onSelectTextEmoji={addEmoji}
            onSelectImageEmoji={(url) => addEmoji(`![emoji](${url})`)}
          />
        </div>
      )}

      {composerMention && (
        <div className="relative z-50 px-3 bg-app-sidebar/20">
          <MentionPicker
            search={composerMention.search}
            onSelect={(user) => {
              const newText = replaceMentionText(content, composerCursorPos, composerMention.startIndex, user.username);
              setContent(newText);
              setComposerCursorPos(composerMention.startIndex + user.username.length + 2);
              composerMention.clear();
            }}
            onClose={composerMention.clear}
          />
        </div>
      )}

      {/* Thinking Toggle */}
      <div className="px-3 py-1 flex items-center justify-between bg-app-sidebar/40 border-t border-app-border/40 select-none shrink-0">
        <button
          type="button"
          onClick={() => setAlwaysThink(!alwaysThink)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out cursor-pointer select-none",
            alwaysThink
              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
              : "bg-app-surface text-tx-tertiary border-app-border hover:border-zinc-300 dark:hover:border-zinc-700"
          )}
          title={alwaysThink ? "已直接启用深度思考模式" : "当输入包含特定关键词（如分析、拆解、规划）时自动启用深度思考模式"}
        >
          <Brain size={10} className={cn(alwaysThink ? "animate-pulse" : "")} />
          <span>{alwaysThink ? "深度思考" : "自动深度思考"}</span>
        </button>
      </div>

      {/* Text Composer Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-app-border bg-app-sidebar flex items-center gap-2 shrink-0">
        <div className="relative flex-1 flex items-center bg-app-bg border border-app-border rounded-xl px-3 py-1.5 focus-within:ring-1 focus-within:ring-accent-primary focus-within:border-accent-primary transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out">
          <Input
            ref={composerInputRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setComposerCursorPos(e.target.selectionStart || 0);
            }}
            onKeyUp={(e) => {
              const target = e.target as HTMLInputElement;
              setComposerCursorPos(target.selectionStart || 0);
            }}
            onSelect={(e) => {
              const target = e.target as HTMLInputElement;
              setComposerCursorPos(target.selectionStart || 0);
            }}
            placeholder={t("projects.typeMessage") || "输入讨论内容…"}
            className="flex-1 border-none bg-transparent h-7 text-xs focus-visible:ring-0 p-0 placeholder:text-tx-tertiary"
            disabled={sending || aiThinking}
          />
          <div className="flex items-center gap-1.5 shrink-0 pl-2 text-tx-tertiary">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1 hover:bg-app-hover rounded-lg hover:text-tx-primary transition-colors"
              title={t("projects.addEmoji") || "添加表情"}
            >
              <Smile size={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowLinkPicker(true)}
              className="p-1 hover:bg-app-hover rounded-lg hover:text-tx-primary transition-colors"
              title={t("projects.linkCard") || "关联卡片"}
            >
              <Link2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                const url = window.prompt("输入链接地址 (URL)", "https://");
                if (!url) return;
                const linkText = window.prompt("输入链接文字", "链接");
                if (!linkText) return;
                const formatted = `[${linkText}](${url})`;
                const input = composerInputRef.current;
                if (input) {
                  const start = input.selectionStart || 0;
                  const end = input.selectionEnd || 0;
                  const before = content.substring(0, start);
                  const after = content.substring(end);
                  setContent(before + formatted + after);
                } else {
                  setContent(content + formatted);
                }
              }}
              className="p-1 hover:bg-app-hover rounded-lg hover:text-tx-primary transition-colors"
              title="插入网页链接"
            >
              <Link size={15} />
            </button>
          </div>
        </div>
        <Button
          type="submit"
          size="icon"
          className="h-8 w-8 rounded-xl shrink-0 bg-accent-primary hover:bg-accent-primary/90 text-white"
          disabled={sending || aiThinking || (!content.trim() && linkedCards.length === 0)}
        >
          {sending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </Button>
      </form>

      {/* Link Card Dialog */}
      {showLinkPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowLinkPicker(false)}
          />
          <div className="relative bg-app-elevated w-full max-w-md p-5 rounded-2xl border border-app-border shadow-2xl flex flex-col max-h-[70vh] animate-in scale-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">
                {t("projects.linkCardTitle") || "关联项目卡片或笔记"}
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkPicker(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex bg-app-sidebar p-1 rounded-lg border border-app-border/40 mt-3 shrink-0">
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  linkType === "task" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-tertiary"
                }`}
                onClick={() => setLinkType("task")}
              >
                <Briefcase size={13} />
                <span>{t("projects.projectTask") || "项目任务"}</span>
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  linkType === "note" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-tertiary"
                }`}
                onClick={() => setLinkType("note")}
              >
                <FileText size={13} />
                <span>{t("projects.workspaceNote") || "空间笔记"}</span>
              </button>
            </div>
            <div className="mt-3 shrink-0 relative">
              <Input
                placeholder={t("projects.searchLinkPlaceholder") || "搜索标题…"}
                value={linkSearchQuery}
                onChange={(e) => setLinkSearchQuery(e.target.value)}
                className="h-8 text-xs pl-3 border-app-border"
              />
            </div>
            <ScrollArea className="flex-1 min-h-0 mt-3 border border-app-border/40 rounded-xl bg-app-sidebar/20">
              <div className="p-1.5 space-y-1">
                {linkType === "task" ? (
                  filteredTasks.length === 0 ? (
                    <p className="text-xs text-tx-tertiary text-center py-6">没有找到匹配的任务</p>
                  ) : (
                    filteredTasks.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleLinkCardSelect({ id: t.id, title: t.title })}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-app-hover cursor-pointer text-xs font-medium text-tx-secondary hover:text-tx-primary border border-transparent hover:border-app-border/40 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {t.isCompleted === 1 ? (
                            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                          ) : (
                            <Circle size={13} className="text-tx-tertiary shrink-0" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </div>
                      </div>
                    ))
                  )
                ) : loadingNotes ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={18} className="animate-spin text-accent-primary" />
                  </div>
                ) : filteredNotes.length === 0 ? (
                  <p className="text-xs text-tx-tertiary text-center py-6">没有找到匹配的笔记</p>
                ) : (
                  filteredNotes.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleLinkCardSelect({ id: n.id, title: n.title })}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-app-hover cursor-pointer text-xs font-medium text-tx-secondary hover:text-tx-primary border border-transparent hover:border-app-border/40 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText size={13} className="text-accent-primary shrink-0" />
                        <span className="truncate">{n.title || "无标题笔记"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
