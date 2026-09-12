package com.ark.note;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 原生任务提醒同步：不依赖 WebView / WebSocket。
 * WorkManager 定期拉取任务，到期立刻弹通知；未到期的用 AlarmManager 精确闹钟。
 */
public final class TaskReminderSync {
    private static final String TAG = "TaskReminderSync";
    static final String ACTION_FIRE = "com.ark.note.action.TASK_REMINDER_FIRE";
    static final String EXTRA_TASK_ID = "taskId";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_NOTIF_ID = "notifId";

    private static final long GRACE_MS = 36L * 60 * 60 * 1000;
    private static final long SCHEDULE_HORIZON_MS = 48L * 60 * 60 * 1000;
    private static final Pattern DATE_ONLY = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})$");
    private static final Pattern LOCAL_DT =
            Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?");

    private TaskReminderSync() {}

    public static void run(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString("serverUrl", "");
        String token = prefs.getString("token", "");
        String userId = prefs.getString("userId", "");
        String workspaceId = prefs.getString("workspaceId", "");
        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            Log.i(TAG, "skip: no auth");
            return;
        }

        String base = serverUrl.replaceAll("/+$", "");
        String qs = "";
        if (workspaceId != null && !workspaceId.isEmpty() && !"personal".equals(workspaceId)) {
            qs = "?workspaceId=" + urlEncode(workspaceId);
        }

        String tasksJson = httpGet(base + "/api/tasks" + qs, token, userId);
        if (tasksJson != null) {
            syncTasks(ctx, tasksJson);
        }
        pollNotifications(ctx, base, token, userId);
    }

    static void fireFromAlarm(Context ctx, Intent intent) {
        if (intent == null) return;
        String taskId = intent.getStringExtra(EXTRA_TASK_ID);
        String kind = intent.getStringExtra(EXTRA_KIND);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        int notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 0);
        if (title == null || body == null || notifId == 0) return;
        if (wasFired(ctx, taskId, kind)) return;
        showTaskNotification(ctx, notifId, title, body, taskId);
        markFired(ctx, taskId, kind);
    }

    private static void syncTasks(Context ctx, String tasksJson) {
        try {
            JSONArray arr = parseTaskArray(tasksJson);
            if (arr == null) return;
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject t = arr.optJSONObject(i);
                if (t == null) continue;
                if (isCompleted(t)) continue;
                String id = t.optString("id", "");
                String title = t.optString("title", "待办");
                if (id.isEmpty()) continue;

                String remindAt = emptyToNull(t.optString("remindAt", null));
                String due = emptyToNull(t.optString("endDate", null));
                if (due == null) due = emptyToNull(t.optString("dueDate", null));

                long advMs = parseFireAtMs(remindAt);
                long dueMs = parseFireAtMs(due);
                boolean sameMinute = advMs > 0 && dueMs > 0 && Math.abs(advMs - dueMs) < 60_000L;

                if (advMs > 0) {
                    handleSlot(ctx, id, "advance", "任务提醒", title, advMs, now, hashId(id));
                }
                if (dueMs > 0 && !sameMinute) {
                    handleSlot(ctx, id, "due", "截止提醒", "【今天截止】" + title, dueMs, now, hashId(id + "#due"));
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "syncTasks", e);
        }
    }

    private static void handleSlot(
            Context ctx,
            String taskId,
            String kind,
            String notifTitle,
            String notifBody,
            long fireAt,
            long now,
            int notifId
    ) {
        if (wasFired(ctx, taskId, kind)) return;
        if (fireAt <= now) {
            if (now - fireAt <= GRACE_MS) {
                showTaskNotification(ctx, notifId, notifTitle, notifBody, taskId);
                markFired(ctx, taskId, kind);
            }
            return;
        }
        if (fireAt - now > SCHEDULE_HORIZON_MS) return;
        scheduleAlarm(ctx, taskId, kind, notifTitle, notifBody, fireAt, notifId);
    }

    private static void scheduleAlarm(
            Context ctx,
            String taskId,
            String kind,
            String title,
            String body,
            long fireAt,
            int notifId
    ) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, TaskReminderAlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra(EXTRA_TASK_ID, taskId);
        i.putExtra(EXTRA_KIND, kind);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_BODY, body);
        i.putExtra(EXTRA_NOTIF_ID, notifId);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx,
                notifId,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, fireAt, pi);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "exact alarm denied, fallback set()", e);
            am.set(AlarmManager.RTC_WAKEUP, fireAt, pi);
        }
    }

    static void showTaskNotification(Context ctx, int notifId, String title, String body, String taskId) {
        NotificationChannels.ensureAll(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("navigateSourceType", "task");
        open.putExtra("navigateSourceId", taskId != null ? taskId : "");
        PendingIntent pi = PendingIntent.getActivity(
                ctx,
                notifId,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        Notification n = new NotificationCompat.Builder(ctx, NotificationChannels.TASKS)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setNumber(1)
                .build();
        try {
            NotificationManagerCompat.from(ctx).notify(notifId, n);
        } catch (SecurityException e) {
            Log.w(TAG, "notify denied", e);
        }
        bumpBadge(ctx);
    }

    private static void pollNotifications(Context ctx, String base, String token, String userId) {
        String unreadResp = httpGet(base + "/api/notifications/unread-count", token, userId);
        if (unreadResp == null) return;
        try {
            int count = new JSONObject(unreadResp).optInt("count", 0);
            try {
                me.leolin.shortcutbadger.ShortcutBadger.applyCount(ctx.getApplicationContext(), count);
            } catch (Exception ignored) {
            }
            SharedPreferences prefs = ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE);
            int last = prefs.getInt("lastUnreadForWorker", -1);
            if (last != -1 && count > last) {
                showNewInboxItems(ctx, base, token, userId);
            } else if (last == -1) {
                rememberExistingUnread(ctx, base, token, userId);
            }
            prefs.edit().putInt("lastUnreadForWorker", count).apply();
        } catch (Exception e) {
            Log.w(TAG, "pollNotifications", e);
        }
    }

    private static void rememberExistingUnread(Context ctx, String base, String token, String userId) {
        String list = httpGet(base + "/api/notifications?limit=20", token, userId);
        if (list == null) return;
        try {
            JSONArray items = new JSONObject(list).optJSONArray("items");
            if (items == null) return;
            Set<String> shown = new HashSet<>(shownIds(ctx));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                if (isRead(item)) continue;
                shown.add(item.optString("id", ""));
            }
            saveShownIds(ctx, shown);
        } catch (Exception e) {
            Log.w(TAG, "remember unread", e);
        }
    }

    private static void showNewInboxItems(Context ctx, String base, String token, String userId) {
        String list = httpGet(base + "/api/notifications?limit=8", token, userId);
        if (list == null) return;
        try {
            JSONArray items = new JSONObject(list).optJSONArray("items");
            if (items == null) return;
            Set<String> shown = new HashSet<>(shownIds(ctx));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                if (id.isEmpty() || isRead(item) || shown.contains(id)) continue;
                shown.add(id);
                String type = item.optString("type", "");
                String actor = item.optString("actorName", "");
                String sourceTitle = item.optString("sourceTitle", "");
                String sourceId = item.optString("sourceId", "");
                boolean isTask = "task_reminder".equals(type) || "task".equals(item.optString("sourceType", ""));
                String title;
                if ("task_reminder".equals(type)) {
                    boolean due = "截止提醒".equals(actor) || sourceTitle.startsWith("【今天截止】");
                    title = due ? "截止提醒" : "任务提醒";
                } else {
                    title = actor.isEmpty() ? "蜉蝣 · 消息" : actor;
                }
                String body = sourceTitle.isEmpty() ? "有一条新提醒" : sourceTitle;
                int nid = hashId("inbox:" + id);
                if (isTask) {
                    showTaskNotification(ctx, nid, title, body, sourceId);
                } else {
                    showMessageNotification(ctx, nid, title, body);
                }
            }
            saveShownIds(ctx, shown);
        } catch (Exception e) {
            Log.w(TAG, "showNewInboxItems", e);
        }
    }

    private static void showMessageNotification(Context ctx, int notifId, String title, String body) {
        NotificationChannels.ensureAll(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx,
                notifId,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        Notification n = new NotificationCompat.Builder(ctx, NotificationChannels.MESSAGES)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        try {
            NotificationManagerCompat.from(ctx).notify(notifId, n);
        } catch (SecurityException e) {
            Log.w(TAG, "notify denied", e);
        }
        bumpBadge(ctx);
    }

    private static void bumpBadge(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE);
            int last = prefs.getInt("lastUnreadForWorker", 0);
            me.leolin.shortcutbadger.ShortcutBadger.applyCount(ctx.getApplicationContext(), Math.max(1, last + 1));
        } catch (Exception ignored) {
        }
    }

    static int hashId(String str) {
        int hash = 0;
        for (int i = 0; i < str.length(); i++) {
            hash = (hash << 5) - hash + str.charAt(i);
        }
        return Math.abs(hash);
    }

    /** 与前端 parseRemindAtToLocalDate 对齐 */
    static long parseFireAtMs(String raw) {
        if (raw == null) return 0;
        String s = raw.trim();
        if (s.isEmpty()) return 0;
        try {
            Matcher dateOnly = DATE_ONLY.matcher(s);
            if (dateOnly.matches()) {
                Calendar c = Calendar.getInstance();
                c.set(
                        Integer.parseInt(dateOnly.group(1)),
                        Integer.parseInt(dateOnly.group(2)) - 1,
                        Integer.parseInt(dateOnly.group(3)),
                        9, 0, 0
                );
                c.set(Calendar.MILLISECOND, 0);
                return c.getTimeInMillis();
            }
            boolean hasTz = s.endsWith("Z") || s.matches(".*[+-]\\d{2}:?\\d{2}$");
            Matcher local = LOCAL_DT.matcher(s);
            if (local.find() && !hasTz) {
                Calendar c = Calendar.getInstance();
                c.set(
                        Integer.parseInt(local.group(1)),
                        Integer.parseInt(local.group(2)) - 1,
                        Integer.parseInt(local.group(3)),
                        Integer.parseInt(local.group(4)),
                        Integer.parseInt(local.group(5)),
                        local.group(6) != null ? Integer.parseInt(local.group(6)) : 0
                );
                c.set(Calendar.MILLISECOND, 0);
                return c.getTimeInMillis();
            }
            String iso = s.replace(' ', 'T');
            SimpleDateFormat fmt;
            if (iso.endsWith("Z")) {
                if (iso.contains(".")) {
                    fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                } else {
                    fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                }
                fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                return fmt.parse(iso).getTime();
            }
            fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            return fmt.parse(iso).getTime();
        } catch (Exception e) {
            Log.w(TAG, "parseFireAtMs " + raw, e);
            return 0;
        }
    }

    private static JSONArray parseTaskArray(String json) {
        try {
            String t = json.trim();
            if (t.startsWith("[")) return new JSONArray(t);
            JSONObject o = new JSONObject(t);
            if (o.has("items")) return o.getJSONArray("items");
            if (o.has("tasks")) return o.getJSONArray("tasks");
        } catch (Exception e) {
            Log.w(TAG, "parseTaskArray", e);
        }
        return null;
    }

    private static boolean isCompleted(JSONObject t) {
        Object v = t.opt("isCompleted");
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof Number) return ((Number) v).intValue() != 0;
        String status = t.optString("status", "");
        return "completed".equals(status);
    }

    private static boolean isRead(JSONObject item) {
        String readAt = item.optString("readAt", "");
        return readAt != null && !readAt.isEmpty() && !"null".equals(readAt);
    }

    private static String emptyToNull(String s) {
        if (s == null || s.isEmpty() || "null".equals(s)) return null;
        return s;
    }

    private static boolean wasFired(Context ctx, String taskId, String kind) {
        return firedSet(ctx).contains(key(taskId, kind));
    }

    private static void markFired(Context ctx, String taskId, String kind) {
        Set<String> set = new HashSet<>(firedSet(ctx));
        set.add(key(taskId, kind));
        ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putStringSet("task_reminder_fired", set)
                .apply();
    }

    private static Set<String> firedSet(Context ctx) {
        Set<String> s = ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE)
                .getStringSet("task_reminder_fired", null);
        return s != null ? s : new HashSet<String>();
    }

    private static Set<String> shownIds(Context ctx) {
        Set<String> s = ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE)
                .getStringSet("shown_notif_ids", null);
        return s != null ? s : new HashSet<String>();
    }

    private static void saveShownIds(Context ctx, Set<String> ids) {
        ctx.getSharedPreferences(KeepAliveService.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putStringSet("shown_notif_ids", ids)
                .apply();
    }

    private static String key(String taskId, String kind) {
        return (taskId != null ? taskId : "") + ":" + (kind != null ? kind : "");
    }

    private static String urlEncode(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    static String httpGet(String urlStr, String token, String userId) {
        HttpURLConnection conn = null;
        BufferedReader reader = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(12000);
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            if (userId != null && !userId.isEmpty()) {
                conn.setRequestProperty("X-User-Id", userId);
            }
            conn.connect();
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "http " + urlStr, e);
            return null;
        } finally {
            if (reader != null) {
                try { reader.close(); } catch (Exception ignored) {}
            }
            if (conn != null) conn.disconnect();
        }
    }
}
