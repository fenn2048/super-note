package com.ark.note;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 可选后台消息轮询（前台服务）。
 * 默认不启动；由用户在设置中开启「后台消息提醒」后才运行。
 */
public class KeepAliveService extends Service {
    private static final String TAG = "KeepAliveService";
    public static final String PREFS = "SuperNotePrefs";
    public static final String PREF_ENABLED = "backgroundKeepAliveEnabled";
    private static final int NOTIFICATION_ID = 8888;
    /** 轮询间隔：60s（原 15s 过重） */
    private static final long POLL_INTERVAL_MS = 60_000L;

    private PowerManager.WakeLock wakeLock = null;
    private Thread pollingThread = null;
    private volatile boolean isRunning = false;
    private int lastUnreadCount = -1;
    private final java.util.Set<String> displayedNotificationIds = new java.util.HashSet<>();

    public static boolean isEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(PREF_ENABLED, false);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_ENABLED, enabled)
                .apply();
    }

    public static void startIfEnabled(Context ctx) {
        if (!isEnabled(ctx)) return;
        Intent i = new Intent(ctx, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannels.ensureAll(this);

        if (!isEnabled(this)) {
            Log.i(TAG, "disabled — stopSelf");
            stopSelf();
            return;
        }

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Notification notification = new NotificationCompat.Builder(this, NotificationChannels.SYNC)
                .setContentTitle("蜉蝣 · 后台消息")
                .setContentText("正在轮询未读消息（可在设置中关闭）")
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        startPolling();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopPolling();
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLockBriefly() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Fuyou::KeepAlivePoll");
                wakeLock.setReferenceCounted(false);
            }
            // 仅在轮询期间短暂持锁，避免永久占 CPU
            if (!wakeLock.isHeld()) {
                wakeLock.acquire(30_000L);
            }
        } catch (Exception e) {
            Log.w(TAG, "wakeLock acquire failed", e);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private synchronized void startPolling() {
        if (pollingThread != null) return;
        isRunning = true;
        pollingThread = new Thread(() -> {
            while (isRunning) {
                try {
                    acquireWakeLockBriefly();
                    pollOnce();
                } catch (Exception e) {
                    Log.e(TAG, "poll error", e);
                } finally {
                    releaseWakeLock();
                }
                try {
                    Thread.sleep(POLL_INTERVAL_MS);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "FuyouKeepAlivePoll");
        pollingThread.start();
    }

    private synchronized void stopPolling() {
        isRunning = false;
        if (pollingThread != null) {
            pollingThread.interrupt();
            pollingThread = null;
        }
    }

    private void pollOnce() {
        SharedPreferences sharedPref = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String serverUrl = sharedPref.getString("serverUrl", "");
        String token = sharedPref.getString("token", "");
        String userId = sharedPref.getString("userId", "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            return;
        }

        String baseUrl = serverUrl.replaceAll("/+$", "");
        String unreadResp = makeHttpRequest(baseUrl + "/api/notifications/unread-count", token, userId);
        if (unreadResp == null) return;

        try {
            org.json.JSONObject json = new org.json.JSONObject(unreadResp);
            int count = json.getInt("count");

            try {
                me.leolin.shortcutbadger.ShortcutBadger.applyCount(getApplicationContext(), count);
            } catch (Exception ignored) {
            }

            if (lastUnreadCount != -1 && count > lastUnreadCount) {
                fetchAndShowNewNotifications(baseUrl, token, userId);
            } else if (lastUnreadCount == -1) {
                initializeAlreadyUnreadIds(baseUrl, token, userId);
            }
            lastUnreadCount = count;
        } catch (Exception e) {
            Log.e(TAG, "parse unread", e);
        }
    }

    private void initializeAlreadyUnreadIds(String baseUrl, String token, String userId) {
        String listResp = makeHttpRequest(baseUrl + "/api/notifications?limit=20", token, userId);
        if (listResp == null) return;
        try {
            org.json.JSONObject json = new org.json.JSONObject(listResp);
            org.json.JSONArray items = json.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                org.json.JSONObject item = items.getJSONObject(i);
                String id = item.getString("id");
                String readAt = item.optString("readAt", "");
                if (readAt == null || readAt.isEmpty() || "null".equals(readAt)) {
                    displayedNotificationIds.add(id);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "init unread ids", e);
        }
    }

    private void fetchAndShowNewNotifications(String baseUrl, String token, String userId) {
        String listResp = makeHttpRequest(baseUrl + "/api/notifications?limit=5", token, userId);
        if (listResp == null) return;
        try {
            org.json.JSONObject json = new org.json.JSONObject(listResp);
            org.json.JSONArray items = json.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                org.json.JSONObject item = items.getJSONObject(i);
                String id = item.getString("id");
                String readAt = item.optString("readAt", "");
                if (readAt != null && !readAt.isEmpty() && !"null".equals(readAt)) continue;
                if (displayedNotificationIds.contains(id)) continue;
                displayedNotificationIds.add(id);

                String actorName = item.optString("actorName", "");
                String label = item.optString("label", "新通知");
                String sourceTitle = item.optString("sourceTitle", "");
                String title = actorName.isEmpty() ? "蜉蝣 · 消息" : (actorName + " " + label);
                String text = (sourceTitle == null || sourceTitle.isEmpty())
                        ? "有一条新的未读消息"
                        : sourceTitle;
                showMessageNotification(id, title, text);
            }
        } catch (Exception e) {
            Log.e(TAG, "fetch notifications", e);
        }
    }

    private String makeHttpRequest(String urlStr, String token, String userId) {
        HttpURLConnection conn = null;
        BufferedReader reader = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            if (userId != null && !userId.isEmpty()) {
                conn.setRequestProperty("X-User-Id", userId);
            }
            conn.connect();
            if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                InputStream in = conn.getInputStream();
                reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                return response.toString();
            }
        } catch (Exception e) {
            Log.w(TAG, "http " + urlStr, e);
        } finally {
            if (reader != null) {
                try {
                    reader.close();
                } catch (Exception ignored) {
                }
            }
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void showMessageNotification(String id, String title, String text) {
        android.app.NotificationManager notificationManager =
                (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) return;

        NotificationChannels.ensureAll(this);

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("navigateSourceType", "mention");
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(this, NotificationChannels.MESSAGES)
                        .setContentTitle(title)
                        .setContentText(text)
                        .setSmallIcon(android.R.drawable.ic_dialog_info)
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                        .setDefaults(Notification.DEFAULT_ALL)
                        .setAutoCancel(true)
                        .setContentIntent(pendingIntent);

        notificationManager.notify(id.hashCode(), builder.build());
    }
}
