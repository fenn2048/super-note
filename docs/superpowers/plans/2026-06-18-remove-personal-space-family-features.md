# 移除个人空间与家庭功能权限调整 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除个人空间概念，引入临时空间引导页，添加家庭TODO，实现笔记/笔记本/思维导图可见性权限模型。

**Architecture:**
- 后端：在 migrations v25 新增 `visibility` 列到 notes/notebooks/mindmaps 表；在 acl.ts 新增 `buildVisibilityFilter`；修改三个列表/单资源接口加入可见性过滤；修改 clip.ts/url-import.ts 将剪藏笔记本从个人空间迁移到工作区。
- 前端：改造 `FirstRunWizard.tsx` 为全屏引导页；`App.tsx` 增加工作区检测网关；`Sidebar.tsx` 新增家庭TODO条目；修改 `api.ts` 移除 `"personal"` 回退。
- 数据库迁移：v25 为三个表加 `visibility` 列 + 索引。

**Tech Stack:** Node.js/Hono/SQLite (backend), React/TypeScript/Vite (frontend)

## 全局约束

- 构建命令：`cd frontend && npx vite build` / `cd backend && npm run build`
- SQLite 通过 better-sqlite3 操作
- 迁移文件：`backend/src/db/migrations.ts`，新版本为 25
- 前端启动：`cd frontend && npm run dev`
- 后端启动：`cd backend && npm run dev`
- 数据库默认路径：`data/super-note.db`
- `getCurrentWorkspace()` 不再回退 `"personal"`，无工作区时返回 `""`

---

## 文件清单

### 后端 (创建/修改)
| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/db/migrations.ts` | 修改 | 新增 v25 迁移：加 visibility 列 + 索引 |
| `backend/src/middleware/acl.ts` | 修改 | 新增 `buildVisibilityFilter()` 函数 |
| `backend/src/routes/notes.ts` | 修改 | 列表/创建/更新接口加入可见性过滤和字段 |
| `backend/src/routes/notebooks.ts` | 修改 | 列表/更新接口加入可见性过滤和字段 |
| `backend/src/routes/mindmaps.ts` | 修改 | 列表/创建/更新/单读接口加入可见性过滤和字段 |
| `backend/src/routes/clip.ts` | 修改 | 剪藏笔记本在工作区下创建，默认 `PRIVATE` |
| `backend/src/routes/url-import.ts` | 修改 | 同上 |
| `backend/src/routes/tasks.ts` | 修改 | 无需变更（任务不走可见性模型） |

### 前端 (创建/修改)
| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/lib/api.ts` | 修改 | `getCurrentWorkspace()` 不再回退 `"personal"` |
| `frontend/src/App.tsx` | 修改 | 增加工作区检测网关；引入 FirstRunWizard |
| `frontend/src/components/FirstRunWizard.tsx` | 修改 | 改造为全屏永久引导页 |
| `frontend/src/components/Sidebar.tsx` | 修改 | 新增「家庭TODO」条目；修改 handlePersonalTodoClick 所在上下文 |
| `frontend/src/components/ProjectKanban.tsx` | 修改 | 家庭TODO任务创建时自动全员参与 |

---

### Task 1: 后端数据库迁移 — notes/notebooks/mindmaps 加 visibility 列

**Files:**
- Modify: `backend/src/db/migrations.ts` (在 version 24 后追加 v25)
- Test: 手动验证（启动后端，检查 SQLite 表结构）

**Interfaces:**
- Consumes: MIGRATIONS 数组追加新条目
- Produces: notes/notebooks/mindmaps 表有 `visibility TEXT DEFAULT 'PRIVATE'` 列 + 索引

**实现：**

- [ ] **Step 1: 添加 migration v25**

在 `backend/src/db/migrations.ts` 的 version 24 条目之后（最后一项），添加：

```typescript
  {
    version: 25,
    name: "add-visibility-to-notes-notebooks-mindmaps",
    up: (db) => {
      // notes 表
      const noteCols = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[];
      if (!noteCols.some((c) => c.name === "visibility")) {
        db.exec("ALTER TABLE notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE'");
        db.exec("CREATE INDEX IF NOT EXISTS idx_notes_visibility ON notes(workspaceId, visibility, userId)");
      }
      // notebooks 表
      const nbCols = db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[];
      if (!nbCols.some((c) => c.name === "visibility")) {
        db.exec("ALTER TABLE notebooks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE'");
        db.exec("CREATE INDEX IF NOT EXISTS idx_notebooks_visibility ON notebooks(workspaceId, visibility, userId)");
      }
      // mindmaps 表
      const mmCols = db.prepare("PRAGMA table_info(mindmaps)").all() as { name: string }[];
      if (!mmCols.some((c) => c.name === "visibility")) {
        db.exec("ALTER TABLE mindmaps ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE'");
        db.exec("CREATE INDEX IF NOT EXISTS idx_mindmaps_visibility ON mindmaps(workspaceId, visibility, userId)");
      }
    },
  },
```

