# Super Note (弄文笔记) - 已实现需求产品需求文档 (PRD)

> **项目定位**：面向个人、家庭以及小团队（3-4人）的自托管私有知识库、社交轻说说、待办事项和 AI 智能问答协作平台。对标 Synology Note Station 与 Notion/flomo 的综合体，强调本地优先、数据私有及多端协同。
> **文档版本**：V1.1
> **更新时间**：2026-06-07

---

## 一、 系统架构与数据实体关系

### 1.1 系统核心技术栈
*   **前端**：React 18 + TypeScript + Vite 5 + Tailwind CSS + Framer Motion
*   **编辑器**：Tiptap 3 (ProseMirror 富文本) + CodeMirror 6 (Markdown)
*   **后端**：Hono v4 (TypeScript + Node.js 20 运行时) + WebSockets
*   **数据库**：SQLite (better-sqlite3) + sqlite-vec (向量化 KNN 检索) + FTS5 (全文搜索虚拟表)
*   **多端技术**：Electron 33 (桌面端打包) + Capacitor 8 (移动端 Android/iOS 适配)
*   **AI 引擎**：SenseVoice (本地/云端语音转文字) + OpenAI/DeepSeek/Ollama/Gemini 等大模型 API 接入

### 1.2 数据模型实体设计 (SQLite Schema)
系统核心数据表设计结构如下：

1.  **用户管理 (`users`)**：
    *   身份与安全：`id`, `username`, `email`, `passwordHash`, `avatarUrl`
    *   角色与状态：`role` ('admin' | 'user')，`isDisabled` (0 | 1 封禁标志)，`displayName`, `lastLoginAt`
    *   会话与风控：`tokenVersion` (改密/重置时累加，实现全部客户端下线)，`mustChangePassword`, `failedLoginAttempts`, `lastFailedLoginAt`, `lockedUntil` (锁定到期时间)
    *   双因子验证：`twoFactorSecret` (TOTP 密钥), `twoFactorEnabledAt`, `twoFactorBackupCodes` (恢复码)
2.  **工作区空间 (`workspaces`)**：
    *   `id`, `name`, `description`, `icon`, `ownerId`
    *   `workspace_members` 关联表角色划分：'owner' | 'admin' | 'editor' | 'commenter' | 'viewer'
    *   `workspace_invites` 邀请机制：`code` (唯一邀请码), `maxUses`, `useCount`, `expiresAt`
3.  **笔记本树 (`notebooks`)**：
    *   `id`, `userId`, `parentId` (父级笔记本ID，实现无限层级嵌套), `name`, `description`, `icon`, `color`, `sortOrder`, `isExpanded`, `workspaceId` (为空时归属个人空间)
    *   软删除：`isDeleted`, `deletedAt` (解决级联物理删除导致回收站笔记丢失的隐患)
4.  **笔记正文 (`notes`)**：
    *   `id`, `userId`, `notebookId`, `title`, `content` (Tiptap ProseMirror JSON 字符串), `contentText` (全文检索纯文本), `isPinned`, `isFavorite`, `isLocked`, `isArchived`, `isTrashed`, `trashedAt`, `version` (乐观锁版本号), `workspaceId`
5.  **日记说说 (`diaries`)**：
    *   `id`, `userId`, `contentText`, `mood` (心情表情), `images` (附件UUID的JSON数组), `visibility` ('PRIVATE' | 'WORKSPACE' | 'PUBLIC'), `voice` (语音文件路径)
6.  **待办任务 (`tasks`)**：
    *   `id`, `userId`, `title`, `isCompleted`, `priority` (0: 高, 1: 中, 2: 低), `dueDate` (截止日期), `remindAt` (提醒时间), `noteId` (关联笔记), `parentId` (子任务ID)
7.  **分享及评论 (`shares` / `share_comments`)**：
    *   分享设置：`shareToken`, `shareType` ('link'), `permission` ('view' | 'comment' | 'edit' | 'edit_auth'), `password`, `expiresAt`, `isActive`
    *   访客评论：`guestName`, `guestIpHash` (SHA-256 加密防垃圾评论)，支持楼层树形嵌套 (`parentId`)
8.  **Y.js 协同 (`note_yupdates` / `note_ysnapshots`)**：
    *   `update_blob` (Yjs 二进制增量更新), `snapshot_blob` (定期合并文档的快照)，用于协同编辑恢复

---

## 二、 核心功能模块需求 (Features PRD)

### 2.1 笔记管理系统 (Notes Module)
1.  **双编辑器引擎**：
    *   **富文本模式 (RTE)**：基于 Tiptap 3。支持基础文本样式、颜色、背景字号、首行缩进、Tab/Shift-Tab 调整列表缩进、图片上传与多点对称拖拽缩放。
    *   **Markdown 模式 (MD)**：基于 CodeMirror 6，数据持久化直接写入 Yjs 二进制 room。
    *   **模式同步切换**：切换时需处理数据迁移（RTE 的 JSON 转 Markdown，或 MD 文本解析并对齐 Yjs Room），带有防冲突和原子事务保障。
2.  **无限层级目录**：
    *   支持笔记本树形嵌套，用户可在侧边栏拖拽笔记本以进行重新归类或排序。
3.  **彩色标签引擎**：
    *   支持跨笔记、说说、待办事项通用标签，标签自带自定义色彩选择器。
4.  **版本回溯历史**：
    *   每次笔记保存触发版本递增，后台自动保存旧版本 (`note_versions`)，提供历史版本列表及一键恢复按钮。
5.  **隐私保护锁定**：
    *   单篇笔记支持密码独立锁定 (`isLocked`)，防止敏感信息泄露。

