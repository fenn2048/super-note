import crypto from "crypto";
import { redis } from "./redis";
import { getDb } from "../db/schema";
import { callLLM, extractKeywords } from "../routes/ai";
import { ensureSuUser, sendAiNotification, rowToDiary } from "../routes/diary";

const SU_USER_ID = "00000000-0000-0000-0000-000000000001";
let isRunning = false;

export async function startAiTaskWorker() {
  if (isRunning) return;
  isRunning = true;

  const groupName = "ai:workers:group";
  const consumerName = `worker-${process.pid}`;

  // 1. Create consumer group if not already present
  try {
    await redis.xgroup("CREATE", "ai:tasks:stream", groupName, "0", "MKSTREAM");
  } catch (err) {
    // Consumer group already exists, safe to ignore
  }

  console.log(`🤖 [AI Worker] Background task worker started as ${consumerName}`);

  // 2. Start consumer group loop
  (async () => {
    while (isRunning) {
      try {
        // Read 1 task from stream, block up to 2 seconds
        const result = (await redis.xreadgroup(
          "GROUP", groupName, consumerName,
          "COUNT", "1",
          "BLOCK", "2000",
          "STREAMS", "ai:tasks:stream", ">"
        )) as any;

        if (!result) continue;

        const [_, messages] = result[0];
        const [msgId, fields] = messages[0];
        const payload = JSON.parse(fields[1]);
        const { taskId, userId, mode, diaryId, question, workspaceId } = payload;

        console.log(`🤖 [AI Worker] Processing task ${taskId} (mode: ${mode})`);

        try {
          const db = getDb();
          ensureSuUser(db);

          // 1. Gather context
          let context = "";
          if (mode === "post") {
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

            let projects: { name: string; description: string }[] = [];
            try {
              projects = db.prepare(`
                SELECT p.name, p.description FROM projects p
                LEFT JOIN project_members pm ON pm.projectId = p.id
                WHERE (p.ownerId = ? OR pm.userId = ?) AND p.isArchived = 0
                ORDER BY p.updatedAt DESC LIMIT 10
              `).all(userId, userId) as any[];
            } catch {}

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
            // mode === "comment"
            const diaryRow = db.prepare("SELECT contentText FROM diaries WHERE id = ?").get(diaryId) as { contentText: string } | undefined;
            if (!diaryRow) throw new Error("说说不存在");

            const comments = db.prepare(`
              SELECT dc.content, COALESCE(u.displayName, u.username) AS username
              FROM diary_comments dc
              JOIN users u ON u.id = dc.userId
              WHERE dc.diaryId = ? ORDER BY dc.createdAt ASC LIMIT 20
            `).all(diaryId) as { content: string; username: string }[];

            const commentText = comments.map(c => `@${c.username}: ${c.content}`).join("\n");
            context = `【说说原文】\n${diaryRow.contentText}\n\n【已有评论】\n${commentText || "暂无评论"}`;
          }

          // 2. Call LLM
          const systemPrompt = mode === "post"
            ? `你是一位知识渊博的专家助手，基于用户的笔记、说说和项目信息回答问题。请给出简明扼要、专业的回答，不要超过 500 字。直接回答用户问题，不要添加无关信息。`
            : `你是一位专业分析助手，基于当前说说及其评论内容回答问题。请给出简明扼要、有洞察力的分析。不要超过 500 字。`;

          const answer = await callLLM(systemPrompt, question, context);

          // 3. Write data & notify
          let resultData: any;
          if (mode === "post") {
            const newDiaryId = crypto.randomUUID();
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);

            db.prepare(`
              INSERT INTO diaries (id, userId, workspaceId, contentText, mood, images, visibility, voice, createdAt, trigger_user_id)
              VALUES (?, ?, ?, ?, '', '[]', 'PUBLIC', NULL, ?, ?)
            `).run(newDiaryId, SU_USER_ID, workspaceId === "personal" ? null : workspaceId, answer, now, userId);

            const created = db.prepare(`
              SELECT d.*, COALESCE(u.displayName, u.username) AS creatorName, u.avatarUrl AS creatorAvatarUrl
              FROM diaries d
              JOIN users u ON u.id = d.userId
              WHERE d.id = ?
            `).get(newDiaryId) as any;

            sendAiNotification(db, userId, newDiaryId, answer, "post");
            resultData = { mode: "post", diary: rowToDiary(created) };
          } else {
            const commentId = crypto.randomUUID();
            db.prepare(`
              INSERT INTO diary_comments (id, diaryId, userId, content, createdAt, updatedAt, trigger_user_id)
              VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)
            `).run(commentId, diaryId, SU_USER_ID, answer.trim(), userId);

            const newComment = db.prepare(`
              SELECT dc.*, COALESCE(u.displayName, u.username) AS username, u.avatarUrl
              FROM diary_comments dc
              JOIN users u ON u.id = dc.userId
              WHERE dc.id = ?
            `).get(commentId);

            sendAiNotification(db, userId, diaryId, answer, "comment");
            resultData = { mode: "comment", comment: newComment };
          }

          // 4. Acknowledge Stream task
          await redis.xack("ai:tasks:stream", groupName, msgId);

          // 5. Publish completion message
          await redis.publish(`ai:task:complete:${taskId}`, JSON.stringify({
            status: "completed",
            result: resultData
          }));

        } catch (err: any) {
          console.error(`❌ [AI Worker] Task ${taskId} failed:`, err);
          // Acknowledge task to prevent infinite loop poisoning
          await redis.xack("ai:tasks:stream", groupName, msgId);

          // Publish failure message
          await redis.publish(`ai:task:complete:${taskId}`, JSON.stringify({
            status: "failed",
            error: err.message || "AI 处理失败"
          }));
        }

      } catch (err) {
        console.error("❌ [AI Worker] loop error:", err);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  })();
}

export function stopAiTaskWorker() {
  isRunning = false;
}
