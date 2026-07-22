package com.ark.note;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/**
 * 音频播放前台服务（mediaPlayback）。
 * 使用 MediaSession + MediaStyle 通知，使系统锁屏 / 通知栏 / 蓝牙耳机
 * 出现类似 iOS remote control 的媒体控件。
 * Web 侧 HTMLAudio 仍负责实际解码；本服务只负责 FGS 与系统媒体会话。
 * 进度：Web 上报 position/duration（毫秒），写入 PlaybackState，锁屏进度条可更新。
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
    /** 仅刷新进度，不重建整套通知元数据文案 */
    public static final String ACTION_POSITION = "com.ark.note.media.POSITION";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_DURATION_MS = "durationMs";

    private static final long MEDIA_ACTIONS =
            PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_STOP
                    | PlaybackStateCompat.ACTION_SEEK_TO;

    private MediaSessionCompat mediaSession;
    private String title = "蜉蝣 · 正在播放";
    private String artist = "";
    private boolean playing = true;
    private long positionMs = 0L;
    private long durationMs = 0L;

    /** 供 MainActivity 判断是否应保持 WebView 媒体管线 */
    private static volatile boolean sActive = false;
    private static volatile boolean sPlaying = false;
    /** 运行中实例：进度更新走实例，避免频繁 startForegroundService */
    private static volatile MediaPlaybackService sInstance = null;

    public static boolean isActive() {
        return sActive;
    }

    public static boolean isPlaybackActive() {
        return sActive && sPlaying;
    }

    public static void startOrUpdate(
            Context ctx,
            String title,
            String artist,
            boolean playing,
            long positionMs,
            long durationMs
    ) {
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_TITLE, title != null ? title : "未知曲目");
        i.putExtra(EXTRA_ARTIST, artist != null ? artist : "");
        i.putExtra(EXTRA_PLAYING, playing);
        i.putExtra(EXTRA_POSITION_MS, Math.max(0L, positionMs));
        i.putExtra(EXTRA_DURATION_MS, Math.max(0L, durationMs));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    /**
     * 轻量进度刷新：服务已在跑则直接写 MediaSession；否则忽略（等下次 update 启动）。
     */
    public static void updatePosition(Context ctx, long positionMs, long durationMs, boolean playing) {
        MediaPlaybackService inst = sInstance;
        if (inst != null) {
            inst.applyPosition(Math.max(0L, positionMs), Math.max(0L, durationMs), playing);
            return;
        }
        // 服务未起时用 START 带进度拉起
        startOrUpdate(ctx, "蜉蝣 · 正在播放", "", playing, positionMs, durationMs);
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sActive = true;
        sInstance = this;
        NotificationChannels.ensureAll(this);
        initMediaSession();
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "SuperNoteMedia");
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                playing = true;
                sPlaying = true;
                MediaPlaybackPlugin.emitAction("play");
                refreshSessionAndNotification();
            }

            @Override
            public void onPause() {
                playing = false;
                sPlaying = false;
                MediaPlaybackPlugin.emitAction("pause");
                refreshSessionAndNotification();
            }

            @Override
            public void onSkipToNext() {
                MediaPlaybackPlugin.emitAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                MediaPlaybackPlugin.emitAction("prev");
            }

            @Override
            public void onStop() {
                MediaPlaybackPlugin.emitAction("stop");
                releaseAndStop();
            }

            @Override
            public void onSeekTo(long pos) {
                positionMs = Math.max(0L, pos);
                if (durationMs > 0 && positionMs > durationMs) {
                    positionMs = durationMs;
                }
                MediaPlaybackPlugin.emitSeek(positionMs / 1000.0);
                updatePlaybackState();
            }
        });
        mediaSession.setActive(true);
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
                MediaPlaybackPlugin.emitAction("stop");
                releaseAndStop();
                return START_NOT_STICKY;
            case ACTION_PLAY:
                playing = true;
                sPlaying = true;
                MediaPlaybackPlugin.emitAction("play");
                break;
            case ACTION_PAUSE:
                playing = false;
                sPlaying = false;
                MediaPlaybackPlugin.emitAction("pause");
                break;
            case ACTION_NEXT:
                MediaPlaybackPlugin.emitAction("next");
                break;
            case ACTION_PREV:
                MediaPlaybackPlugin.emitAction("prev");
                break;
            case ACTION_POSITION:
                if (intent.hasExtra(EXTRA_POSITION_MS)) {
                    positionMs = Math.max(0L, intent.getLongExtra(EXTRA_POSITION_MS, 0L));
                }
                if (intent.hasExtra(EXTRA_DURATION_MS)) {
                    durationMs = Math.max(0L, intent.getLongExtra(EXTRA_DURATION_MS, 0L));
                }
                if (intent.hasExtra(EXTRA_PLAYING)) {
                    playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
                }
                sActive = true;
                sPlaying = playing;
                updateSessionMetadata();
                updatePlaybackState();
                return START_STICKY;
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
                if (intent.hasExtra(EXTRA_POSITION_MS)) {
                    positionMs = Math.max(0L, intent.getLongExtra(EXTRA_POSITION_MS, 0L));
                }
                if (intent.hasExtra(EXTRA_DURATION_MS)) {
                    durationMs = Math.max(0L, intent.getLongExtra(EXTRA_DURATION_MS, 0L));
                }
                break;
        }
        sActive = true;
        sPlaying = playing;

        try {
            if (mediaSession == null) {
                initMediaSession();
            }
            updateSessionMetadata();
            updatePlaybackState();
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
            releaseAndStop();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private void applyPosition(long posMs, long durMs, boolean isPlaying) {
        positionMs = posMs;
        if (durMs > 0) durationMs = durMs;
        playing = isPlaying;
        sPlaying = isPlaying;
        sActive = true;
        updateSessionMetadata();
        updatePlaybackState();
    }

    private void refreshSessionAndNotification() {
        try {
            updateSessionMetadata();
            updatePlaybackState();
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
            Log.e(TAG, "refreshSessionAndNotification failed", e);
        }
    }

    private void updateSessionMetadata() {
        if (mediaSession == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE,
                        title != null ? title : "未知曲目")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,
                        artist != null && !artist.isEmpty() ? artist : "蜉蝣")
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "蜉蝣");
        if (durationMs > 0) {
            meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        }
        mediaSession.setMetadata(meta.build());
    }

    private void updatePlaybackState() {
        if (mediaSession == null) return;
        int state = playing
                ? PlaybackStateCompat.STATE_PLAYING
                : PlaybackStateCompat.STATE_PAUSED;
        // position 单位毫秒；playing 时 speed=1 让系统自动外推进度
        float speed = playing ? 1.0f : 0f;
        long pos = Math.max(0L, positionMs);
        if (durationMs > 0 && pos > durationMs) pos = durationMs;
        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
                .setActions(MEDIA_ACTIONS)
                .setState(state, pos, speed, System.currentTimeMillis());
        mediaSession.setPlaybackState(builder.build());
        if (!mediaSession.isActive()) {
            mediaSession.setActive(true);
        }
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

        MediaStyle style = new MediaStyle()
                .setShowActionsInCompactView(0, 1, 2)
                .setShowCancelButton(true)
                .setCancelButtonIntent(stopPi);
        if (mediaSession != null) {
            style.setMediaSession(mediaSession.getSessionToken());
        }

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
                .setStyle(style)
                .setDeleteIntent(stopPi)
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

    private void releaseAndStop() {
        sPlaying = false;
        sActive = false;
        if (sInstance == this) sInstance = null;
        try {
            if (mediaSession != null) {
                mediaSession.setPlaybackState(
                        new PlaybackStateCompat.Builder()
                                .setState(PlaybackStateCompat.STATE_STOPPED, 0L, 0f)
                                .build()
                );
                mediaSession.setActive(false);
                mediaSession.release();
                mediaSession = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "release mediaSession", e);
        }
        try {
            stopForeground(true);
        } catch (Exception ignored) {
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        sPlaying = false;
        sActive = false;
        if (sInstance == this) sInstance = null;
        try {
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
                mediaSession = null;
            }
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