确保逗号正确（在 version 24 的 `},` 后追加）。

- [ ] **Step 2: 启动后端验证迁移**

```bash
cd /Users/westone/Documents/GitHub/super-note/backend
rm -f data/super-note.db   # 仅测试用，清库重建
npm run dev &
# 等待启动后按 Ctrl+C 停止
```

检查迁移日志应包含 `applied v25 (add-visibility-to-notes-notebooks-mindmaps)`。

验证表结构：
```bash
sqlite3 data/super-note.db "PRAGMA table_info(notes);" | grep visibility
sqlite3 data/super-note.db "PRAGMA table_info(notebooks);" | grep visibility
sqlite3 data/super-note.db "PRAGMA table_info(mindmaps);" | grep visibility
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/migrations.ts
git commit -m "feat(db): add visibility column to notes/notebooks/mindmaps (v25)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 后端 — acl.ts 新增 buildVisibilityFilter

**Files:**
- Modify: `backend/src/middleware/acl.ts`

**Interfaces:**
- Produces: `buildVisibilityFilter(userId, tableAlias, workspaceId) => { clause, params }`

在 `acl.ts` 中，`buildVisibilityWhere` 函数附近（约第 183 行后）添加：

```typescript
/**
 * 为列表查询构建可见性过滤条件（PRIVATE / WORKSPACE 模型）。
 * 用户只能看到：
 *   1. visibility = 'WORKSPACE' 的记录（全部可见）
 *   2. visibility = 'PRIVATE' 且自己为创建者的记录
 * 适用于 notes / notebooks / mindmaps 表的工作区场景。
 * 个人空间（workspaceId IS NULL）不应用此过滤。
 */
export function buildVisibilityFilter(
  userId: string,
  tableAlias: string = "",
  workspaceId: string | null,
): { clause: string; params: any[] } {
  const p = tableAlias ? `${tableAlias}.` : "";
  // 个人空间不应用可见性过滤
  if (!workspaceId) {
    return { clause: "", params: [] };
  }
  return {
    clause: `AND (${p}visibility = 'WORKSPACE' OR (${p}visibility = 'PRIVATE' AND ${p}userId = ?))`,
    params: [userId],
  };
}
```

**验证**：
- [ ] 确保导出了该函数
- [ ] 确认 `workspaceId` 为 null 时返回空 clause

**提交**：
```bash
git add backend/src/middleware/acl.ts
git commit -m "feat(acl): add buildVisibilityFilter for PRIVATE/WORKSPACE visibility model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 后端 — 笔记列表/创建/更新接口加入可见性

**Files:**
- Modify: `backend/src/routes/notes.ts`

**修改内容：**

