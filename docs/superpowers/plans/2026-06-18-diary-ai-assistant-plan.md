# 说说 AI 助手 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在说说模块中集成 AI 助手，用户通过 `@su` 调起，AI 以专用账号回复

**Architecture:** 新增 `POST /api/diary/ai-ask` 端点统一处理发布框(RAG全局检索)和评论区(仅当前说说上下文)两种模式。AI 身份为预置的 `ai-assistant` 用户。通知复用现有 `notifications` + `broadcastToUser` 机制。

**Tech Stack:** Hono (后端), React + TypeScript (前端), SQLite (DB)

## Global Constraints

- 所有 SQL 使用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` 幂等模式
- AI 请求复用 `/ai/chat` 底层的 LLM 调用逻辑（非流式）
- 前端 `@su` 检测复用 `utils.ts:detectSuMention()`
- 通知类型新增 `ai_diary_reply` 但不改表结构

---

### Task 1: AI 助手账号初始化 + 数据模型扩展

**Files:**
- Modify: `backend/src/db/schema.ts` — 在 `initSchema()` 末尾的 `diary_comments` 建表之后加 `trigger_user_id` 列的 ALTER TABLE
- Modify: `backend/src/db/seed.ts` — 添加 `initAiAssistantUser()` 函数

- [ ] **Step 1: 在 diary_comments 和 diaries 表添加 trigger_user_id 列**

在 `backend/src/db/schema.ts` 的 `initSchema()` 函数末尾（`CREATE INDEX IF NOT EXISTS idx_diary_comments_diary ON diary_comments(diaryId);` 之后），添加 ALTER TABLE 语句（幂等，失败静默忽略）：

```typescript
// 说说 AI 助手：trigger_user_id 记录谁调起了 AI
try { db.exec("ALTER TABLE diary_comments ADD COLUMN trigger_user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE diaries ADD COLUMN trigger_user_id TEXT"); } catch {}
```

- [ ] **Step 2: 添加 AI 助手用户初始化函数**

在 `backend/src/db/seed.ts` 中添加 `initAiAssistantUser()` 函数：

```typescript
import crypto from "crypto";

const AI_ASSISTANT_ID = "00000000-0000-0000-0000-000000000001";

