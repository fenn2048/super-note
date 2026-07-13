# super-note 音视频媒体库模块 技术实现方案

## 1. 系统架构概览

### 1.1 整体逻辑架构
super-note 媒体库模块采取前后端分离、存储与业务解耦的架构模式。

```mermaid
graph TD
    subgraph 前端 (React + Vite)
        A[MediaCenter 主入口]
        A --> B(MediaPlayer/MusicPlayer)
        A --> C(TipTap Editor + 时间戳)
        A --> D(AlistBrowser 导入器)
        B --> E[Zustand Store]
    end

    subgraph 后端 (Hono + Node.js)
        F[路由: routes/media.ts]
        F --> G{权限中间件}
        G --> H(SQLite Database)
        G --> I(Alist API Client)
    end

    subgraph 基础设施层
        H --> J[(better-sqlite3)]
        K[(Redis)] -- 直链缓存 --> F
        I --> L[Docker 内网 Alist 容器]
    end

    B -- 直链拉取流媒体 --> M((网盘 CDN))
    Client -- 上传封面图 --> F
```

### 1.2 存储分层架构
*   **重度媒体资源 (2TB+)**：存储于阿里云盘/夸克网盘。应用层只保存 `alist_path`，前端直接通过直链向网盘 CDN 请求数据，实现服务器 0 带宽压力。
*   **轻量 UGC (说说附件、封面图)**：存储于服务器本地磁盘（原有 `diary_attachments` 流程），由 Nginx 或 Hono 静态服务提供。
*   **业务数据**：存储于本地 SQLite 数据库。

---

## 2. 数据库设计

### 2.1 完整 SQLite DDL

需在 `/Users/fenn/code/super-note/backend/src/db/migrations.ts` 中新增一个 migration 记录。以下为新增的 6 张表。

```sql
-- 1. 媒体合集表
CREATE TABLE media_collections (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id    TEXT,                              
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('video','audio')),
  cover_url       TEXT,                              
  description     TEXT,
  recommendation  TEXT,                              
  sort_order      INTEGER DEFAULT 0,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_collections_workspace ON media_collections(workspace_id);

-- 2. 媒体单品表
CREATE TABLE media_items (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  collection_id   TEXT REFERENCES media_collections(id) ON DELETE SET NULL, 
  workspace_id    TEXT,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('video','audio')),
  cover_url       TEXT,                              
  description     TEXT,                              
  alist_path      TEXT NOT NULL,                     
  artist          TEXT,                              
  duration        INTEGER,                           
  year            INTEGER,                           
  genre           TEXT DEFAULT '[]',                 
  sort_order      INTEGER DEFAULT 0,                 
  play_count      INTEGER DEFAULT 0,
  last_played_at  TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_items_collection ON media_items(collection_id);
CREATE INDEX idx_media_items_workspace ON media_items(workspace_id);
CREATE INDEX idx_media_items_type ON media_items(type);
CREATE INDEX idx_media_items_title ON media_items(title);

-- 3. 单品与标签多对多关联表 (复用现有 tags 表)
CREATE TABLE media_tags (
  media_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

-- 4. 影评/乐评/短评/推荐互动表
CREATE TABLE media_reviews (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  media_id    TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK(type IN ('long_review','short_comment','recommendation')),
  title       TEXT,                                  
  content     TEXT NOT NULL,                         
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_reviews_media ON media_reviews(media_id);
CREATE INDEX idx_media_reviews_user ON media_reviews(user_id);
CREATE INDEX idx_media_reviews_type ON media_reviews(media_id, type);

-- 5. 播放历史表
CREATE TABLE media_play_history (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  media_id    TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  progress    INTEGER DEFAULT 0,                     
  played_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_play_history_user ON media_play_history(user_id, played_at DESC);
CREATE INDEX idx_play_history_media ON media_play_history(media_id);

-- 6. 合集与标签关联表 (可选扩展)
CREATE TABLE media_collection_tags (
  collection_id  TEXT NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, tag_id)
);
```

