package com.ark.note;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.SystemClock;
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
 * Web 侧 HTMLMediaElement 负责实际解码；本服务只负责 FGS 与系统媒体会话。
 * 进度：Web 上报 position/duration（毫秒），写入 PlaybackState，锁屏进度条基于 SystemClock.elapsedRealtime 实时外推更新。
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
    public static final String ACTION_MODE = "com.ark.note.media.MODE";
    /** 仅刷新进度，不重建整套通知元数据文案 */
    public static final String ACTION_POSITION = "com.ark.note.media.POSITION";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_HAS_PLAYING = "hasPlaying";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_PLAY_MODE = "playMode";
    public static final String EXTRA_COVER_URL = "coverUrl";
    /** position/duration 使用 -1 表示「未提供，保留旧值」 */
    public static final long EXTRA_UNSET = -1L;

    private static final long MEDIA_ACTIONS =
            PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_STOP
                    | PlaybackStateCompat.ACTION_SEEK_TO
                    | PlaybackStateCompat.ACTION_SET_REPEAT_MODE
                    | PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE;

    private MediaSessionCompat mediaSession;
    private String title = "蜉蝣 · 正在播放";
    private String artist = "";
    private String playMode = "sequence"; // "sequence", "random", "loop"
    private String currentCoverUrl = null;
    private android.graphics.Bitmap currentCoverBitmap = null;
    private final java.util.concurrent.ExecutorService imageExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();
    private boolean playing = true;
    private long positionMs = 0L;
    private long durationMs = 0L;
    /** 最近一次由 Web 或系统写入 position 的开机真实时间（SystemClock.elapsedRealtime），用于系统外推 */
    private long positionUpdateElapsed = 0L;
    /** 标志：是否刚由服务发起了暂停，避免 Web 异步保留的旧进度冲掉暂停时的冻结进度 */
    private boolean justPausedByService = false;

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

    /**
     * @param positionMs EXTRA_UNSET(-1) 表示不改进度
     * @param durationMs EXTRA_UNSET(-1) 表示不改时长
     * @param hasPlaying 是否显式指定播放态
     */
    public static void startOrUpdate(
            Context ctx,
            String title,
            String artist,
            boolean playing,
            boolean hasPlaying,
            long positionMs,
            long durationMs,
            String playMode
    ) {
        startOrUpdate(ctx, title, artist, playing, hasPlaying, positionMs, durationMs, playMode, null);
    }

    public static void startOrUpdate(
            Context ctx,
            String title,
            String artist,
            boolean playing,
            boolean hasPlaying,
            long positionMs,
            long durationMs,
            String playMode,
            String coverUrl
    ) {
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_TITLE, title != null ? title : "未知曲目");
        i.putExtra(EXTRA_ARTIST, artist != null ? artist : "");
        i.putExtra(EXTRA_HAS_PLAYING, hasPlaying);
        i.putExtra(EXTRA_PLAYING, playing);
        i.putExtra(EXTRA_POSITION_MS, positionMs);
        i.putExtra(EXTRA_DURATION_MS, durationMs);
        if (playMode != null) {
            i.putExtra(EXTRA_PLAY_MODE, playMode);
        }
        if (coverUrl != null) {
            i.putExtra(EXTRA_COVER_URL, coverUrl);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    /**
     * 轻量进度刷新：服务已在跑则直接写 MediaSession；否则忽略（等下次 update 启动）。
     * @param isPlaying null 表示不改变播放态
     * @param positionMs EXTRA_UNSET 表示不改
     * @param durationMs EXTRA_UNSET 或 0 表示不改时长
     */
    public static void updatePosition(Context ctx, long positionMs, long durationMs, Boolean isPlaying) {
        MediaPlaybackService inst = sInstance;
        if (inst != null) {
            inst.applyPosition(positionMs, durationMs, isPlaying);
            return;
        }
        // 服务未起且没有明确进度时不要拉起空会话
        if (positionMs < 0 && (isPlaying == null || !isPlaying)) return;
        boolean play = isPlaying == null || isPlaying;
        long pos = positionMs >= 0 ? positionMs : 0L;
        long dur = durationMs > 0 ? durationMs : EXTRA_UNSET;
        startOrUpdate(ctx, "蜉蝣 · 正在播放", "", play, isPlaying != null, pos, dur, "sequence");
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
                positionUpdateElapsed = SystemClock.elapsedRealtime();
                justPausedByService = false;
                MediaPlaybackPlugin.emitAction("play");
                refreshSessionAndNotification();
            }

            @Override
            public void onPause() {
                freezeExtrapolatedPosition();
                playing = false;
                sPlaying = false;
                justPausedByService = true;
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
                positionUpdateElapsed = SystemClock.elapsedRealtime();
                justPausedByService = false;
                MediaPlaybackPlugin.emitSeek(positionMs / 1000.0);
                updatePlaybackState();
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                if (ACTION_MODE.equals(action)) {
                    togglePlayMode();
                } else if (ACTION_STOP.equals(action)) {
                    MediaPlaybackPlugin.emitAction("stop");
                    releaseAndStop();
                }
            }

            @Override
            public void onSetRepeatMode(int repeatMode) {
                togglePlayMode();
            }

            @Override
            public void onSetShuffleMode(int shuffleMode) {
                togglePlayMode();
            }
        });
        mediaSession.setActive(true);
    }

    private void togglePlayMode() {
        if ("sequence".equals(playMode)) {
            playMode = "random";
        } else if ("random".equals(playMode)) {
            playMode = "loop";
        } else {
            playMode = "sequence";
        }
        MediaPlaybackPlugin.emitAction("mode");
        refreshSessionAndNotification();
    }

    /** 播放中根据 speed=1 外推后的真实位置 */
    private long getExtrapolatedPositionMs() {
        if (!playing || positionUpdateElapsed <= 0) {
            return positionMs;
        }
        long elapsed = SystemClock.elapsedRealtime() - positionUpdateElapsed;
        if (elapsed > 0 && elapsed < 86_400_000L) {
            long pos = positionMs + elapsed;
            if (durationMs > 0 && pos > durationMs) {
                return durationMs;
            }
            return pos;
        }
        return positionMs;
    }

    private void freezeExtrapolatedPosition() {
        positionMs = getExtrapolatedPositionMs();
        positionUpdateElapsed = SystemClock.elapsedRealtime();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (action == null) action = ACTION_START;
        AppLogger.i(TAG, "onStartCommand action=" + action);

        switch (action) {
            case ACTION_STOP:
                MediaPlaybackPlugin.emitAction("stop");
                releaseAndStop();
                return START_NOT_STICKY;
            case ACTION_PLAY:
                playing = true;
                sPlaying = true;
                positionUpdateElapsed = SystemClock.elapsedRealtime();
                justPausedByService = false;
                MediaPlaybackPlugin.emitAction("play");
                break;
            case ACTION_PAUSE:
                freezeExtrapolatedPosition();
                playing = false;
                sPlaying = false;
                justPausedByService = true;
                MediaPlaybackPlugin.emitAction("pause");
                break;
            case ACTION_NEXT:
                MediaPlaybackPlugin.emitAction("next");
                break;
            case ACTION_PREV:
                MediaPlaybackPlugin.emitAction("prev");
                break;
            case ACTION_MODE:
                togglePlayMode();
                break;
            case ACTION_POSITION:
                applyPositionFromIntent(intent);
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
                if (intent.hasExtra(EXTRA_PLAY_MODE)) {
                    String pm = intent.getStringExtra(EXTRA_PLAY_MODE);
                    if (pm != null && !pm.isEmpty()) {
                        playMode = pm;
                    }
                }
                if (intent.hasExtra(EXTRA_COVER_URL)) {
                    String cover = intent.getStringExtra(EXTRA_COVER_URL);
                    loadCoverBitmap(cover);
                }
                boolean hasPlaying = intent.getBooleanExtra(EXTRA_HAS_PLAYING, true);
                if (hasPlaying && intent.hasExtra(EXTRA_PLAYING)) {
                    boolean newPlaying = intent.getBooleanExtra(EXTRA_PLAYING, true);
                    if (playing && !newPlaying) {
                        freezeExtrapolatedPosition();
                        justPausedByService = true;
                    }
                    playing = newPlaying;
                }
                applyPositionFromIntent(intent);
                break;
        }
        sActive = true;
        sPlaying = playing;
        if (playing) {
            positionUpdateElapsed = SystemClock.elapsedRealtime();
            justPausedByService = false;
        }

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

    private void applyPositionFromIntent(Intent intent) {
        long p = intent.hasExtra(EXTRA_POSITION_MS) ? intent.getLongExtra(EXTRA_POSITION_MS, EXTRA_UNSET) : EXTRA_UNSET;
        long d = intent.hasExtra(EXTRA_DURATION_MS) ? intent.getLongExtra(EXTRA_DURATION_MS, EXTRA_UNSET) : EXTRA_UNSET;
        applyPosition(p, d, null);
    }

    /**
     * @param posMs EXTRA_UNSET 保留旧进度
     * @param durMs <=0 或 EXTRA_UNSET 保留旧时长
     * @param isPlaying null 保留旧播放态
     */
    private void applyPosition(long posMs, long durMs, Boolean isPlaying) {
        long now = SystemClock.elapsedRealtime();

        if (isPlaying != null) {
            boolean wasPlaying = playing;
            playing = isPlaying;
            sPlaying = isPlaying;

            if (wasPlaying && !isPlaying) {
                freezeExtrapolatedPosition();
                justPausedByService = true;
            } else if (!wasPlaying && isPlaying) {
                // 由暂停切为播放：除非 posMs 为有效正数且接近 positionMs，否则保留暂停时冻结的 positionMs
                if (posMs > 0 && (positionMs <= 0 || Math.abs(posMs - positionMs) < 5000)) {
                    positionMs = posMs;
                }
                positionUpdateElapsed = now;
                justPausedByService = false;
            }
        }

        if (durMs > 0) {
            durationMs = durMs;
        }

        if (posMs >= 0) {
            if (playing) {
                long currentExtrapolated = getExtrapolatedPositionMs();
                // 播放中：若 posMs == 0 且现有外推进度 > 3秒，防止起播/恢复瞬时被 JS 误传 0 冲掉已有进度
                if (posMs == 0 && currentExtrapolated > 3000) {
                    // 忽略该 0 值，保留当前外推进度
                } else if (Math.abs(posMs - currentExtrapolated) >= 1500) {
                    positionMs = posMs;
                    positionUpdateElapsed = now;
                }
            } else {
                // 暂停中，若刚由服务发起了暂停，1秒内微小差距（< 1000ms）不覆盖冻结的精确定位
                if (!justPausedByService || Math.abs(posMs - positionMs) >= 1000) {
                    positionMs = posMs;
                    positionUpdateElapsed = now;
                    justPausedByService = false;
                }
            }
        }

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

    private void loadCoverBitmap(final String newCoverUrl) {
        if (newCoverUrl == null || newCoverUrl.trim().isEmpty()) {
            currentCoverUrl = null;
            currentCoverBitmap = null;
            return;
        }
        if (newCoverUrl.equals(currentCoverUrl)) {
            return;
        }
        currentCoverUrl = newCoverUrl;

        imageExecutor.execute(new Runnable() {
            @Override
            public void run() {
                android.graphics.Bitmap bmp = null;
                try {
                    if (newCoverUrl.startsWith("data:image")) {
                        int commaIndex = newCoverUrl.indexOf(",");
                        if (commaIndex > 0) {
                            String b64 = newCoverUrl.substring(commaIndex + 1);
                            byte[] decoded = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                            bmp = android.graphics.BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
                        }
                    } else if (newCoverUrl.startsWith("http://") || newCoverUrl.startsWith("https://")) {
                        java.net.URL u = new java.net.URL(newCoverUrl);
                        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) u.openConnection();
                        conn.setConnectTimeout(5000);
                        conn.setReadTimeout(5000);
                        conn.setDoInput(true);
                        conn.connect();
                        java.io.InputStream is = conn.getInputStream();
                        bmp = android.graphics.BitmapFactory.decodeStream(is);
                        is.close();
                        conn.disconnect();
                    }
                    if (bmp != null) {
                        int maxDim = 512;
                        if (bmp.getWidth() > maxDim || bmp.getHeight() > maxDim) {
                            float scale = Math.min((float) maxDim / bmp.getWidth(), (float) maxDim / bmp.getHeight());
                            int w = Math.round(bmp.getWidth() * scale);
                            int h = Math.round(bmp.getHeight() * scale);
                            bmp = android.graphics.Bitmap.createScaledBitmap(bmp, w, h, true);
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to load cover bitmap from: " + newCoverUrl, e);
                }

                final android.graphics.Bitmap finalBmp = bmp;
                new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        if (newCoverUrl.equals(currentCoverUrl)) {
                            currentCoverBitmap = finalBmp;
                            refreshSessionAndNotification();
                        }
                    }
                });
            }
        });
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
        if (currentCoverBitmap != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentCoverBitmap);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, currentCoverBitmap);
        }
        mediaSession.setMetadata(meta.build());
    }

    private void updatePlaybackState() {
        if (mediaSession == null) return;
        int state = playing
                ? PlaybackStateCompat.STATE_PLAYING
                : PlaybackStateCompat.STATE_PAUSED;
        float speed = playing ? 1.0f : 0f;
        long pos = Math.max(0L, positionMs);
        if (durationMs > 0 && pos > durationMs) pos = durationMs;
        long updateTime = positionUpdateElapsed > 0
                ? positionUpdateElapsed
                : SystemClock.elapsedRealtime();

        int modeIcon;
        String modeTitle;
        if ("random".equals(playMode)) {
            modeIcon = R.drawable.ic_shuffle;
            modeTitle = "随机播放";
        } else if ("loop".equals(playMode)) {
            modeIcon = R.drawable.ic_repeat_one;
            modeTitle = "单曲循环";
        } else {
            modeIcon = R.drawable.ic_repeat_all;
            modeTitle = "列表循环";
        }

        // 绑定 CustomAction：Android 11+ 系统媒体卡片/锁屏控件读取 PlaybackState.getCustomActions 来渲染左右两侧拓展按钮
        PlaybackStateCompat.CustomAction modeCustomAction = new PlaybackStateCompat.CustomAction.Builder(
                ACTION_MODE,
                modeTitle,
                modeIcon
        ).build();

        PlaybackStateCompat.CustomAction closeCustomAction = new PlaybackStateCompat.CustomAction.Builder(
                ACTION_STOP,
                "关闭",
                R.drawable.ic_close
        ).build();

        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
                .setActions(MEDIA_ACTIONS)
                .setState(state, pos, speed, updateTime)
                .addCustomAction(modeCustomAction)
                .addCustomAction(closeCustomAction);

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

        PendingIntent modePi = actionPi(ACTION_MODE, 5);
        PendingIntent prevPi = actionPi(ACTION_PREV, 1);
        PendingIntent playPausePi = actionPi(playing ? ACTION_PAUSE : ACTION_PLAY, 2);
        PendingIntent nextPi = actionPi(ACTION_NEXT, 3);
        PendingIntent stopPi = actionPi(ACTION_STOP, 4);

        String body = artist != null && !artist.isEmpty() ? artist : "音频播放中";
        int playIcon = playing
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;

        int modeIcon;
        String modeTitle;
        if ("random".equals(playMode)) {
            modeIcon = R.drawable.ic_shuffle;
            modeTitle = "随机播放";
        } else if ("loop".equals(playMode)) {
            modeIcon = R.drawable.ic_repeat_one;
            modeTitle = "单曲循环";
        } else {
            modeIcon = R.drawable.ic_repeat_all;
            modeTitle = "列表循环";
        }

        MediaStyle style = new MediaStyle()
                .setShowActionsInCompactView(1, 2, 3)
                .setShowCancelButton(true)
                .setCancelButtonIntent(stopPi);
        if (mediaSession != null) {
            style.setMediaSession(mediaSession.getSessionToken());
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, NotificationChannels.MEDIA)
                .setContentTitle(title != null ? title : "蜉蝣 · 正在播放")
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentPi)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        if (currentCoverBitmap != null) {
            builder.setLargeIcon(currentCoverBitmap);
        }

        return builder
                // Action 0 (左下角): 播放模式
                .addAction(modeIcon, modeTitle, modePi)
                // Action 1: 上一曲
                .addAction(android.R.drawable.ic_media_previous, "上一曲", prevPi)
                // Action 2: 播放/暂停
                .addAction(playIcon, playing ? "暂停" : "播放", playPausePi)
                // Action 3: 下一曲
                .addAction(android.R.drawable.ic_media_next, "下一曲", nextPi)
                // Action 4 (右下角): 关闭
                .addAction(R.drawable.ic_close, "关闭", stopPi)
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
