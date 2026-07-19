package com.ark.note;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 音频播放前台服务（mediaPlayback）。
 * 系统通知栏提供 上一曲 / 播放暂停 / 下一曲；Web 侧 HTMLAudio 仍负责实际解码。
 */
public class MediaPlaybackService extends Service {
    private static final String TAG = "MediaPlaybackService";
    public static final int NOTIFICATION_ID = 8890;

    public static final String ACTION_START = "com.ark.note.media.START";
    public static final String ACTION_UPDATE = "com.ark.note.media.UPDATE";
    public static final String ACTION_STOP = "com.ark.note.media.STOP";
    public static final String ACTION_PLAY = "com.ark.note.media.PLAY";
    public static final String ACTION_PAUSE = "com.ark.note.media.PAUSE";
    public static final String ACTION_NEXT = "com.ark.note.media.NEXT";
    public static final String ACTION_PREV = "com.ark.note.media.PREV";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";

    private String title = "蜉蝣 · 正在播放";
    private String artist = "";
    private boolean playing = true;

    public static void startOrUpdate(Context ctx, String title, String artist, boolean playing) {
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_TITLE, title != null ? title : "未知曲目");
        i.putExtra(EXTRA_ARTIST, artist != null ? artist : "");
        i.putExtra(EXTRA_PLAYING, playing);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannels.ensureAll(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (action == null) action = ACTION_START;

        switch (action) {
            case ACTION_STOP:
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            case ACTION_PLAY:
                playing = true;
                MediaPlaybackPlugin.emitAction("play");
                break;
            case ACTION_PAUSE:
                playing = false;
                MediaPlaybackPlugin.emitAction("pause");
                break;
            case ACTION_NEXT:
                MediaPlaybackPlugin.emitAction("next");
                break;
            case ACTION_PREV:
                MediaPlaybackPlugin.emitAction("prev");
                break;
            case ACTION_UPDATE:
            case ACTION_START:
            default:
                if (intent.hasExtra(EXTRA_TITLE)) {
                    title = intent.getStringExtra(EXTRA_TITLE);
                }
                if (intent.hasExtra(EXTRA_ARTIST)) {
                    artist = intent.getStringExtra(EXTRA_ARTIST);
                }
                if (intent.hasExtra(EXTRA_PLAYING)) {
                    playing = intent.getBooleanExtra(EXTRA_PLAYING, true);
                }
                break;
        }

        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        n,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent prevPi = actionPi(ACTION_PREV, 1);
        PendingIntent playPausePi = actionPi(playing ? ACTION_PAUSE : ACTION_PLAY, 2);
        PendingIntent nextPi = actionPi(ACTION_NEXT, 3);
        PendingIntent stopPi = actionPi(ACTION_STOP, 4);

        String body = artist != null && !artist.isEmpty() ? artist : "音频播放中";
        int playIcon = playing
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;

        return new NotificationCompat.Builder(this, NotificationChannels.MEDIA)
                .setContentTitle(title != null ? title : "蜉蝣 · 正在播放")
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentPi)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_previous, "上一曲", prevPi)
                .addAction(playIcon, playing ? "暂停" : "播放", playPausePi)
                .addAction(android.R.drawable.ic_media_next, "下一曲", nextPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止", stopPi)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .build();
    }

    private PendingIntent actionPi(String action, int req) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(
                this,
                req,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
