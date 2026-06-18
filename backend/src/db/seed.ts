import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

export function seedDatabase() {
  const db = getDb();

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count > 0) return;

  const userId = uuid();
  const passwordHash = crypto.createHash("sha256").update("admin123").digest("hex");

  db.prepare(`
    INSERT INTO users (id, username, email, passwordHash, role, displayName) VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, "admin", "admin@super-note.local", passwordHash, "admin", "管理员");

  const nb1Id = uuid();
  const nb2Id = uuid();
  const nb3Id = uuid();

  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb1Id, userId, "工作笔记", "💼", 0);
  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb2Id, userId, "个人日记", "📔", 1);
  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb3Id, userId, "技术学习", "🧑‍💻", 2);

  const subNbId = uuid();
  db.prepare(`INSERT INTO notebooks (id, userId, parentId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`).run(subNbId, userId, nb3Id, "前端笔记", "⚛️", 0);

  const notes = [
    { notebookId: nb1Id, title: "项目启动会议纪要", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"今天讨论了 super-note 项目的整体架构方案..."}]}]}', contentText: "今天讨论了 super-note 项目的整体架构方案..." },
    { notebookId: nb1Id, title: "Q1 目标与 OKR", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"2026 年 Q1 核心目标：完成 super-note v1.0 发布"}]}]}', contentText: "2026 年 Q1 核心目标：完成 super-note v1.0 发布", isPinned: 1 },
    { notebookId: nb2Id, title: "周末计划", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"周六去图书馆，周日整理房间"}]}]}', contentText: "周六去图书馆，周日整理房间" },
    { notebookId: nb3Id, title: "React Server Components 学习", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"RSC 是 React 18 引入的新范式，可以在服务端渲染组件..."}]}]}', contentText: "RSC 是 React 18 引入的新范式，可以在服务端渲染组件..." },
    { notebookId: subNbId, title: "Tiptap 编辑器集成指南", content: '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tiptap 快速开始"}]},{"type":"paragraph","content":[{"type":"text","text":"Tiptap 是基于 ProseMirror 的现代富文本编辑器框架..."}]},{"type":"codeBlock","attrs":{"language":"typescript"},"content":[{"type":"text","text":"import { useEditor } from \\\"@tiptap/react\\\""}]}]}', contentText: "Tiptap 快速开始 Tiptap 是基于 ProseMirror 的现代富文本编辑器框架... import { useEditor } from \"@tiptap/react\"", isFavorite: 1 },
  ];

  for (const note of notes) {
    const noteId = uuid();
    db.prepare(`
      INSERT INTO notes (id, userId, notebookId, title, content, contentText, isPinned, isFavorite)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(noteId, userId, note.notebookId, note.title, note.content, note.contentText, note.isPinned || 0);
    // Y1: 收藏语义已迁移到 favorites 表（per-user）。seed 里的 isFavorite:1 翻译为
    // "种子用户自己收藏了这条笔记"。物理列 notes.isFavorite 始终写 0（过渡期保留）。
    if (note.isFavorite) {
      db.prepare(`
        INSERT OR IGNORE INTO favorites (userId, noteId, workspaceId, createdAt)
        VALUES (?, ?, NULL, datetime('now'))
      `).run(userId, noteId);
    }
  }

  const tag1Id = uuid();
  const tag2Id = uuid();
  const tag3Id = uuid();
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag1Id, userId, "重要", "#f85149");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag2Id, userId, "技术", "#58a6ff");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag3Id, userId, "灵感", "#7ee787");

  // Seed project data if user exists and projects are empty
  const projectCount = db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number };
  if (projectCount.count === 0) {
    const firstUser = db.prepare("SELECT id FROM users ORDER BY createdAt ASC LIMIT 1").get() as { id: string } | undefined;
    if (firstUser) {
      const uId = firstUser.id;
      const pId = uuid();
      
      // Create project group
      const gId = uuid();
      db.prepare(`INSERT INTO project_groups (id, name, userId, sortOrder) VALUES (?, ?, ?, 0)`).run(gId, "内部研发项目", uId);

      // Create "项目管理" project
      db.prepare(`
        INSERT INTO projects (id, name, description, cover, startDate, endDate, visibility, ownerId, groupId)
        VALUES (?, ?, ?, ?, ?, ?, 'PUBLIC', ?, ?)
      `).run(
        pId,
        "项目管理",
        "示例项目管理看板，包含启动项目、执行推进、生产阶段等不同阶段的任务管理。",
        "/preset-covers/gradient-1.png",
        "2026-06-01",
        "2026-06-30",
        uId,
        gId
      );

      // Add project member
      db.prepare(`INSERT INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')`).run(pId, uId);

      // Create stages
      const s1Id = uuid();
      const s2Id = uuid();
      const s3Id = uuid();
      db.prepare(`INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, 0)`).run(s1Id, pId, "启动项目");
      db.prepare(`INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, 1)`).run(s2Id, pId, "执行推进");
      db.prepare(`INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, 2)`).run(s3Id, pId, "生产阶段");

      // Create tasks for stage 1 (启动项目)
      const t1Id = uuid();
      db.prepare(`
        INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, creatorId, modifierId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t1Id,
        pId,
        s1Id,
        "测试1323",
        0,
        uId,
        "2026-06-01",
        "2026-06-05",
        "测试任务描述信息，如水电费水电费等。",
        uId,
        uId
      );

      // Create checklist for task 1
      db.prepare(`INSERT INTO project_task_checklists (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(uuid(), t1Id, "任务分工确认", 0);

      const t2Id = uuid();
      db.prepare(`
        INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, creatorId, modifierId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t2Id,
        pId,
        s1Id,
        "测试任务",
        1,
        uId,
        "2026-06-02",
        "2026-06-04",
        "这是另外一个测试任务。",
        uId,
        uId
      );

      // Create tasks for stage 2 (执行推进)
      const t3Id = uuid();
      db.prepare(`
        INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, creatorId, modifierId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t3Id,
        pId,
        s2Id,
        "早早早",
        0,
        uId,
        "2026-06-06",
        "2026-06-10",
        "推进早早早阶段性成果汇报",
        uId,
        uId
      );

      const t4Id = uuid();
      db.prepare(`
        INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, creatorId, modifierId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t4Id,
        pId,
        s2Id,
        "关于电子签名的讨论",
        0,
        uId,
        "2026-06-08",
        "2026-06-09",
        "深入讨论电子签名的法律效应和技术方案",
        uId,
        uId
      );

      // Create tasks for stage 3 (生产阶段)
      const t5Id = uuid();
      db.prepare(`
        INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, creatorId, modifierId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t5Id,
        pId,
        s3Id,
        "准备文件",
        0,
        uId,
        "2026-06-12",
        "2026-06-15",
        "生产前核对所有的合规文件是否齐全",
        uId,
        uId
      );

      // Create a project discussion thread
      db.prepare(`
        INSERT INTO project_discussions (id, projectId, userId, content, linkedCards)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        uuid(),
        pId,
        uId,
        "列表可以优化一下，看看还有什么需要补充的内容。",
        JSON.stringify([{ type: "task", id: t3Id, title: "早早早" }, { type: "task", id: t4Id, title: "关于电子签名的讨论" }])
      );
    }
  }

  console.log("✅ Database seeded successfully");
}

// ===== AI 助手账号 =====

export const AI_ASSISTANT_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * 在 users 表中创建 AI 助手账号（幂等）。
 * 该账号用于 AI 在说说模块中以独立身份发布内容。
 * 密码为随机哈希，不可登录。
 */
export function initAiAssistantUser() {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(AI_ASSISTANT_USER_ID);
  if (existing) return;

  const randomHash = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex");
  db.prepare(`
    INSERT INTO users (id, username, email, passwordHash, role, displayName, avatarUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    AI_ASSISTANT_USER_ID,
    "ai-assistant",
    null,
    randomHash,
    "ai",
    "AI 助手",
    null,
  );

  console.log("✅ AI assistant user created");
}
