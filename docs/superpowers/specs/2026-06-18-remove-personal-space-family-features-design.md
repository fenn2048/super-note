# 移除个人空间与家庭功能权限调整设计

## 概述

移除原有"个人空间"概念，新用户首次进入时展示临时空间引导页。用户必须创建或加入家庭空间后才能使用各功能模块。在家庭空间中对笔记、笔记本、思维导图引入可见性权限模型。

## 涉及组件

| 区域 | 文件 |
|------|------|
| 前端引导页 | `frontend/src/components/FirstRunWizard.tsx` |
| 前端应用入口 | `frontend/src/App.tsx` |
| 前端侧边栏 | `frontend/src/components/Sidebar.tsx` |
| 前端 API 层 | `frontend/src/lib/api.ts` |
| 前端项目看板 | `frontend/src/components/ProjectKanban.tsx` |
| 后端 ACL | `backend/src/middleware/acl.ts` |
| 后端笔记路由 | `backend/src/routes/notes.ts` |
| 后端笔记本路由 | `backend/src/routes/notebooks.ts` |
| 后端思维导图路由 | `backend/src/routes/mindmaps.ts` |
| 后端剪藏路由 | `backend/src/routes/clip.ts` |
| 后端 URL 导入路由 | `backend/src/routes/url-import.ts` |
| 后端任务路由 | `backend/src/routes/tasks.ts` |
| 后端数据库迁移 | `backend/src/db/migrations.ts` |
| 后端数据库 Schema | `backend/src/db/schema.ts` |

## 1. 临时空间引导页

### 触发条件

用户登录后，后端 `GET /api/workspaces` 返回空列表 → 前端判定为"无家庭空间用户" → 展示全屏引导页。

### 页面内容

改造 `FirstRunWizard.tsx`：
- 移除步骤式多步向导，改为单一全屏页面
- 两个核心操作：
  - **「创建家庭空间」**：调用 `POST /api/workspaces` 创建名为"我的家庭"的工作区，创建后自动切换到该工作区
  - **「加入已有空间」**：展开邀请码输入框，调用 `POST /api/workspaces/join` 加入
- 不显示任何功能入口（无 Sidebar / NavRail / 笔记列表等）

### 退出逻辑

用户成功创建或加入工作区后：
1. `setCurrentWorkspace(ws.id)` 写入 localStorage
2. 触发 `super:workspace-changed` 事件
3. 引导页关闭，渲染正常应用界面

### 与当前 FirstRunWizard 的关系

当前 `FirstRunWizard` 会检测 `!hasWorkspace && !hasNotes` 后弹出。改造后变为账户级别判定条件：
- 新建 `useEffect` 在 App 挂载时检测 `GET /api/workspaces` 返回长度
- 空 → 始终显示引导页（不再是"仅首次运行"，而是"无空间不可用"）
- 非空 → 正常渲染

## 2. 项目管理模块

### 侧边栏变更 (`Sidebar.tsx`)

在 Project 区域（`activeFilter.type` 相关）增加一个**「家庭TODO」**入口：

| 新增/保留 | 条目 | 行为 |
|-----------|------|------|
| 保留 | 我的任务 | `activeFilter.type = "my-tasks"` |
| **新增** | **家庭TODO** | 查找/创建名为"家庭TODO"的 Project，切换为 detail 视图 |
| 保留 | 个人TODO | 原逻辑保留，创建的任务归属个人 |
| 保留 | 日历 | `activeFilter.type = "calendar"` |

### 家庭TODO 创建逻辑

```typescript
// 类似 handlePersonalTodoClick，但查找/创建名为"家庭TODO"的项目
const handleFamilyTodoClick = async () => {
  let todoProj = projects.find(p => p.name === "家庭TODO");
  if (!todoProj) {
    todoProj = await api.createProject({
      name: "家庭TODO",
      visibility: "WORKSPACE"  // 工作区可见
    });
    await fetchGroupsAndProjects();
  }
  selectFilter({ type: "detail", projectId: todoProj.id });
};
```

