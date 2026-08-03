/**
 * 附件反向索引（attachment_references）维护工具
 * ---------------------------------------------------------------------------
 * 背景：
 *   /api/files/:id 详情接口需要回答"这张图被哪些笔记引用了"。在 v11 之前
 *   它走 `SELECT FROM notes WHERE content LIKE '%/api/attachments/<id>%'` 的
 *   全表 LIKE 扫描——每查一次都把所有笔记 content 拖一遍 + 字符串子串匹配，
 *   笔记规模上来后必然成为瓶颈（content 字段经常是 JSON / HTML，体积大）。
 *
 *   v11 引入 `attachment_references(attachmentId, noteId)` 复合主键表作为
 *   倒排索引。本模块提供两个核心能力：
 *     1) extractAttachmentIdsFromContent(content): 从 note.content 字符串里
 *        解析出所有 `/api/attachments/<uuid>` 和 `/api/task-attachments/<uuid>`
 *        引用，去重返回 attachmentId 集合。
 *     2) syncReferences(noteId, content): 把 attachment_references 表里
 *        noteId 对应的行**全量同步**到 content 当前实际引用的集合。
 *        实现：diff old/new → 增删行（在调用方提供的事务里执行）。
 *
 * 维护时机（写时维护）：
 *   - POST /api/notes        新笔记创建后 → syncReferences
 *   - PUT  /api/notes/:id    笔记内容更新后 → syncReferences（仅 content 变更时）
 *   - /api/export/import     批量导入后 → 在导入事务末尾对每条 note 调用
 *   - extractInlineBase64Images：内部 INSERT attachment 行**不算**引用维护，
 *     因为它仅在 content 字符串里把 data URI 替换成 /api/attachments/<id>；
 *     真正的"哪条 note 引用哪个附件"由调用方在 extract 完成后调 syncReferences
 *     统一完成（一次性收口，无遗漏）。
 *
 * 维护时机（自动收尾）：
 *   - 笔记删除 → attachment_references.noteId 外键 ON DELETE CASCADE 自动清
 *   - 附件删除 → attachment_references.attachmentId 外键 ON DELETE CASCADE 自动清
 *
 * 不维护的场景（设计取舍）：
 *   - notes.isTrashed = 1：被丢回收站的笔记**保留**引用记录。这样在回收站
 *     里恢复后无需重算；而详情接口可按需根据 references[i].isTrashed 决定
 *     是否展示"已删除"标记（沿用 v10 之前的语义）。
 *   - task-attachments：与本模块表 attachment_references 中 attachmentId 不
 *     强制外键关联（外键只指向 attachments(id)），所以解析出的 task 附件 id
 *     不会被入库。这是个设计简化——task 附件的反查需求未来再单独建表。
 *     当前仅扫 `/api/attachments/<uuid>` 单一前缀。
 *
 * 正则设计：
 *   - 仅匹配 `/api/attachments/` 前缀 + 标准 UUID v4 形态（8-4-4-4-12 hex）。
 *     避免误匹配类似 `/api/attachments/_orphans/scan` 之类的非 uuid 路径。
 *   - 不分定界（引号 / 括号 / 反引号），uuid 严格匹配本身已经足够防误。
 */

import type Database from "better-sqlite3";

// 严格 UUID v4 形态：8-4-4-4-12 hex
// 大小写不敏感（部分客户端可能小写化，但生成端是小写，这里兼顾）。
const ATTACHMENT_ID_RE =
  /\/api\/attachments\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

/**
 * 从 note.content 字符串里解析出所有 attachment id（去重）。
 *
 * 兼容三种语境：
 *   - Tiptap JSON：序列化后形如 `"src":"/api/attachments/<uuid>"`
 *   - HTML：`<img src="/api/attachments/<uuid>">`
 *   - Markdown：`![alt](/api/attachments/<uuid>)`
 * 全靠子串匹配，不需要解析 JSON / HTML / Markdown。
 *
 * 空字符串 / null 安全返回空集合。
 */