export function initAiAssistantUser() {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(AI_ASSISTANT_ID);
  if (existing) return;

  const randomHash = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex");
  db.prepare(`
    INSERT INTO users (id, username, email, passwordHash, role, displayName, avatarUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    AI_ASSISTANT_ID,
    "ai-assistant",
    null,
    randomHash,
    "ai",
    "AI 助手",
    null,
  );
}

export const AI_ASSISTANT_USER_ID = AI_ASSISTANT_ID;
```

然后在 `backend/src/index.ts` 中 `seedDatabase()` 调用后添加：

```typescript
import { initAiAssistantUser } from "./db/seed";
initAiAssistantUser();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/seed.ts backend/src/index.ts
git commit -m "feat(db): add ai-assistant user and trigger_user_id columns for diary AI"
```

---

### Task 2: 后端新增 /api/diary/ai-ask 端点

**Files:**
- Modify: `backend/src/routes/diary.ts` — 新增 AI ask 路由
- Modify: `backend/src/routes/ai.ts` — 导出 `extractKeywords` 和底层 LLM 调用函数

**Interfaces:**
- Consumes: `AI_ASSISTANT_USER_ID` from `db/seed.ts`, `detectSuMention` pattern
- Produces: `POST /api/diary/ai-ask` 端点

- [ ] **Step 1: 在 ai.ts 中导出 extractKeywords**

在 `backend/src/routes/ai.ts` 中将 `extractKeywords` 函数导出：

```typescript
// 在文件末尾或函数定义处添加 export
export { extractKeywords };
```

同时提取一个 `callLLM` 工具函数以便 diary-ai 复用：

```typescript
// 在 ai.ts 末尾添加
export async function callLLM(systemPrompt: string, userMessage: string, context?: string): Promise<string> {
  const settings = getAISettings();
  if (!settings.ai_api_url) throw new Error("未配置 AI 服务");
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) throw new Error("未配置 API Key");

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];
  if (context) {
    messages.push({ role: "system", content: `参考上下文：\n${context.slice(0, 4000)}` });
  }
  messages.push({ role: "user", content: userMessage });

  const baseUrl = settings.ai_api_url.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) headers["Authorization"] = `Bearer ${settings.ai_api_key}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.ai_model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI 服务错误: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || "";
}
```

- [ ] **Step 2: 在 diary.ts 中添加 ai-ask 路由**

在 `backend/src/routes/diary.ts` 文件末尾（`export default diary;` 之前）添加：

```typescript
// ===== 说说 AI 助手 =====
import { extractKeywords, callLLM } from "./ai";
import { AI_ASSISTANT_USER_ID } from "../db/seed";

interface DiaryAiRequestBody {
  mode: "post" | "comment";
  diaryId?: string;
  question: string;
}

diary.post("/ai-ask", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json() as DiaryAiRequestBody;
  const { mode, diaryId, question } = body;

  if (!question?.trim()) {
    return c.json({ error: "请输入问题" }, 400);
  }
  if (mode === "comment" && !diaryId) {
    return c.json({ error: "缺少 diaryId" }, 400);
  }

  // 1. 收集上下文
  let context = "";
  if (mode === "post") {
    // RAG 检索：使用 extractKeywords + FTS5/LIKE 搜索笔记
    const keywords = extractKeywords(question);
    let notes: { id: string; title: string; snippet: string }[] = [];

    if (keywords.length > 0) {
      const likeClauses = keywords.slice(0, 5).map(() => "(contentText LIKE ? OR title LIKE ?)").join(" OR ");
      const likeParams = keywords.slice(0, 5).flatMap(k => [`%${k}%`, `%${k}%`]);
      try {
        notes = db.prepare(`
          SELECT id, title, substr(contentText, 1, 500) AS snippet FROM notes
          WHERE userId = ? AND isTrashed = 0 AND (${likeClauses})
          ORDER BY updatedAt DESC LIMIT 5
        `).all(userId, ...likeParams) as any[];
      } catch {}
    }

    // 也搜索说说本身
    let diaries: { contentText: string }[] = [];
    if (keywords.length > 0) {
      const dLikeClauses = keywords.slice(0, 5).map(() => "(contentText LIKE ?)").join(" OR ");
      const dLikeParams = keywords.slice(0, 5).flatMap(k => [`%${k}%`]);
      try {
        diaries = db.prepare(`
          SELECT contentText FROM diaries
          WHERE userId = ? AND (${dLikeClauses})
          ORDER BY createdAt DESC LIMIT 5
        `).all(userId, ...dLikeParams) as any[];
      } catch {}
    }

    // 搜索项目
    let projects: { name: string; description: string }[] = [];
    try {
      const projectRows = db.prepare(`
        SELECT p.name, p.description FROM projects p
        LEFT JOIN project_members pm ON pm.projectId = p.id
        WHERE (p.ownerId = ? OR pm.userId = ?) AND p.isArchived = 0
        ORDER BY p.updatedAt DESC LIMIT 10
      `).all(userId, userId) as any[];
      projects = projectRows;
    } catch {}

    // 拼上下文
    const parts: string[] = [];
    if (notes.length > 0) {
      parts.push("【相关笔记】\n" + notes.map(n => `- ${n.title}: ${n.snippet}`).join("\n"));
    }
    if (diaries.length > 0) {
      parts.push("【相关说说】\n" + diaries.map(d => `- ${d.contentText.slice(0, 200)}`).join("\n"));
    }
    if (projects.length > 0) {
      parts.push("【项目列表】\n" + projects.map(p => `- ${p.name}: ${(p.description || "无描述").slice(0, 200)}`).join("\n"));
    }
    context = parts.join("\n\n");
  } else {
    // comment 模式：取说说内容 + 已有评论
    const diaryRow = db.prepare("SELECT contentText FROM diaries WHERE id = ?").get(diaryId) as { contentText: string } | undefined;
    if (!diaryRow) return c.json({ error: "说说不存在" }, 404);

    const comments = db.prepare(`
      SELECT content, username FROM diary_comments dc
      JOIN users u ON u.id = dc.userId
      WHERE dc.diaryId = ? ORDER BY dc.createdAt ASC LIMIT 20
    `).all(diaryId) as { content: string; username: string }[];

    const commentText = comments.map(c => `@${c.username}: ${c.content}`).join("\n");
    context = `【说说原文】\n${diaryRow.contentText}\n\n【已有评论】\n${commentText || "暂无评论"}`;
  }

  // 2. 调用 LLM
  const systemPrompt = mode === "post"
    ? `你是一位知识渊博的专家助手，基于用户的笔记、说说和项目信息回答问题。请给出简明扼要、专业的回答，不要超过 500 字。回答应直接针对问题，不要添加无关信息。`
    : `你是一位专业分析助手，基于当前说说及其评论内容回答问题。请给出简明扼要、有洞察力的分析。不要超过 500 字。`;

  let answer: string;
  try {
    answer = await callLLM(systemPrompt, question, context);
  } catch (err: any) {
    return c.json({ error: err.message || "AI 请求失败" }, 502);
  }

  // 3. 根据 mode 创建内容
  if (mode === "post") {
    const diaryId = crypto.randomUUID();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    db.prepare(`
      INSERT INTO diaries (id, userId, contentText, mood, images, visibility, voice, createdAt, trigger_user_id)
      VALUES (?, ?, ?, '', '[]', 'PUBLIC', NULL, ?, ?)
    `).run(diaryId, AI_ASSISTANT_USER_ID, answer, now, userId);

    const created = db.prepare(`
      SELECT d.*, u.username AS creatorName
      FROM diaries d
      JOIN users u ON u.id = d.userId
      WHERE d.id = ?
    `).get(diaryId) as any;

    // 发送通知
    sendAiNotification(db, userId, diaryId, answer, "post");

    return c.json({ mode: "post", diary: rowToDiary(created) });
  } else {
    // comment 模式
    const commentId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO diary_comments (id, diaryId, userId, content, createdAt, updatedAt, trigger_user_id)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)
    `).run(commentId, diaryId, AI_ASSISTANT_USER_ID, answer.trim(), userId);

    const newComment = db.prepare(`
      SELECT dc.*, COALESCE(u.displayName, u.username) AS username, u.avatarUrl
      FROM diary_comments dc
      JOIN users u ON u.id = dc.userId
      WHERE dc.id = ?
    `).get(commentId);

    // 发送通知
    sendAiNotification(db, userId, diaryId, answer, "comment");

    return c.json({ mode: "comment", comment: newComment }, 201);
  }
});
```

- [ ] **Step 3: 添加通知发送辅助函数**

在上面的路由之前添加：

```typescript
function sendAiNotification(
  db: any,
  targetUserId: string,
  diaryId: string,
  answer: string,
  mode: "post" | "comment",
) {
  try {
    const diaryTitle = (db.prepare("SELECT contentText FROM diaries WHERE id = ?").get(diaryId) as any)?.contentText || "";
    const sourceTitle = diaryTitle.slice(0, 50);

    // 写入 notification
    const notifId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO notifications (id, userId, type, sourceType, sourceId, sourceTitle, actorId, actorName, createdAt)
       VALUES (?, ?, 'ai_diary_reply', 'diary', ?, ?, ?, 'AI 助手', datetime('now'))`
    ).run(notifId, targetUserId, diaryId, sourceTitle, AI_ASSISTANT_USER_ID);

    // WebSocket 实时推送
    try {
      const { broadcastToUser } = require("../services/realtime");
      broadcastToUser(targetUserId, {
        type: "diary:ai-reply",
        mode,
        diaryId,
        snippet: answer.slice(0, 80),
      });
    } catch {}
  } catch (e) {
    console.warn("[diary] sendAiNotification failed:", e);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/diary.ts backend/src/routes/ai.ts
git commit -m "feat(api): add POST /api/diary/ai-ask endpoint for diary AI assistant"
```

---

### Task 3: 后端扩展删除权限

**Files:**
- Modify: `backend/src/routes/diary.ts` — 修改 DELETE /:id 和 DELETE /comments/:commentId

- [ ] **Step 1: 扩展说说删除权限**

在 `diary.delete("/:id", ...)` 中修改权限判断：

```typescript
// 原: row.userId 是 diary 的创建者
// 新增: row.trigger_user_id 是调起 AI 的用户
const canDelete = row.userId === userId || row.trigger_user_id === userId || canManageResource(row.userId, row.workspaceId, userId);
if (!canDelete) {
  return c.json({ error: "无权删除该说说", code: "FORBIDDEN" }, 403);
}
```

同时修改 SELECT 查询获取 `trigger_user_id`：
```typescript
// 原:
// .prepare("SELECT id, userId, workspaceId FROM diaries WHERE id = ?")
// 改为:
.prepare("SELECT id, userId, workspaceId, trigger_user_id FROM diaries WHERE id = ?")
```

- [ ] **Step 2: 扩展评论删除权限**

在 `diary.delete("/comments/:commentId", ...)` 中修改：

```typescript
// 原 SELECT:
// "SELECT dc.userId, d.userId AS diaryOwnerId, d.workspaceId FROM diary_comments dc ..."
// 改为:
"SELECT dc.userId, dc.trigger_user_id, d.userId AS diaryOwnerId, d.workspaceId FROM diary_comments dc ..."

// 原权限判断后增加 trigger_user_id:
const isTriggerUser = comment.trigger_user_id === userId;

if (!isCommentOwner && !isDiaryOwner && !isWorkspaceManager && !isTriggerUser) {
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/diary.ts
git commit -m "feat(api): extend delete permissions for trigger users of AI content"
```

---

### Task 4: 通知系统添加 ai_diary_reply 类型

**Files:**
- Modify: `backend/src/routes/notifications.ts` — 添加 ai_diary_reply 的显示配置

- [ ] **Step 1: 添加通知标签配置**

在 `NOTIFICATION_LABELS` 中添加：

```typescript
const NOTIFICATION_LABELS: Record<string, { label: string; icon: string }> = {
  mention: { label: "@了你", icon: "mention" },
  task_completed: { label: "完成了任务", icon: "task" },
  diary_posted: { label: "发布了新说说", icon: "diary" },
  note_updated: { label: "更新了笔记", icon: "note" },
  ai_diary_reply: { label: "AI 助手回复了你的说说", icon: "sparkles" },
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/notifications.ts
git commit -m "feat(notif): add ai_diary_reply notification type"
```

---

### Task 5: 前端 API 新增 diaryAiAsk 方法

**Files:**
- Modify: `frontend/src/lib/api.ts` — 新增 diaryAiAsk 方法

- [ ] **Step 1: 添加 diaryAiAsk 方法**

在 `diary` API 区域（`deleteDiaryComment` 之后）添加：

```typescript
  diaryAiAsk: (params: { mode: "post" | "comment"; diaryId?: string; question: string }) =>
    request<{ mode: "post"; diary: Diary } | { mode: "comment"; comment: DiaryComment }>(
      "/diary/ai-ask", { method: "POST", body: JSON.stringify(params) }
    ),
```

- [ ] **Step 2: 添加 AI_ASSISTANT_ID 常量**

在文件顶部或工具函数区域添加导出：

同时需要确保 `DiaryComment` 类型包含 `triggerUserId` 字段。在 `types/index.ts` 中修改 `DiaryComment` 接口：

```typescript
export interface DiaryComment {
  id: string;
  diaryId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  username: string;
  avatarUrl: string | null;
  trigger_user_id?: string;  // 新增
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat(api): add diaryAiAsk method and DiaryComment trigger_user_id type"
```

---

### Task 6: 前端 ComposeBox @su 调起 AI

**Files:**
- Modify: `frontend/src/components/DiaryCenter.tsx` — ComposeBox 组件修改

- [ ] **Step 1: 在 ComposeBox 中导入 detectSuMention 和 api**

已经在文件顶部导入了 `detectSuMention`（第 32 行）和 `api`（第 29 行），无需额外导入。但需要定义 AI 助手常量：

在 `MOODS` 常量定义附近添加：

```typescript
const AI_ASSISTANT_ID = "00000000-0000-0000-0000-000000000001";
```

- [ ] **Step 2: 在 ComposeBox 的 handlePost 中添加 @su 检测**

修改 `handlePost` 函数（约第 567 行）：

```typescript
const handlePost = async () => {
  if (!canSubmit) return;

  // === AI @su 检测 ===
  const su = detectSuMention(text.trim());
  if (su.hasSu) {
    setPosting(true);
    try {
      await api.diaryAiAsk({ mode: "post", question: su.cleanText });
      haptic.success();
      setText("");
      setMood("");
      setShowMoods(false);
      setPendingImages([]);
      setVisibility(getCurrentWorkspace() !== "personal" ? "PUBLIC" : "PRIVATE");
      setPendingVoice(null);
      setComposeTags([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onPost();
      return; // 不执行普通发布逻辑
    } catch (err: any) {
      console.error("AI ask failed:", err);
      toast.error(err?.message || "AI 助手请求失败");
    } finally {
      setPosting(false);
    }
    return;
  }
  // === 原有发布逻辑 ===
  setPosting(true);
  try {
    // ... 原有代码不变
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DiaryCenter.tsx
git commit -m "feat(ui): add @su AI invocation in ComposeBox for diary posts"
```

---

### Task 7: 前端评论区 @su 调起 AI + AI 用户渲染

**Files:**
- Modify: `frontend/src/components/DiaryCenter.tsx` — DiaryCard 中评论修改

- [ ] **Step 1: 在 DiaryCard 的 handleAddComment 中添加 @su 检测**

修改 `handleAddComment` 函数（约第 1527 行）：

```typescript
const handleAddComment = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!newCommentText.trim() || submittingComment) return;

  // === AI @su 检测 ===
  const su = detectSuMention(newCommentText.trim());
  if (su.hasSu) {
    setSubmittingComment(true);
    try {
      const result = await api.diaryAiAsk({ mode: "comment", diaryId: item.id, question: su.cleanText });
      if (result.mode === "comment") {
        setComments((prev) => [...prev, result.comment]);
        setNewCommentText("");
        onUpdate({ ...item, commentCount: (item.commentCount || 0) + 1 });
        toast.success("AI 助手已回复");
      }
    } catch (err: any) {
      console.error("AI comment failed:", err);
      toast.error(err?.message || "AI 助手请求失败");
    } finally {
      setSubmittingComment(false);
    }
    return;
  }
  // === 原有评论逻辑 ===
  setSubmittingComment(true);
  try {
    const newComment = await api.postDiaryComment(item.id, newCommentText.trim());
    // ... 原有代码不变
```

- [ ] **Step 2: AI 用户特殊渲染**

在 `DiaryCard` 的评论渲染中，修改头像和用户名部分（约第 1825-1845 行）：

```tsx
{comments.map((comment) => (
  <div key={comment.id} className="flex items-start gap-2 text-xs">
    {/* 头像 */}
    {comment.userId === AI_ASSISTANT_ID ? (
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xs mt-0.5">
        🤖
      </div>
    ) : comment.avatarUrl ? (
      <img
        src={comment.avatarUrl}
        alt={comment.username}
        className="w-6 h-6 rounded-full object-cover mt-0.5"
      />
    ) : (
      <div className="w-6 h-6 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center font-bold text-[10px] mt-0.5">
        {comment.username.slice(0, 1).toUpperCase()}
      </div>
    )}
    {/* 评论内容 */}
    <div className="flex-1 min-w-0 bg-app-subtle/50 px-2.5 py-1.5 rounded-lg">
      <div className="flex items-center justify-between">
        <span className={cn("font-semibold", comment.userId === AI_ASSISTANT_ID ? "text-violet-500" : "text-tx-primary")}>
          {comment.userId === AI_ASSISTANT_ID ? "AI 助手" : comment.username}
        </span>
        <span className="text-[10px] text-tx-tertiary">{timeAgo(comment.createdAt, t)}</span>
      </div>
      <p className="text-tx-secondary mt-1 whitespace-pre-wrap break-words">{comment.content}</p>
    </div>
    {/* 删除评论：原作者 + 说说主人 + 触发者 */}
    {(comment.userId === currentUser?.id || 
      item.userId === currentUser?.id || 
      (comment.trigger_user_id && comment.trigger_user_id === currentUser?.id)) && (
      <button
        onClick={() => handleDeleteComment(comment.id)}
        className="text-[10px] text-tx-tertiary hover:text-red-500 p-1 rounded hover:bg-app-hover self-start mt-1 transition-colors"
        title="删除评论"
      >
        <Trash2 size={10} />
      </button>
    )}
  </div>
))}
```

同理，在说说列表中对 AI 发布的说说也做特殊渲染。在 `DiaryCard` 的头部头像区域（约第 1700-1720 行）：

```tsx
{/* 头像 */}
{item.userId === AI_ASSISTANT_ID ? (
  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-lg shrink-0">
    🤖
  </div>
) : item.userId === "demo" ? (
  <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-sm font-bold shrink-0">
    {item.creatorName?.[0]?.toUpperCase() || "D"}
  </div>
) : (
  // 原有的头像渲染逻辑
  ...
)}
```

在用户名显示区域：

```tsx
<span className={cn(
  "font-semibold text-sm",
  item.userId === AI_ASSISTANT_ID && "text-violet-500"
)}>
  {item.userId === AI_ASSISTANT_ID ? "AI 助手" : (item.creatorName || "用户")}
</span>
```

在卡片下方添加触发者标注：

```tsx
{item.trigger_user_id && item.userId === AI_ASSISTANT_ID && (
  <div className="text-[10px] text-tx-tertiary mt-1">
    由用户调起 AI 助手生成
  </div>
)}
```

- [ ] **Step 3: 在 DiaryCard 的删除说说按钮中支持 trigger_user_id**

查找说说详情菜单中的删除操作，修改权限判断（约第 1760 行附近的操作菜单）：

```tsx
{/* 删除操作 - 在操作菜单中 */}
{(item.userId === currentUser?.id || 
  (item as any).trigger_user_id === currentUser?.id) && (
  <button onClick={handleDeleteDiary} className="...">删除</button>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DiaryCenter.tsx
git commit -m "feat(ui): add @su AI invocation in comment area and AI user rendering"
```

---

### Task 8: 前端 Notification 类型与通知渲染

**Files:**
- Modify: `frontend/src/components/DiaryCenter.tsx` — 处理 diary:ai-reply 实时推送

- [ ] **Step 1: 处理 WebSocket 推送的 AI 回复通知**

在 DiaryCenter 主组件中（`export default function DiaryCenter`），添加 WebSocket 消息监听（如果有现有的 `useEffect` 监听实时消息，在其中添加；否则新增）：

```typescript
// 在 DiaryCenter 主组件中，如果有 ws 监听，添加该处理
useEffect(() => {
  const handler = (e: CustomEvent) => {
    const data = e.detail;
    if (data?.type === "diary:ai-reply" && data.mode === "post") {
      // AI 发布了新说说，刷新时间线
      fetchTimeline();
    }
  };
  window.addEventListener("super:ws-message", handler as any);
  return () => window.removeEventListener("super:ws-message", handler as any);
}, []);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DiaryCenter.tsx
git commit -m "feat(ui): handle realtime AI reply push notification in diary center"
```