### 任务参与人

创建"家庭TODO"下的任务时，前端自动携带 `assigneeIds` 包含工作区所有当前成员：
```typescript
// 前端创建任务时
const members = await api.getWorkspaceMembers(workspaceId);
const task = await api.createTask({
  ...data,
  projectId: familyTodoProject.id,
  assigneeIds: members.map(m => m.userId), // 默认全员参与
  workspaceId: getCurrentWorkspace(),
});
```

## 3. 可见性权限模型

### 数据库变更

在 `migrations.ts` 中新增迁移版本，为三个表添加 `visibility` 列：

```sql
ALTER TABLE notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE notebooks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE mindmaps ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE';
```

并为每张表添加索引：
```sql
CREATE INDEX IF NOT EXISTS idx_notes_visibility ON notes(workspaceId, visibility, userId);
CREATE INDEX IF NOT EXISTS idx_notebooks_visibility ON notebooks(workspaceId, visibility, userId);
CREATE INDEX IF NOT EXISTS idx_mindmaps_visibility ON mindmaps(workspaceId, visibility, userId);
```

### 后端查询过滤

在 `acl.ts` 中新增 `buildVisibilityFilter` 函数：

```typescript
/**
 * 为列表查询构建可见性过滤条件。
 * 用户只能看到：
 *   1. visibility = 'WORKSPACE' 的记录
 *   2. visibility = 'PRIVATE' 且自己为创建者的记录
 * 适用于 notes / notebooks / mindmaps 表。
 */
export function buildVisibilityFilter(
  userId: string,
  tableAlias: string = "",
  workspaceId: string | null,
): { clause: string; params: any[] } {
  const p = tableAlias ? `${tableAlias}.` : "";
  // 个人空间（workspaceId IS NULL）不应用可见性过滤，保持全可见
  if (!workspaceId) {
    return { clause: "", params: [] };
  }
  return {
    clause: `AND (${p}visibility = 'WORKSPACE' OR (${p}visibility = 'PRIVATE' AND ${p}userId = ?))`,
    params: [userId],
  };
}
```

### 列表接口变更

所有列表查询接口（notes / notebooks / mindmaps）增加可见性过滤：

**笔记列表** (`routes/notes.ts`):
```typescript
// 原有 workspaceId 条件后追加
const { clause, params } = buildVisibilityFilter(userId, "", workspaceId);
sql += ` ${clause}`;
```

**笔记本列表** (`routes/notebooks.ts`):
- 同上追加

**思维导图列表** (`routes/mindmaps.ts`):
- 同上追加

### 单资源接口

对单资源读取/更新/删除接口（通过 ID 直接访问）：
- 用户仅能读取自己拥有或 `WORKSPACE` 可见的记录
- 后端在资源行 fetch 后校验：`visibility === 'WORKSPACE' || resource.userId === currentUserId`

### 可见性变更 API

新增/复用某个资源的 PUT 接口接受 `visibility` 参数：
```typescript
// PUT /api/notes/:id
// 请求体中可传 { visibility: "PRIVATE" | "WORKSPACE" }
// 仅资源创建者可修改，后端校验 userId 匹配
```

### 前端 UI

在笔记编辑器、笔记本属性面板、思维导图编辑器中增加可见性切换：

```
┌─────────────────────────┐
│  可见性                  │
│  ○ 仅自己可见 🔒         │
│  ● 工作区所有人可见 🌐    │
│                          │
│  仅创建者可修改           │
└─────────────────────────┘
```

## 4. 剪藏笔记本迁移

### clip.ts

修改默认笔记本查找/创建逻辑：
- 当前：有 workspaceId 时查 `workspaceId = ? AND name = '剪藏笔记本'`；无 workspaceId 时查 `userId = ? AND workspaceId IS NULL AND name = '剪藏笔记本'`
- 变更：始终在**当前工作区**下查找/创建（`workspaceId` 取请求参数），无 workspaceId 时视为不可用（临时空间无法使用此功能）