export function extractAttachmentIdsFromContent(
  content: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!content || typeof content !== "string") return out;
  // 快速预检：没有 `/api/attachments/` 字面量直接返回，零分配
  if (content.indexOf("/api/attachments/") < 0) return out;

  // 必须每次新建 RegExp 实例（带 g 的正则共享 lastIndex 在并发下不安全）。
  const re = new RegExp(ATTACHMENT_ID_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * 把 attachment_references 表里 noteId 对应的行同步到 content 当前实际引用的集合。
 *
 * 行为：
 *   - 读出 old = SELECT attachmentId FROM attachment_references WHERE noteId = ?
 *   - 计算 new = extractAttachmentIdsFromContent(content)
 *   - toAdd = new - old；toDel = old - new
 *   - 批量 INSERT OR IGNORE / DELETE
 *
 * 幂等：再次以同样的 (noteId, content) 调用是 no-op。
 *
 * 事务：本函数**不**开事务；调用方在自己的事务里调用即可，与
 * extractInlineBase64Images 同款约定，避免嵌套事务。
 *
 * 容错：
 *   - 个别 attachmentId 在 attachments 表中已不存在（脏引用）→ INSERT OR IGNORE
 *     会失败（外键约束），用 try/catch 单条吞错，不阻塞整体维护。这种脏引用
 *     在用户编辑器里也会渲染成"裂图"，不索引才是正确行为。
 */
export function syncReferences(
  db: Database.Database,
  noteId: string,
  content: string | null | undefined,
): { added: number; removed: number } {
  const newSet = extractAttachmentIdsFromContent(content);

  const oldRows = db
    .prepare("SELECT attachmentId FROM attachment_references WHERE noteId = ?")
    .all(noteId) as { attachmentId: string }[];
  const oldSet = new Set(oldRows.map((r) => r.attachmentId.toLowerCase()));

  // toAdd / toDel
  const toAdd: string[] = [];
  for (const id of newSet) if (!oldSet.has(id)) toAdd.push(id);
  const toDel: string[] = [];
  for (const id of oldSet) if (!newSet.has(id)) toDel.push(id);

  let added = 0;
  let removed = 0;

  if (toAdd.length > 0) {
    const insertOne = db.prepare(
      "INSERT OR IGNORE INTO attachment_references (attachmentId, noteId) VALUES (?, ?)",
    );
    for (const id of toAdd) {
      try {
        const info = insertOne.run(id, noteId);
        if (info.changes > 0) added++;
      } catch {
        // 外键失败（attachmentId 已不存在）— 静默跳过
      }
    }
  }

  if (toDel.length > 0) {
    const delPlaceholders = toDel.map(() => "?").join(",");
    const info = db
      .prepare(
        `DELETE FROM attachment_references WHERE noteId = ? AND attachmentId IN (${delPlaceholders})`,
      )
      .run(noteId, ...toDel);
    removed = Number(info.changes || 0);
  }

  return { added, removed };
}

/**
 * 收集「不在 notes.content 正文里、但仍在被业务使用」的 attachment id。
 *
 * 背景：
 *   文件管理「孤儿 / 未引用」与 cleanup-orphans 历史上只扫 notes.content。
 *   书籍文件、封面等通过 books 表引用 attachments，从不写入笔记正文，
 *   会被误判为孤儿并在一键清理时删掉仍在读的书。
 *
 * 当前纳入：
 *   1) books.attachmentId —— 书文件本体（uploadSource='book'）
 *   2) books.metadata.coverAttachmentId —— 书籍封面（uploadSource='book_cover'）
 *   3) media_items / media_collections.cover_url 若指向 /api/attachments/<uuid>
 *      （媒体封面若走 diary_attachments 则不在 attachments 表，此处无影响）
 *
 * id 统一小写，与 extractAttachmentIdsFromContent 一致；调用方比较时应对
 * candidate id 做 toLowerCase。
 */
export function collectStructuralAttachmentIds(
  db: Database.Database,
): Set<string> {
  const out = new Set<string>();

  try {
    const bookRows = db
      .prepare("SELECT attachmentId, metadata FROM books")
      .all() as { attachmentId: string | null; metadata: string | null }[];
    for (const r of bookRows) {
      if (r.attachmentId) out.add(String(r.attachmentId).toLowerCase());
      if (!r.metadata) continue;
      try {
        const meta = JSON.parse(r.metadata) as { coverAttachmentId?: string | null };
        if (meta?.coverAttachmentId) {
          out.add(String(meta.coverAttachmentId).toLowerCase());
        }
      } catch {
        // metadata 非 JSON 时忽略
      }
    }
  } catch {
    // books 表不存在等极端情况：跳过，不影响其它判定
  }

  try {
    const coverRows = db
      .prepare(
        `SELECT cover_url AS u FROM media_items
          WHERE cover_url IS NOT NULL AND cover_url <> ''
         UNION ALL
         SELECT cover_url AS u FROM media_collections
          WHERE cover_url IS NOT NULL AND cover_url <> ''`,
      )
      .all() as { u: string }[];
    for (const r of coverRows) {
      for (const id of extractAttachmentIdsFromContent(r.u)) {
        out.add(id);
      }
    }
  } catch {
    // media 表未迁移时跳过
  }

  return out;
}

/**
 * 收集 ATTACHMENTS_DIR 里「已被任意附件表登记」的 path（相对文件名）。
 *
 * 用途：
 *   cleanup-orphans 的「磁盘孤儿」扫描不能只查 attachments 表——
 *   task_attachments / diary_attachments 共用同一目录，若漏掉它们，
 *   任务图、说说图会被当成无主文件删掉。
 *
 * 容错：某表不存在时跳过该源。
 */
export function collectKnownAttachmentPaths(db: Database.Database): Set<string> {
  const out = new Set<string>();
  const tables = ["attachments", "task_attachments", "diary_attachments"] as const;
  for (const table of tables) {
    try {
      const rows = db.prepare(`SELECT path FROM ${table}`).all() as { path: string | null }[];
      for (const r of rows) {
        if (r?.path) out.add(r.path);
      }
    } catch {
      // 表不存在等
    }
  }
  return out;
}

/**
 * 判断某个相对 path 是否仍被「非本批 attachments 孤儿」占用，不能 unlink。
 *
 * @param excludingAttachmentIds 即将删除的 attachments.id 集合；这些行本身不算「仍占用」
 */
export function isAttachmentPathStillInUse(
  db: Database.Database,
  filePath: string,
  excludingAttachmentIds?: Set<string>,
): boolean {
  try {
    const rows = db
      .prepare("SELECT id FROM attachments WHERE path = ?")
      .all(filePath) as { id: string }[];
    for (const r of rows) {
      if (!excludingAttachmentIds || !excludingAttachmentIds.has(r.id)) return true;
    }
  } catch {
    /* ignore */
  }
  for (const table of ["task_attachments", "diary_attachments"] as const) {
    try {
      const hit = db
        .prepare(`SELECT 1 AS ok FROM ${table} WHERE path = ? LIMIT 1`)
        .get(filePath) as { ok: number } | undefined;
      if (hit) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
