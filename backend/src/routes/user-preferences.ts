/**
 * 用户偏好跨设备同步（P2 增强）
 * ---------------------------------------------------------------------------
 * GET/PUT /api/users/me/preferences
 * body: partial JSON 合并写入 user_preferences.prefsJson
 */
import { Hono } from "hono";
import { getDb } from "../db/schema";

const prefsRouter = new Hono();

const ALLOWED_KEYS = new Set([
  "startupLanding",
  "modulePack",
  "noteListDensity",
  "readingDensity",
  "noteTitleAsAppTitle",
  "outlineDefaultOpen",
  "lockOnOpen",
  "healthReminderEnabled",
  "reminderInterval",
  /** 退后台超过该分钟数再回前台：触发闪屏 + 指纹锁（默认 5） */
  "backgroundResumeMinutes",
]);

function parseJson(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

prefsRouter.get("/me/preferences", (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const db = getDb();
  const row = db
    .prepare("SELECT prefsJson, updatedAt FROM user_preferences WHERE userId = ?")
    .get(userId) as { prefsJson: string; updatedAt: string } | undefined;
  return c.json({
    prefs: parseJson(row?.prefsJson),
    updatedAt: row?.updatedAt ?? null,
  });
});

prefsRouter.put("/me/preferences", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch = sanitize(body);
  const db = getDb();
  const existing = db
    .prepare("SELECT prefsJson FROM user_preferences WHERE userId = ?")
    .get(userId) as { prefsJson: string } | undefined;
  const merged = { ...parseJson(existing?.prefsJson), ...patch };
  const json = JSON.stringify(merged);
  db.prepare(
    `INSERT INTO user_preferences (userId, prefsJson, updatedAt)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(userId) DO UPDATE SET
       prefsJson = excluded.prefsJson,
       updatedAt = datetime('now')`,
  ).run(userId, json);
  return c.json({ prefs: merged, updatedAt: new Date().toISOString() });
});

export default prefsRouter;
