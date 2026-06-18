# 说说模块 AI 助手 — 设计文档

## 概述

在说说（Diary/Moments）模块中集成 AI 助手功能，用户可通过 `@su` 在说说发布框和评论区调起 AI，AI 异步思考后以专属账号身份回复。

## 核心需求

1. **调用方式**：发布框和评论区均可通过 `@su` 调起 AI 助手
2. **AI 思考**：发布框 @su 使用 RAG 检索全局知识（笔记/项目/任务/说说）+ 当前上下文；评论区 @su 仅基于当前说说 + 已有评论
3. **回复形式**：AI 答案以新说说（发布框）或新评论（评论区）展示
4. **AI 身份**：专用的 `ai-assistant` 用户账号
5. **通知**：用户不在说说列表页时，通过现有通知系统提醒
6. **删除权限**：发起 @su 的用户可删除 AI 创建的评论/说说

---

## 1. 数据模型

### 1.1 AI 助手账号

在 `users` 表预置一条记录（通过 `initAITables()` 函数在启动时 upsert）：

| 字段 | 值 |
|------|-----|
| `id` | `ai-assistant`（固定 UUID） |
| `username` | `ai-assistant` |
| `displayName` | `AI 助手` |
| `password` | 随机 BCrypt 哈希，不可登录 |
| `avatarUrl` | `NULL`（前端根据 id 特殊渲染 AI 头像） |
| `isDisabled` | `0` |

### 1.2 diary_comments 表扩展

```sql
ALTER TABLE diary_comments ADD COLUMN trigger_user_id TEXT;
```

- `trigger_user_id IS NULL` → 普通用户评论
- `trigger_user_id = <userId>` → AI 评论，由该用户触发

`CREATE INDEX IF NOT EXISTS idx_diary_comments_trigger ON diary_comments(trigger_user_id);`

### 1.3 diaries 表扩展

```sql
ALTER TABLE diaries ADD COLUMN trigger_user_id TEXT;
```

- `trigger_user_id IS NULL` → 用户自己发布的说说
- `trigger_user_id = <userId>` → AI 发布的说说，由该用户触发

### 1.4 notifications 表新增类型

无需改表结构，新增通知类型 `ai_diary_reply` 即可：

| 字段 | 值 |
|------|-----|
| `type` | `ai_diary_reply` |
| `sourceType` | `diary` |
| `sourceId` | 评论所在的说说的 ID |
| `sourceTitle` | 说说内容前 50 字（截断） |
| `actorId` | `ai-assistant` 的 ID |
| `actorName` | `AI 助手` |

---

## 2. 后端 — 新增端点

### 2.1 `POST /api/diary/ai-ask`

**请求体**：

```json
{
  "mode": "post",
  "question": "帮我分析最近的进展"
}
```

或

```json
{
  "mode": "comment",
  "diaryId": "xxx",
  "question": "这个观点有哪些依据？"
}
```

**处理流程**：

```
diaryAiHandler(c) {
  1. 解析请求: mode, question, diaryId(comment时)
  2. 收集上下文:
     mode === "post":
       - 调 extractKeywords(question) 提取关键词
       - 用 FTS5/LIKE 检索用户笔记、任务、项目、说说
       - 拼成 context 字符串
     mode === "comment":
       - 读 diaryId 对应的说说内容
       - 读该说说下的已有评论（最多 20 条）
       - 拼成 context 字符串
  3. 构建 AI prompt:
     system: "你是一位专家助手，基于用户的知识库内容..."
     user: question
     context: (上一步收集的上下文)
  4. 调 LLM API (复用 /ai/chat 的底层逻辑，非流式)
  5. 根据 mode:
     mode === "post":
       - INSERT INTO diaries (id, userId, contentText, trigger_user_id, ...)
         VALUES (uuid, ai_assistant_id, answer, currentUserId, ...)
       - return { mode: "post", diary: { ... } }
     mode === "comment":
       - INSERT INTO diary_comments (id, diaryId, userId, content, trigger_user_id, ...)
         VALUES (uuid, diaryId, ai_assistant_id, answer, currentUserId, ...)
       - return { mode: "comment", comment: { ... } }
  6. 检查用户在线状态:
     - 通过 WebSocket broadcastToUser 推送新内容
     - 如果不在线 → INSERT INTO notifications (...)
  7. 返回结果
}
```