插入语句增加 `visibility`：
```sql
INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, sortOrder, visibility)
VALUES (?, ?, ?, ?, ?, ?, ?, 'PRIVATE')
```

### url-import.ts

类似修改：移除个人空间逻辑，`notebookId` 未指定时在工作区下创建"剪藏笔记本"。
插入语句增加 `visibility = 'PRIVATE'`。

## 5. 前端路由/视图控制

### App.tsx

新增工作区检测逻辑：
```typescript
// 组件挂载时检测
const [hasFamilySpace, setHasFamilySpace] = useState<boolean | null>(null);

useEffect(() => {
  api.getWorkspaces().then(list => {
    setHasFamilySpace(list.length > 0);
    if (!list.length) {
      // 无空间：清除当前 workspace，显示引导页
      setCurrentWorkspace("");
    }
  });
}, []);
```

渲染条件：
- `hasFamilySpace === false` → 渲染 `FirstRunWizard`（改造后的全屏引导页）
- `hasFamilySpace === true` → 渲染正常 App（Sidebar + 主内容区）
- `hasFamilySpace === null` → 渲染 loading 状态

### Sidebar 中的家庭TODO

在 Project 区域插入「家庭TODO」条目，位于「我的任务」和「个人TODO」之间。

## 6. getCurrentWorkspace() 行为变更

### 当前行为

```typescript
export function getCurrentWorkspace(): string {
  return localStorage.getItem(WORKSPACE_KEY) || "personal";
}
```

默认返回 `"personal"`，前端 API 层据此自动注入 `workspaceId`。

### 变更后

当用户无任何工作区时，`getCurrentWorkspace()` 应返回空字符串 `""`：

```typescript
export function getCurrentWorkspace(): string {
  const ws = localStorage.getItem(WORKSPACE_KEY);
  return ws || "";  // 不再回退到 "personal"
}
```

### API 层适配 (`api.ts`)

所有自动注入 `workspaceId` 的逻辑需要处理空字符串情况。例如：

```typescript
// 当前：if (payload.workspaceId === undefined && currentWs && currentWs !== "personal")
// 变更：if (payload.workspaceId === undefined && currentWs && currentWs !== "")
```

确保无工作区状态下：
- 接口调用不会附加 `?workspaceId=` 参数（后端自然返回空列表或少报错）
- 引导页自身不依赖需要 workspaceId 的接口

## 7. "家庭TODO" 的作用域

- 「家庭TODO」是按照**工作区**隔离的：每个工作区下有一个名为"家庭TODO"的 Project
- 不同工作区的用户的"家庭TODO"独立，互不影响

## 8. 存量个人空间数据处理

- 存量用户如有个人空间数据（`workspaceId IS NULL`），这部分数据保留在数据库中
- 用户创建或加入工作区后，这些数据不会自动迁移到工作区，也不会显示在工作区视图中
- 用户仍然可以→创建家庭空间后，手动在侧边栏选择工作区，但笔记列表只会显示该工作区下的笔记
- 这是一个有意设计的选择：个人空间数据锚定在原本的 userId 维度，不会自动合并到工作区

## 9. 功能锁定

当用户无家庭空间时，引导页完全屏蔽所有功能入口。当用户在工作区中时，已有 `WorkspaceFeatures` 机制（侧边栏 navItems 过滤）控制各模块的显示，无需额外变更。

## 10. 兼容性

- 存量用户已有工作区 → 不受影响，正常显示
- 存量用户仅有个人空间（无工作区）→ 引导页会显示，用户需要创建或加入工作区
- 存量笔记/笔记本/思维导图数据（`visibility` 列 NULL）→ 查询时按 `PRIVATE` 兜底
- 剪藏笔记本数据：存量"剪藏笔记本"在个人空间中的保持不变，新增的在工作区下创建