### 2.2 日记说说模块 (Says / Diary Module)
1.  **生活流/时间线发布**：
    *   定位为“朋友圈”或“flomo”式零压力短句记录。
    *   发说说支持选择心情 Emoji、关联标签、最多上传 9 张图片，并可实时上传语音。
2.  **智能语音转文字**：
    *   录音文件通过 `SenseVoice` 本地/云端语音模型接口进行异步转写，自动把文字填充在说说正文下方。
3.  **说说可见性策略**：
    *   *私密 (PRIVATE)*：仅自己可见。
    *   *工作区可见 (WORKSPACE)*：工作区内成员可见，支持在仪表盘或说说流中查看家人动态。
    *   *公开链接 (PUBLIC)*：生成只读的公开单页说说流。

### 2.3 待办事项中心 (Task Center)
1.  **GTD 任务属性**：
    *   任务支持划分三级优先级（高/中/低），具备截止日期、提前提醒时间（触发系统或应用内通知）。
    *   支持父子级子任务管理，满足复杂事务拆解需求。
2.  **笔记双向联动**：
    *   在富文本编辑器中输入 `- [ ]` 自动生成待办卡片，卡片会自动同步关联到待办事项表中；在任务中心也可点击跳转回关联的源笔记。
3.  **日历视图**：
    *   在任务中心支持直接切换为日历模式，直观展现不同日期下的待办项及完成状态。

### 2.4 多人协作与实时同步 (Collaboration & Synchronization)
1.  **基于 Yjs + WebSocket 的协同编辑**：
    *   在 Markdown 编辑模式下，借助 CRDT 算法进行多人同时段落修改合并。
    *   多人在同一篇笔记中协作时，编辑器顶部高亮显示其他协作人的头像，以及编辑器内部的光标跟踪位置。
2.  **工作区隔离与共享**：
    *   工作区支持个人空间和协作团队空间隔离。一个空间内创建的笔记本、标签、笔记及 RAG 知识检索自动做隔离。
    *   支持一键生成 6 位大写字母邀请码。
3.  **冲突保护机制**：
    *   单人离线编辑保存发生 `409 Version Conflict` 时，应用会自动拦截写入，保留本地草稿并弹出“重新加载远端”或“覆盖远端”的冲突解决面板，保障在多端离线状态下编辑的数据安全。

### 2.5 AI 助手与知识库 (AI RAG Module)
1.  **AI 写作辅助 (流式 SSE)**：
    *   覆盖：续写、改写、润色、精简、扩写、英汉互译、内容摘要、生成标题、推荐标签、规范化 Markdown/代码块包裹等内置指令。支持自定义 Prompt 模板的保存与一键复用。
2.  **RAG 知识库问答 (本地/云端双通道)**：
    *   **向量化 (Embeddings)**：支持利用 OpenAI 或本地 Ollama (如 bge-m3 等模型) 提取文本块向量。
    *   **混合召回检索**：
        1.  *向量召回 (KNN)*：采用 sqlite-vec 加载动态库，支持用户提问与知识库文档的语义级关联检索。
        2.  *全文检索 (FTS5)*：对没有向量化或不满足高相关度的查询，回退到 SQLite 预置的中文分词 FTS5 匹配。
        3.  *模糊匹配与最近更新*：终极兜底确保不返回空结果。
    *   **多文档解析器**：支持 PDF、Docx、Xlsx、Txt 附件内容的自动化解析与向量化切片。
    *   **安全隔离**：所有 RAG 向量检索均自动绑定 `workspaceId` 进行完全的隔离校验，防止跨组织知识偷窥。

### 2.6 文件管理与优化 (File Manager)
1.  **聚合视图**：
    *   提供全局附件聚合视图，支持通过分类（图片/文档/音频/视频）、上传来源进行高级筛选。
2.  **图床卡顿专项性能优化**：
    *   后端基于 `sharp` 实现缩略图处理服务，前端卡片仅请求 240/480/960px 的 WebP 自适应缩略图缓存，流量开销降至 1/100，解决长图片列表渲染 OOM 问题。
3.  **孤儿附件清理**：
    *   当笔记、说说、待办事项彻底被清空删除后，后台检查物理文件是否存在其它引用计数。若为 0 且超出 24h 宽限期，系统执行物理 `unlink` 清理，保障磁盘不被垃圾附件堆满。

---

## 三、 系统集成与外围生态

### 3.1 智能剪藏浏览器插件 (Web Clipper)
*   **兼容性**：Chrome 100+、Safari 15.4+ 以及统信 UOS 信创 ARM64 Chromium 全系列支持。
*   **私有配置**：支持自定义服务地址与 `nkn_` 前缀个人访问令牌 (API Token)。
*   **智能净化**：内置 Mozilla Readability，并针对微信公众号 (`mp.weixin.qq.com` 补齐图片懒加载)、知乎、CSDN、掘金开发了精准的去广告、去推荐去版权过滤规则。
*   **高级处理**：图片支持本地化上传（避免外链防盗链）并开启 1200px 宽度限制 of 80% 质量压缩以节省 NAS 空间，后端每日凌晨 2 点自动清理超 30 天未被引用的剪藏垃圾图片。

### 3.2 自托管备份与数据安全
1.  **自动定时备份**：
    *   支持每日定时全量导出系统 SQLite `.db` 文件及附件压缩包。
2.  **邮件 SMTP 通道**：
    *   内置主流邮箱 SMTP 预设教程，自动通过邮件附件发送备份压缩包，满足 3-2-1 异地备份原则。
3.  **多端自发现 (mDNS)**：
    *   后端启动后自动进行局域网 mDNS 服务广播，移动端或桌面端处于同一局域网下时，无需手动输入 IP，即可自动探测并连接服务器。
