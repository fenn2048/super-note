package com.ark.note;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import me.leolin.shortcutbadger.ShortcutBadger;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class KeepAliveService extends Service {
    private static final String CHANNEL_ID = "KeepAliveServiceChannel";
    private static final int NOTIFICATION_ID = 8888;
    private PowerManager.WakeLock wakeLock = null;

    private Thread pollingThread = null;
    private boolean isRunning = false;
    private int lastUnreadCount = -1;
    private java.util.Set<String> displayedNotificationIds = new java.util.HashSet<>();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Super Note 正在运行")
                .setContentText("保持同步服务连接活跃中...")
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Acquire wake lock to keep CPU running in background
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SuperNote::KeepAliveWakeLock");
            wakeLock.acquire();
        }

        startPolling();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopPolling();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "KeepAlive Service Channel",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }

    // --- Background Polling Thread ---
    private synchronized void startPolling() {
        if (pollingThread != null) {
            return;
        }
        isRunning = true;
        pollingThread = new Thread(new Runnable() {
            @Override
            public void run() {
                while (isRunning) {
                    try {
                        pollOnce();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    try {
                        Thread.sleep(15000); // Poll every 15 seconds
                    } catch (InterruptedException e) {
                        break;
                    }
                }
            }
        });
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
        SharedPreferences sharedPref = getSharedPreferences("SuperNotePrefs", Context.MODE_PRIVATE);
        String serverUrl = sharedPref.getString("serverUrl", "");
        String token = sharedPref.getString("token", "");
        String userId = sharedPref.getString("userId", "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            return;
        }

        String baseUrl = serverUrl.replaceAll("/+$", "");
        String unreadUrl = baseUrl + "/api/notifications/unread-count";
        String unreadResp = makeHttpRequest(unreadUrl, token, userId);

        if (unreadResp == null) {
            return;
        }

        try {
            org.json.JSONObject json = new org.json.JSONObject(unreadResp);
            int count = json.getInt("count");

            // Apply badge count using ShortcutBadger
            try {
                me.leolin.shortcutbadger.ShortcutBadger.applyCount(getApplicationContext(), count);
            } catch (Exception e) {
                e.printStackTrace();
            }

            // Check if unread count increased to trigger heads-up alert
            if (lastUnreadCount != -1 && count > lastUnreadCount) {
                fetchAndShowNewNotifications(baseUrl, token, userId);
            } else if (lastUnreadCount == -1) {
                // First initialization run: load currently unread notification ids to avoid spamming alerts on startup
                initializeAlreadyUnreadIds(baseUrl, token, userId);
            }

            lastUnreadCount = count;
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void initializeAlreadyUnreadIds(String baseUrl, String token, String userId) {
        String listUrl = baseUrl + "/api/notifications?limit=20";
        String listResp = makeHttpRequest(listUrl, token, userId);
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
            e.printStackTrace();
        }
    }

    private void fetchAndShowNewNotifications(String baseUrl, String token, String userId) {
        String listUrl = baseUrl + "/api/notifications?limit=5";
        String listResp = makeHttpRequest(listUrl, token, userId);
        if (listResp == null) return;
        try {
            org.json.JSONObject json = new org.json.JSONObject(listResp);
            org.json.JSONArray items = json.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                org.json.JSONObject item = items.getJSONObject(i);
                String id = item.getString("id");
                String readAt = item.optString("readAt", "");
                if (readAt == null || readAt.isEmpty() || "null".equals(readAt)) {
                    if (!displayedNotificationIds.contains(id)) {
                        displayedNotificationIds.add(id);
                        String actorName = item.optString("actorName", "");
                        String label = item.optString("label", "新通知");
                        String sourceTitle = item.optString("sourceTitle", "");
                        
                        String title = actorName.isEmpty() ? "Super Note 提醒" : (actorName + " " + label);
                        String text = sourceTitle;
                        if (text == null || text.isEmpty()) {
                            text = "有一条新的未读消息";
                        }
                        showSystemNotification(id, title, text);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
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

            int responseCode = conn.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
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
            e.printStackTrace();
        } finally {
            if (reader != null) {
                try { reader.close(); } catch (Exception e) {}
            }
            if (conn != null) {
                conn.disconnect();
            }
        }
        return null;
    }

    private void showSystemNotification(String id, String title, String text) {
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) return;

        String notifyChannelId = "SuperNoteAlertChannel";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    notifyChannelId,
                    "通知提醒",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.enableLights(true);
            channel.enableVibration(true);
            notificationManager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, notifyChannelId)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        notificationManager.notify(id.hashCode(), builder.build());
    }
}