### 2.2 删除权限扩展

**`DELETE /api/diary/comments/:commentId`** 增加条件：

```js
// 原有可删条件：
//   评论 userId === 当前用户  (isCommentOwner)
//   说说的 userId === 当前用户 (isDiaryOwner)
//   工作区管理员
// 新增：
//   comment.trigger_user_id === 当前用户  (isTriggerUser)
```

**`DELETE /api/diary/:id`**（已有路由，修改逻辑）：

```js
// 原有可删条件：
//   diary.userId === 当前用户
//   工作区管理员
// 新增：
//   diary.trigger_user_id === 当前用户
```

---

## 3. 前端 — UI 变更

### 3.1 ComposeBox（发布框）

**检测 @su**：

```typescript
// ComposeBox handlePost 中
if (detectSuMention(text).hasSu) {
  await api.diaryAiAsk({ mode: "post", question: cleanText });
  // 不调用原有的 postDiary
  return;
}
```

**UI 状态**：
- 检测到 @su 后，发布按钮变为 "AI 思考中..." 禁用态
- 输入框顶部或时间线顶部插入一个 `DiaryAiThinking` 暂态卡片（Loader + 波纹动画）

### 3.2 DiaryCard（评论区）

**检测 @su**：

```typescript
// handleAddComment 中
if (detectSuMention(newCommentText).hasSu) {
  await api.diaryAiAsk({ mode: "comment", diaryId: item.id, question: cleanText });
  // 追加 AI 评论到评论列表
  return;
}
```

**删除按钮**：AI 评论的删除按钮逻辑增加 `triggerUserId === currentUser.id`

### 3.3 AI 用户渲染

评论区中，当 `comment.userId === aiAssistantId` 时：

```tsx
// 头像区域显示 🤖 图标 + 紫色渐变背景
// 用户名显示 "AI 助手"
// 评论内容前加 🤖 前缀
```

说说明细中，当 `diary.userId === aiAssistantId` 时：

```tsx
// 头像区域显示 🤖
// 用户名显示 "AI 助手"
// 卡片底部标注 "由 @xxx 调起 AI 助手生成"
```

### 3.4 新增 API 方法

```typescript
// api.ts
diaryAiAsk(params: { mode: "post" | "comment"; diaryId?: string; question: string }) {
  return request("/diary/ai-ask", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
```

---

## 4. 通知流程

```
AI 回答生成后：
  1. 后端通过 broadcastToUser(currentUserId, {
       type: "diary:ai-reply",
       mode: "post" | "comment",
       diaryId: ...,
       commentId: ...,  // comment 模式
       snippet: "回答的前 80 字"
     })
  2. 前端 WebSocket 收到后判断：
     - 如果在说说列表页 → 无需通知，新说说/评论已渲染
     - 如果不在 → 显示 toast "AI 助手已回复"
  3. 后端也创建 notifications 记录（兜底）
```

---

## 5. 触发用户（trigger_user_id）写入时机

| 端到端场景 | userId | triggerUserId | 谁可删 |
|-----------|--------|---------------|--------|
| 用户 A 发布框 @su → AI 生成说说 | ai-assistant | A | A |
| 用户 A 评论区 @su → AI 生成评论 | ai-assistant | A | A |
| 用户 A 手动发布说说 | A | NULL | A |
| 用户 A 手动发表评论 | A | NULL | A（评论所有者）或日志所有人 |

---

## 6. 安全性

- `ai-assistant` 账号密码不可知，无法直接登录
- `POST /api/diary/ai-ask` 受 JWT 保护，仅认证用户可调
- AI 调用成本防护：用户可自行在 AI 设置页限制模型/关闭功能

---

## 7. 未纳入范围（YAGNI）

- ~~流式输出展示（SSE）~~ — AI 回答整体生成后一次性展示，简化前端状态管理
- ~~多轮对话~~ — 每次 @su 独立，不保留历史
- ~~AI 自动回复开关~~ — 初期用户手动 @su 才触发