### 2.2 Migration 编写指南
在 `migrations.ts` 的 `up` 函数中，使用 `db.exec()` 执行上述 SQL 语句。遵循现有的 ID 策略：业务主表（如 items, collections）使用 UUID `lower(hex(randomblob(16)))`，关联表复用对应主键类型。

---

## 3. 后端实现方案

### 3.1 路由与权限设计 (`routes/media.ts`)
*   新建路由文件 `backend/src/routes/media.ts`。
*   注入全局鉴权中间件。
*   **特性开关检查**：在路由顶级或具体 Handler 内，通过 `requireWorkspaceFeature('media')` 拦截未开启的请求。检查 `system_settings` 表确保 Alist 已配置。
*   **操作权限控制**：写入操作（导入、CRUD 单品/合集）需要利用现有的 `canManageResource()` 检查当前用户角色是否为 owner 或 admin。

### 3.2 Alist API 集成层
封装 `AlistClient` 类：
```typescript
class AlistClient {
    private baseUrl: string;
    private token: string;

    constructor(baseUrl: string, token: string) { ... }

    // 目录浏览 API
    async listDirectory(path: string): Promise<AlistFile[]> {
        // 请求 Alist POST /api/fs/list 接口
    }

    // 获取直链 API
    async getFileLink(path: string): Promise<string> {
        // 请求 Alist POST /api/fs/get 接口
    }
}
```

### 3.3 Redis 直链缓存策略
获取直链的高频接口 `/api/media/items/:id/play-url` 需严格执行缓存：
1.  构建 Cache Key: `media:link:${itemId}`。
2.  若命中，直接返回 `{ url }`。
3.  若未命中，读取 SQLite 取出 `alist_path`，调用 `AlistClient.getFileLink()`。
4.  将结果写入 Redis，设置过期时间 `TTL = 45分钟`（即 2700 秒）。

### 3.4 封面图处理
复用现有的 `diary_attachments` 上传 API。
在接收到图片并落盘前，使用 `sharp` 处理流：
```typescript
await sharp(inputBuffer)
  .resize(300, null, { withoutEnlargement: true }) // 限制宽度 300px
  .webp({ quality: 80 })
  .toFile(outputPath);
```

---

## 4. 前端实现方案

### 4.1 核心组件树
```text
MediaCenter.tsx (路由主入口)
 ├── MediaSidebar.tsx (合集导航、标签过滤)
 ├── MediaHeader.tsx (搜索、筛选、Alist 配置入口)
 └── MediaContentArea.tsx
      ├── CollectionListView.tsx
      ├── MediaItemDetail.tsx
      │    ├── MediaPlayer.tsx (基于 react-player)
      │    ├── MusicPlayer.tsx (基于 react-h5-audio-player)
      │    └── MediaReviewSection.tsx
      │         ├── TiptapEditor.tsx (复用，加入时间戳扩展)
      │         └── CommentList.tsx
      └── AlistBrowserModal.tsx (导入弹窗)
```

### 4.2 Zustand 状态管理
创建 `frontend/src/store/mediaStore.ts`：
```typescript
interface MediaState {
  isPlaying: boolean;
  currentMediaId: string | null;
  currentTime: number; // 当前播放进度
  setPlaybackTime: (time: number) => void; // 供点击时间戳时触发，控制播放器 seek
}
```

### 4.3 TipTap 时间戳扩展 (`TimestampExtension.ts`)
基于现有 TipTap 体系新建 Node Extension：
*   **Node 表现**：行内元素，渲染为类似 `<a class="timestamp-link" data-time="755">12:35</a>` 的 HTML。
*   **UI 按钮集成**：在编辑器工具栏新增按钮，点击时调用 `mediaStore.getState().currentTime`，格式化为 `MM:SS` 文本并插入当前光标位置。
*   **点击拦截**：为渲染后的只读内容绑定事件，解析 `data-time`，调用 store 触发播放器跳转。

