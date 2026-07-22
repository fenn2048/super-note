package com.ark.note;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * 蜉蝣 Android 通知渠道（与前端 LocalNotifications.channelId 对齐）
 */
public final class NotificationChannels {
    /** 后台同步前台服务（低优先级、无声） */
    public static final String SYNC = "fuyou_sync";
    /** 协作消息 / 提及 */
    public static final String MESSAGES = "fuyou_messages";
    /** 任务截止 / 提醒 */
    public static final String TASKS = "fuyou_tasks";
    /** 媒体播放（预留） */
    public static final String MEDIA = "fuyou_media";

    private NotificationChannels() {}

    public static void ensureAll(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context == null) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        create(nm, SYNC, "后台同步", "后台消息轮询与同步状态（常驻通知）",
                NotificationManager.IMPORTANCE_LOW, false, false);
        create(nm, MESSAGES, "消息与提及", "家庭协作消息、@提及等",
                NotificationManager.IMPORTANCE_HIGH, true, true);
        create(nm, TASKS, "任务提醒", "任务截止与提醒时间到点通知",
                NotificationManager.IMPORTANCE_HIGH, true, true);
        // 媒体通道：锁屏可见 + 默认优先级，便于系统 MediaStyle 控件展示。
        // 若旧版以 IMPORTANCE_LOW 建过同 id，系统不会更新属性 → 先删再建。
        try {
            nm.deleteNotificationChannel(MEDIA);
        } catch (Exception ignored) {
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel media = new NotificationChannel(
                    MEDIA, "媒体播放", NotificationManager.IMPORTANCE_DEFAULT);
            media.setDescription("音频播放与锁屏/通知栏媒体控件");
            media.enableLights(false);
            media.enableVibration(false);
            media.setShowBadge(false);
            media.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            media.setSound(null, null);
            nm.createNotificationChannel(media);
        }

        // 删除旧版粗粒度渠道（若存在），避免设置页里两套名字
        try {
            nm.deleteNotificationChannel("KeepAliveServiceChannel");
            nm.deleteNotificationChannel("SuperNoteAlertChannel");
        } catch (Exception ignored) {
        }
    }

    private static void create(
            NotificationManager nm,
            String id,
            String name,
            String description,
            int importance,
            boolean lights,
            boolean vibration
    ) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(description);
        ch.enableLights(lights);
        ch.enableVibration(vibration);
        if (importance <= NotificationManager.IMPORTANCE_LOW) {
            ch.setShowBadge(false);
        }
        nm.createNotificationChannel(ch);
    }
}