**3a. 列表 GET /** — 在 workspace scope 过滤后追加可见性过滤

在约第 86 行（scope 过滤块结束）后，添加 `buildVisibilityFilter`：

```typescript
  // 可见性过滤：工作区下只显示 WORKSPACE 或自己的 PRIVATE 笔记
  const { clause: visClause, params: visParams } = buildVisibilityFilter(userId, "notes", workspaceId && workspaceId !== "personal" ? workspaceId : null);
  query += ` ${visClause}`;
  params.push(...visParams);
```

注意：要在 `workspaceId` 变量解析完成后追加。确认位置：
```typescript
  // Scope 过滤
  if (workspaceId && workspaceId !== "personal") {
    // 指定工作区
    ...
    query += " AND notes.workspaceId = ?";
    params.push(workspaceId);
  } else {
    // 个人空间
    ...
    query += " AND notes.userId = ? AND notes.workspaceId IS NULL";
    params.push(userId);
  }
  // → 在这里插入可见性过滤 ←
```

并且需要 import `buildVisibilityFilter`：
```typescript
import {
  resolveNotePermission,
  resolveNotebookPermission,
  hasPermission,
  getUserWorkspaceRole,
  hasRole,
  buildVisibilityFilter,  // 新增
} from "../middleware/acl";
```

**3b. 创建 POST /** — 插入时设置 `visibility` 字段

在约第 358-361 行的 INSERT 语句中增加 `visibility` 字段。当前：
```typescript
db.prepare(`
  INSERT INTO notes (id, userId, workspaceId, notebookId, title, content, contentText)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  id, userId, inheritedWorkspaceId, body.notebookId,
  body.title || "无标题笔记", body.content || "{}", body.contentText || "",
);
```

改为：
```typescript
db.prepare(`
  INSERT INTO notes (id, userId, workspaceId, notebookId, title, content, contentText, visibility)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  id, userId, inheritedWorkspaceId, body.notebookId,
  body.title || "无标题笔记", body.content || "{}", body.contentText || "",
  body.visibility || "PRIVATE",
);
```

**3c. 更新 PUT /:id** — 允许修改 `visibility` 字段

在约第 435 行的 `writeFields` 数组中追加 `"visibility"`：
```typescript
const writeFields = ["title", "content", "contentText", "notebookId", "isPinned", "isFavorite",
                     "isArchived", "isTrashed", "sortOrder", "visibility"];
```

同时在第 589 行的 fields/params 收集逻辑中，`visibility` 已经包含在 `writeFields` 中，UPDATE 语句会自动拼接。不需要额外改动。

**验证**：
- 启动后端，用 curl 或前端测试创建笔记 → 检查返回数据含 `visibility: "PRIVATE"`
- 列表查询工作区笔记应只返回 WORKSPACE 或自己的 PRIVATE 笔记

**提交**：
```bash
git add backend/src/routes/notes.ts
git commit -m "feat(notes): add visibility field to list/create/update endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 后端 — 笔记本列表/更新接口加入可见性

**Files:**
- Modify: `backend/src/routes/notebooks.ts`

**修改内容：**

**4a. 导入 buildVisibilityFilter**

```typescript
import {
  getUserWorkspaceRole,
  hasRole,
  resolveNotebookPermission,
  hasPermission,
  buildVisibilityWhere,
  buildVisibilityFilter,  // 新增
} from "../middleware/acl";
```

**4b. 列表 GET /** — 在指定工作区分支追加可见性过滤

在约第 64-93 行的 `workspaceId` 分支中，SQL 查询追加 `AND visibility` 条件。有两种方式：

方式一（推荐）：在 SQL 字符串末尾追加 WHERE 条件。找到工作区分支的 SQL，在 `WHERE nb.workspaceId = ? AND nb.isDeleted = 0` 之后添加：

```typescript
// 在 workspace 分支（约第 89 行）的 ORDER BY 之前追加：
const { clause: visClause, params: visParams } = buildVisibilityFilter(userId, "nb", workspaceId);
// 将 visClause 和 visParams 应用到 SQL（当前 SQL 中 = workspaceId 参数后追加）
// 需要在三个 CTE 内部和外部 WHERE 都应用：

// 修改 CTE 内 WHERE:
// 原: WHERE n.workspaceId = ? AND n.isDeleted = 0
// 改为: WHERE n.workspaceId = ? AND n.isDeleted = 0 AND (n.visibility = 'WORKSPACE' OR (n.visibility = 'PRIVATE' AND n.userId = ?))

// 修改外部 WHERE:
// 原: WHERE nb.workspaceId = ? AND nb.isDeleted = 0
// 改为: WHERE nb.workspaceId = ? AND nb.isDeleted = 0 AND (nb.visibility = 'WORKSPACE' OR (nb.visibility = 'PRIVATE' AND nb.userId = ?))
```

具体实现 —— 将工作区分支的 SQL 修改如下：

当前（第 64-93 行）：
```typescript
} else if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks WHERE workspaceId = ? AND isDeleted = 0
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.workspaceId = ? AND n.isDeleted = 0
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.isTrashed = 0 AND notes.workspaceId = ?
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.workspaceId = ? AND nb.isDeleted = 0
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(workspaceId, workspaceId, workspaceId, workspaceId);
  }
```

改为：
```typescript
} else if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks WHERE workspaceId = ? AND isDeleted = 0 AND (visibility = 'WORKSPACE' OR (visibility = 'PRIVATE' AND userId = ?))
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.workspaceId = ? AND n.isDeleted = 0 AND (n.visibility = 'WORKSPACE' OR (n.visibility = 'PRIVATE' AND n.userId = ?))
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.isTrashed = 0 AND notes.workspaceId = ?
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.workspaceId = ? AND nb.isDeleted = 0 AND (nb.visibility = 'WORKSPACE' OR (nb.visibility = 'PRIVATE' AND nb.userId = ?))
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(workspaceId, userId, workspaceId, userId, workspaceId, workspaceId, userId);
  }
```

注意参数顺序的变化：`workspaceId, userId, workspaceId, userId, workspaceId, workspaceId, userId`

**4c. 更新 PUT /:id** — 允许修改 `visibility` 字段

在约第 295-301 行的 UPDATE 语句中追加 `visibility` 字段：

```typescript
db.prepare(
  `
  UPDATE notebooks SET name = COALESCE(?, name), icon = COALESCE(?, icon),
  color = COALESCE(?, color), parentId = COALESCE(?, parentId),
  sortOrder = COALESCE(?, sortOrder), isExpanded = COALESCE(?, isExpanded),
  visibility = COALESCE(?, visibility), updatedAt = datetime('now')
  WHERE id = ?
`,
).run(
  body.name,
  body.icon,
  body.color,
  body.parentId,
  body.sortOrder,
  body.isExpanded,
  body.visibility,  // 新增
  id,
);
```

**验证**：
- 启动后端，测试工作区笔记本列表应只返回可见的笔记本
- 通过 PUT 修改笔记本 visibility 应生效

**提交**：
```bash
git add backend/src/routes/notebooks.ts
git commit -m "feat(notebooks): add visibility field to list/update endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 后端 — 思维导图加入可见性

**Files:**
- Modify: `backend/src/routes/mindmaps.ts`

**导入 buildVisibilityFilter**：
```typescript
import {
  canManageResource,
  getUserWorkspaceRole,
  requireWorkspaceFeature,
  buildVisibilityFilter,
} from "../middleware/acl";
```

**5a. 创建 POST /** — 写入时带 visibility

在约第 144-152 行的 INSERT 语句改为：
```typescript
db.prepare(
  "INSERT INTO mindmaps (id, userId, workspaceId, title, data, visibility) VALUES (?, ?, ?, ?, ?, ?)",
).run(
  id,
  userId,
  scope.workspaceId,
  title,
  typeof data === "string" ? data : JSON.stringify(data),
  body.visibility || "PRIVATE",
);
```

**5b. 列表 GET /** — 工作区查询追加可见性过滤

当前工作区查询（约第 92-97 行）：
```typescript
const sql =
  scope.scope === "workspace"
    ? `SELECT m.id, m.userId, m.workspaceId, m.title, m.createdAt, m.updatedAt,
              u.username AS creatorName
       FROM mindmaps m LEFT JOIN users u ON u.id = m.userId
       WHERE m.workspaceId = ? ORDER BY m.updatedAt DESC`
    : ...
```

改为：
```typescript
const sql =
  scope.scope === "workspace"
    ? `SELECT m.id, m.userId, m.workspaceId, m.title, m.createdAt, m.updatedAt,
              u.username AS creatorName
       FROM mindmaps m LEFT JOIN users u ON u.id = m.userId
       WHERE m.workspaceId = ? AND (m.visibility = 'WORKSPACE' OR (m.visibility = 'PRIVATE' AND m.userId = ?)) ORDER BY m.updatedAt DESC`
    : ...
const param = scope.scope === "workspace" ? [scope.workspaceId, userId] : userId;
```

`param` 变量需要改为数组形式：
```typescript
const params = scope.scope === "workspace"
  ? [scope.workspaceId, userId]
  : [userId];
const rows = db.prepare(sql).all(...params);
```

**5c. 单读 GET /:id** — 追加可见性校验

在约第 109-121 行，`canReadMindmap` 函数：
```typescript
function canReadMindmap(row: MindmapRow, userId: string): boolean {
  if (!row.workspaceId) return row.userId === userId;
  // 工作区：WORKSPACE 或自己的 PRIVATE
  return getUserWorkspaceRole(row.workspaceId, userId) !== null &&
    (row.visibility === "WORKSPACE" || row.userId === userId);
}
```

**5d. 更新 PUT /:id** — 允许修改 visibility

在约第 174-184 行的 updates 收集块中追加：
```typescript
if (body.visibility !== undefined) {
  // 只有 PRIVATE 或 WORKSPACE 是合法值
  if (body.visibility !== "PRIVATE" && body.visibility !== "WORKSPACE") {
    return c.json({ error: "可见性仅支持 PRIVATE 或 WORKSPACE" }, 400);
  }
  updates.push("visibility = ?");
  values.push(body.visibility);
}
```

并且加上限制：仅创建者可修改 visibility（在当前权限校验约第 170 行之后追加）：
```typescript
// visibility 仅创建者可修改
if (body.visibility !== undefined && existing.userId !== userId) {
  return c.json({ error: "仅创建者可修改可见性" }, 403);
}
```

**验证**：
- 创建思维导图应默认 `PRIVATE`
- 工作区列表只显示 WORKSPACE 或自己的 PRIVATE
- 修改 visibility 应生效

**提交**：
```bash
git add backend/src/routes/mindmaps.ts
git commit -m "feat(mindmaps): add visibility field to create/list/read/update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 后端 — 剪藏笔记本迁移到工作区

**Files:**
- Modify: `backend/src/routes/clip.ts`
- Modify: `backend/src/routes/url-import.ts`

**6a. clip.ts — 修改默认笔记本创建逻辑**

当前（约第 271-296 行），当 `workspaceId` 存在时查工作区下的"剪藏笔记本"：

查找逻辑保持不变（已有工作区分支），但需要在 INSERT 时加 `visibility` 列。

找到创建笔记本的 INSERT（约第 292-295 行）：
```typescript
db.prepare(
  `INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, sortOrder)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(targetNotebookId, userId, workspaceId, null, "剪藏笔记本", "📓", 0);
```

改为：
```typescript
db.prepare(
  `INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, sortOrder, visibility)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(targetNotebookId, userId, workspaceId, null, "剪藏笔记本", "📓", 0, "PRIVATE");
```

笔记的 INSERT（约第 316-329 行）—— 确保笔记也带 `visibility`：
当前：
```typescript
db.prepare(
  `INSERT INTO notes (id, userId, workspaceId, notebookId, title, content, contentText)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(...)
```

改为：
```typescript
db.prepare(
  `INSERT INTO notes (id, userId, workspaceId, notebookId, title, content, contentText, visibility)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  noteId,
  userId,
  workspaceId,
  targetNotebookId,
  title || "无标题笔记",
  finalContent,
  finalContentText,
  "PRIVATE",
);
```

**6b. url-import.ts — 同理修改**

当前（约第 344-356 行），不需要 workspaceId 时创建个人空间的"剪藏笔记本"。改为不再处理个人空间情形——如果没有提供 `notebookId` 且没有 `workspaceId`，返回错误。

修改查找逻辑(约第 345-355 行)：
```typescript
// 确定目标笔记本：未指定 → "剪藏笔记本"
let targetNotebookId = notebookId;
if (!targetNotebookId) {
  if (!workspaceId) {
    return c.json({ error: "URL导入需要工作区上下文" }, 400);
  }
  const exist = db
    .prepare("SELECT id FROM notebooks WHERE workspaceId = ? AND name = ? AND isDeleted = 0")
    .get(workspaceId, "剪藏笔记本") as { id: string } | undefined;
  if (exist) {
    targetNotebookId = exist.id;
  } else {
    targetNotebookId = uuid();
    db.prepare("INSERT INTO notebooks (id, userId, workspaceId, name, icon, visibility) VALUES (?, ?, ?, ?, ?, ?)")
      .run(targetNotebookId, userId, workspaceId, "剪藏笔记本", "📓", "PRIVATE");
  }
}
```

笔记 INSERT（约第 363-367 行）增加 `visibility`：
```typescript
db.prepare(
  `INSERT INTO notes (id, userId, notebookId, title, content, contentText, createdAt, updatedAt, workspaceId, visibility)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(noteId, userId, targetNotebookId, title, "", "", now, now, workspaceId, "PRIVATE");
```

**验证**：
- 启动后端，使用 clipper 或 URL 导入 → 创建的剪藏笔记本在工作区下且 visibility=PRIVATE
- 传入空 workspaceId 时应返回 400

**提交**：
```bash
git add backend/src/routes/clip.ts backend/src/routes/url-import.ts
git commit -m "feat(clip): move clipping notebook from personal space to workspace scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 前端 — api.ts 移除 personal 回退 + 工作区检测

**Files:**
- Modify: `frontend/src/lib/api.ts`

**7a. 修改 getCurrentWorkspace()**（约第 28-31 行）

```typescript
export function getCurrentWorkspace(): string {
  return localStorage.getItem(WORKSPACE_KEY) || "";
}
```

**7b. API 层适配**

所有 `!== "personal"` 的检查改为 `!== ""`：

查找并修改（约第 885 行、第 901 行等）：
```typescript
// 原: if (payload.workspaceId === undefined && currentWs && currentWs !== "personal") {
// 改为:
if (payload.workspaceId === undefined && currentWs && currentWs !== "") {
```

以及（约第 909-911 行）：
```typescript
// 原: const wsMatch = ("workspaceId" in finalParams)
//       ? (n.workspaceId === finalParams.workspaceId
//         || (finalParams.workspaceId === "personal" && !n.workspaceId))
// 改为:
const wsMatch = ("workspaceId" in finalParams)
  ? (n.workspaceId === finalParams.workspaceId
    || (!finalParams.workspaceId && !n.workspaceId))  // 空字符串匹配个人空间
```

以及 `getNotebooks`（约第 876-877 行）保持不变（已经用 `getCurrentWorkspace()` 获得的新值）。

以及 `createNotebook`、`createNote` 等函数中的 workspaceId 注入逻辑（查找 `!== "personal"` 模式统一替换）。

```bash
# 查找所有 "personal" 相关的 workspaceId 判断
grep -n '"personal"' frontend/src/lib/api.ts
```

所有形如 `if (currentWs && currentWs !== "personal")` 改为 `if (currentWs && currentWs !== "")`。
所有形如 `finalParams.workspaceId === "personal"` 改为 `!finalParams.workspaceId`。

**验证**：
- 确保构建通过: `cd frontend && npx vite build`
- 确保无工作区时 `getCurrentWorkspace()` 返回 `""`

**提交**：
```bash
git add frontend/src/lib/api.ts
git commit -m "fix(api): remove 'personal' fallback from getCurrentWorkspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 前端 — 改造 FirstRunWizard 为全屏引导页

**Files:**
- Modify: `frontend/src/components/FirstRunWizard.tsx`

**修改内容：**

移除多步向导，改为全屏单页引导：

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Loader2, LogIn, X, Check,
} from "lucide-react";
import { api, setCurrentWorkspace } from "@/lib/api";
import { useAppActions } from "@/store/AppContext";
import { toast } from "@/lib/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FirstRunWizardProps {
  onComplete: () => void;
}

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const actions = useAppActions();
  const [creating, setCreating] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const handleCreateFamily = useCallback(async () => {
    setCreating(true);
    try {
      const ws = await api.createWorkspace({
        name: "我的家庭",
        description: "一家人共享的笔记、说说和待办空间",
        icon: "🏠",
      });
      setCurrentWorkspace(ws.id);
      window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: ws.id } }));
      toast.success("家庭空间创建成功！");
      onComplete();
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  }, [onComplete]);

  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    try {
      const result = await api.joinWorkspace(joinCode.trim());
      setCurrentWorkspace(result.workspaceId);
      window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: result.workspaceId } }));
      toast.success("已加入空间！");
      onComplete();
    } catch (e: any) {
      toast.error(e?.message || "加入失败");
    } finally {
      setJoining(false);
    }
  }, [joinCode, onComplete]);

  return (
    <div className="fixed inset-0 z-[200] bg-app-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-app-elevated rounded-3xl shadow-2xl border border-app-border w-full max-w-[420px] overflow-hidden p-8 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4">
          <Sparkles size={28} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-tx-primary mb-2">欢迎来到 SuperNote</h1>
        <p className="text-sm text-tx-secondary mb-6 leading-relaxed">
          创建或加入一个家庭空间，与家人一起使用笔记、说说、待办、思维导图等功能。
        </p>

        <div className="space-y-3">
          <button
            onClick={handleCreateFamily}
            disabled={creating}
            className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {creating ? "创建中..." : "创建家庭空间"}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-app-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-app-elevated px-2 text-tx-tertiary">或</span>
            </div>
          </div>

          {!showJoin ? (
            <button
              onClick={() => setShowJoin(true)}
              className="w-full py-3 rounded-xl text-sm font-medium border border-app-border text-tx-primary hover:bg-app-hover transition-all flex items-center justify-center gap-2"
            >
              <LogIn size={16} />
              加入已有空间
            </button>
          ) : (
            <div className="space-y-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="输入邀请码"
                className="text-center text-lg tracking-widest"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowJoin(false)}
                  className="flex-1"
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleJoin}
                  disabled={joining || !joinCode.trim()}
                  className="flex-1"
                >
                  {joining ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  加入
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
```

**验证**：
- `cd frontend && npx vite build` 应通过
- 启动前端，无工作区时应显示引导页

**提交**：
```bash
git add frontend/src/components/FirstRunWizard.tsx
git commit -m "feat(first-run): redesign as full-screen onboarding page

Now shows 'create family space' and 'join space' as only two actions
when user has no workspace membership.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 前端 — App.tsx 增加工作区检测网关

**Files:**
- Modify: `frontend/src/App.tsx`

**修改内容：**

**9a. 添加状态和检测逻辑**

在 `AppLayout` 组件（约第 306 行）之前或 `function App()`（约第 1983 行）之前，添加工作区检测的 HOC 或直接在 `App` 组件中添加检测。

推荐在 `AppLayout` 组件内检测（因为 `AppLayout` 已经包裹在 `AppProvider` 中）：

在 `AppLayout` 函数开头（约第 307 行后），添加：

```typescript
const [hasFamilySpace, setHasFamilySpace] = useState<boolean | null>(null);

useEffect(() => {
  let cancelled = false;
  api.getWorkspaces().then(list => {
    if (cancelled) return;
    const has = list.length > 0;
    setHasFamilySpace(has);
    if (!has) {
      // 无工作区：清除当前 workspace 缓存
      localStorage.removeItem("super-current-workspace");
    }
  }).catch(() => {
    if (cancelled) return;
    setHasFamilySpace(true); // 出错时回退到正常渲染
  });
  return () => { cancelled = true; };
}, []);
```

在 useEffect 初始化完成后（约第 330 行），在返回 JSX 前添加：

```typescript
// 工作区检测
if (hasFamilySpace === false) {
  return <FirstRunWizard onComplete={() => setHasFamilySpace(true)} />;
}
if (hasFamilySpace === null) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <Loader2 size={32} className="animate-spin text-tx-tertiary" />
    </div>
  );
}
```

需要导入 `Loader2`（已在 App.tsx 第 3 行的 import 中）和 `FirstRunWizard`。

确认 `FirstRunWizard` 在 App.tsx 顶部已有 `import FirstRunWizard from "@/components/FirstRunWizard";` 或新增。

确保 import 的 `useState`、`useEffect` 已经存在（已有，第 1 行）。

**9b. 确保引导页不显示 Sidebar**

在渲染 `FirstRunWizard` 时直接 return，不会走到下面的 `<AppProvider>` 和 `<AppLayout />`。注意：需要确保 `FirstRunWizard` 中也能调用 API（已在 Task 8 中正确处理）。

但实际上更好的位置是在 `function App()` 中（约第 1983 行），在 `isLoggedIn` 判定之后、渲染 `<AppProvider>` 之前：

不对，`App()` 组件没有 `api.getWorkspaces` 所需的认证状态。更好的方案是在 `App()` 的已登录分支中加一个包装组件。

最简单的方式：在 `App` 组件中，渲染 `AppLayout` 时用条件检查：

找到 render return（约第 1952-1980 行）：
```tsx
// 已登录
return (
  <AppProvider>
    <TooltipProvider>
      <AppLayout />
      ...
    </TooltipProvider>
  </AppProvider>
);
```

改为用一个包装组件 `WorkspaceGate`：

（方式二，更干净：直接在 `AppLayout` 内部检测并拦截渲染，如上面的方案）

确认：把检测逻辑放在 `AppLayout` 内部是最简单的，因为 `AppLayout` 已经是 `useApp()` 的消费者，可以自由访问 uiStore 和 API。

**验证**：
- 启动前端，清除 localStorage 中的 workspace 缓存 → 应看到引导页
- 创建家庭空间后 → 引导页消失，正常应用渲染

**提交**：
```bash
git add frontend/src/App.tsx
git commit -m "feat(app): add workspace detection gate showing onboarding for new users

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: 前端 — Sidebar 新增「家庭TODO」条目

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

**修改内容：**

**10a. 添加 handleFamilyTodoClick 函数**

在 `handlePersonalTodoClick`（约第 875 行）之后添加：

```typescript
const handleFamilyTodoClick = async () => {
  let todoProj = projects.find(p => p.name === "家庭TODO");
  if (!todoProj) {
    try {
      todoProj = await api.createProject({
        name: "家庭TODO",
        visibility: "WORKSPACE"
      });
      await fetchGroupsAndProjects();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err) {
      console.error("Failed to create 家庭TODO project:", err);
      toast.error("创建家庭TODO项目失败");
      return;
    }
  }
  selectFilter({ type: "detail", projectId: todoProj.id });
};
```

**10b. 在侧边栏 Project 区域添加「家庭TODO」UI**

在约第 998-1011 行的 `个人TODO` 条目之前（在 "我的任务" 之后），插入：

```tsx
<div
  className={cn(
    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer",
    activeFilter.type === "detail" && projects.find(p => p.id === activeFilter.projectId)?.name === "家庭TODO"
      ? "bg-app-active text-tx-primary font-medium"
      : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
  )}
  onClick={handleFamilyTodoClick}
>
  <CheckSquare size={16} />
  <span>{t("projects.familyTodo") || "家庭TODO"}</span>
</div>
```

放在第 1011 行（个人TODO的 `</div>`) 之前，以确保顺序为：我的任务 → 家庭TODO → 个人TODO → 日历。

**10c. 添加 i18n 翻译键**

在 `frontend/src/i18n/locales/` 中的中文和英文翻译文件里添加：
- `projects.familyTodo`: `"家庭TODO"` / `"Family TODO"`

或者使用已有 `t()` 函数的回退机制（上述代码已为 `"家庭TODO"` 兜底）。

**验证**：
- 启动前端，在工作区中点击「家庭TODO」→ 应创建"家庭TODO"项目并跳转
- 非工作区状态下不应显示（被 features 机制过滤？不对，家庭TODO属于Projects区域，由props控制显示）

注意：家庭TODO是 Projects 区域的条目，而 Projects 区域本身受 `features.projects` 控制。所以在有工作区且 projects 功能开启时才会显示。

**提交**：
```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat(sidebar): add 'Family TODO' project entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: 前端 — ProjectKanban 家庭TODO任务默认全员参与

**Files:**
- Modify: `frontend/src/components/ProjectKanban.tsx`

**修改内容：**

在任务创建逻辑中，检测当前项目是否为"家庭TODO"，如果是则自动获取工作区成员并设为参与人。

找到任务创建的 handler（在 `ProjectKanban.tsx` 中搜索 `createTask` 或 `handleCreateTask` 等类似名称），修改创建参数：

```typescript
const handleCreateTask = async (stageId: string, title: string) => {
  try {
    // 检测是否为家庭TODO项目
    const isFamilyTodo = currentProject?.name === "家庭TODO";
    let assigneeIds: string[] | undefined;
    
    if (isFamilyTodo) {
      // 获取工作区所有成员
      const members = await api.getWorkspaceMembers(workspaceId);
      assigneeIds = members.map(m => m.userId);
    }
    
    const task = await api.createProjectTask({
      projectId: currentProject.id,
      stageId,
      title,
      assigneeIds, // 默认全员参与（仅家庭TODO）
    });
    // ... 后续刷新列表
  } catch (err) {
    // ... 错误处理
  }
};
```

具体位置需要先读取 `ProjectKanban.tsx` 找到创建任务的函数。

**验证**：
- 在家庭TODO项目中创建任务 → 检查所有成员是否被添加为参与人
- 在其他项目中创建任务 → 不应自动添加参与人

**提交**：
```bash
git add frontend/src/components/ProjectKanban.tsx
git commit -m "feat(kanban): auto-assign all workspace members for Family TODO tasks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: 前端 — 笔记/笔记本/思维导图可见性 UI 切换

**Files:**
- Need to determine exact files based on current editor components

此任务涉及在前端添加可见性切换开关。需要创建或修改以下组件：

**12a. 笔记可见性切换** — 在笔记编辑器中添加

查找笔记编辑器组件（可能是 `TiptapEditor.tsx` 或 `MarkdownEditor.tsx`），在工具栏或属性面板中添加：

```tsx
// 可见性切换组件
function VisibilityToggle({
  value,
  onChange,
  disabled,
}: {
  value: "PRIVATE" | "WORKSPACE";
  onChange: (v: "PRIVATE" | "WORKSPACE") => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-app-hover/50">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
          value === "PRIVATE"
            ? "bg-app-active text-tx-primary font-medium"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("PRIVATE")}
      >
        🔒 仅自己可见
      </button>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
          value === "WORKSPACE"
            ? "bg-app-active text-tx-primary font-medium"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("WORKSPACE")}
      >
        🌐 所有人可见
      </button>
    </div>
  );
}
```

**12b. 笔记本可见性切换** — 在笔记本属性/编辑对话框中添加

**12c. 思维导图可见性切换** — 在思维导图属性中添加

> 注意：此任务需要先阅读具体组件的代码来确定集成位置。由于可见性切换的 UI 模式一致，可以提取为可复用组件。

**验证**：
- 启动前端，在笔记编辑器中切换可见性 → 调用 PUT 接口
- 刷新后状态保持

**提交**：
```bash
git add <affected-files>
git commit -m "feat(ui): add visibility toggle for notes, notebooks, and mindmaps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 检验清单

- [ ] 新用户无工作区 → 显示引导页，无法使用任何功能模块
- [ ] 创建家庭空间 → 引导页关闭，应用正常渲染
- [ ] 加入已有空间 → 同上
- [ ] 工作区侧边栏有"家庭TODO"条目（位于我的任务和个人TODO之间）
- [ ] 点击家庭TODO → 创建/打开项目
- [ ] 家庭TODO中创建任务 → 自动全部成员参与
- [ ] 个人TODO保留，创建的任务归属个人
- [ ] 手动创建笔记 → 默认 `visibility = PRIVATE`（仅自己可见）
- [ ] 工作区笔记本列表只显示自己有权限的笔记本
- [ ] 思维导图默认 PRIVATE，可切换为 WORKSPACE
- [ ] 剪藏笔记本在工作区下创建
- [ ] 存量个人空间数据不受影响（但有工作区的用户不再看到个人空间数据）