### 4.4 App.tsx 路由注册
在 `NAV_CONFIG` 中新增项：
```typescript
{
  id: 'media',
  label: 'i18n.mediaLibrary',
  icon: FilmIcon,
  viewMode: 'media'
}
```
在 `App.tsx` 的 switch 逻辑中挂载 `<MediaCenter />`。

---

## 5. API 详细设计

以最关键的两个 API 为例：

### 5.1 获取播放直链
**`GET /api/media/items/:id/play-url`**
*   **Req**: header 携带 JWT Token。
*   **Res**:
    ```json
    {
      "code": 200,
      "data": {
        "url": "https://cdn.aliyundrive.com/...",
        "expires_at": 1720000000 
      }
    }
    ```
*   **Errors**: `403` (未开启媒体库功能 / 用户无权), `404` (单品不存在), `502` (Alist 服务器不可达)。

### 5.2 批量导入请求 (JSON 模式)
**`POST /api/media/import/json`**
*   **Req Body**:
    ```json
    {
      "collection": {
        "title": "测试合集",
        "type": "video",
        "cover_url": "..."
      },
      "items": [
        { "title": "单品1", "alist_path": "/video1.mp4" }
      ]
    }
    ```
*   **Res**:
    ```json
    {
      "code": 200,
      "message": "成功导入 1 个合集，1 个单品"
    }
    ```

---

## 6. Alist 集成详细方案

### 6.1 Docker 网络拓扑
在 `docker-compose.yml` 中：
```yaml
services:
  super-note:
    # 保持现有配置
    networks:
      - super_net

  alist:
    image: xhofe/alist:latest
    # 移除 ports 映射，仅暴露给内网
    # ports:
    #   - "5244:5244" 
    networks:
      - super_net
    volumes:
      - ./data/alist:/opt/alist/data
```
通过 `http://alist:5244` 供 super-note 容器后端调用。

---

## 7. 安全设计与风险声明

1.  **直链时效控制**：网盘实际链接过期时间通常 >1 小时。后端严格控制 Redis 缓存 TTL 设为 45 分钟，前端播放器遇到 403 时自动触发重试机制刷新直链。
2.  **直链截取**：接受“授权用户通过浏览器抓包获取直链并分享”的风险，不使用防盗链等复杂技术栈，确保系统极简。
3.  **SSRF 防御**：由于配置 Alist 地址的能力收敛在 owner 角色，系统免受普通用户的恶意 URL 探测风险。

---

## 8. 开发计划里程碑 (v1.0)

*   **Phase 1: 基础设施** (1 周)
    *   执行 SQLite 迁移脚本，建好 6 张表。
    *   在 `SettingsModal` 完成 Alist 配置存取逻辑，联通后端与 Docker 中的 Alist 服务。
*   **Phase 2: 核心管理流** (1-2 周)
    *   完成后端 CRUD 接口。
    *   开发前端 Alist 目录浏览器组件 (`AlistBrowser.tsx`)，实现导入落库。
    *   实现 JSON 解析与批量导入接口。
*   **Phase 3: 播放体验流** (1 周)
    *   集成 `react-player` 和 `react-h5-audio-player`。
    *   实现前端获取播放直链逻辑，后端接入 Redis 缓存控制。
*   **Phase 4: 互动流与打磨** (1 周)
    *   开发 TipTap 的时间戳扩展。
    *   完成影评/短评组件。
    *   整体 UI 的移动端响应式适配及 i18n 字符替换。

---

## 9. 验收与测试策略
*   **集成测试**：Mock 一个 Alist 返回结构，测试后端自动解析文件名提取标题的能力。
*   **权限测试**：分别以 viewer 和 owner 的 JWT 访问导入 API，断言 viewer 收到 403。
*   **边界测试**：向 `/api/media/items/:id/play-url` 接口发起短时高并发请求，断言 Redis 缓存穿透控制逻辑正常（同一秒内的并发请求只触发 1 次 Alist API 实际调用）。
