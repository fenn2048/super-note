package com.ark.note;

import android.content.Intent;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * 车载 / 系统媒体浏览器入口。
 * 暴露当前队列、最近播放、音频合集；播放控制经 MediaSession 与 Web 桥接。
 * 与 MediaPlaybackService 共用播放会话：优先使用 Playback 服务的 token，否则自建轻量 Session。
 */
public class SuperNoteMediaBrowserService extends MediaBrowserServiceCompat
        implements MediaCarCatalog.Listener {

    private static final String TAG = "MediaBrowserSvc";
    private static final String ROOT = MediaCarCatalog.ID_ROOT;

    private MediaSessionCompat fallbackSession;
    private static SuperNoteMediaBrowserService sInstance;

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        MediaCarCatalog.loadPersistedCatalog(this);
        MediaCarCatalog.addListener(this);
        attachSessionToken();
        Log.i(TAG, "MediaBrowserService created");
    }

    private void attachSessionToken() {
        MediaSessionCompat.Token token = MediaPlaybackService.getSessionToken();
        if (token != null) {
            setSessionToken(token);
            releaseFallbackSession();
            return;
        }
        // 尚无前台播放服务时，提供可连接的空 Session，便于车机发现应用
        if (fallbackSession == null) {
            fallbackSession = new MediaSessionCompat(this, "SuperNoteBrowser");
            fallbackSession.setFlags(
                    MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                            | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            );
            fallbackSession.setCallback(new MediaSessionCompat.Callback() {
                @Override
                public void onPlay() {
                    MediaPlaybackPlugin.emitAction("play");
                    bringAppToFront();
                }

                @Override
                public void onPause() {
                    MediaPlaybackPlugin.emitAction("pause");
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
                public void onPlayFromMediaId(String mediaId, Bundle extras) {
                    handlePlayFromMediaId(mediaId);
                }

                @Override
                public void onSkipToQueueItem(long id) {
                    List<MediaCarCatalog.Track> q = MediaCarCatalog.getQueueSnapshot();
                    if (id >= 0 && id < q.size()) {
                        handlePlayFromMediaId(q.get((int) id).mediaId());
                    }
                }
            });
            fallbackSession.setPlaybackState(
                    new PlaybackStateCompat.Builder()
                            .setActions(
                                    PlaybackStateCompat.ACTION_PLAY
                                            | PlaybackStateCompat.ACTION_PAUSE
                                            | PlaybackStateCompat.ACTION_PLAY_PAUSE
                                            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                                            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                                            | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
                            )
                            .setState(PlaybackStateCompat.STATE_NONE, 0, 0f)
                            .build()
            );
            fallbackSession.setActive(true);
        }
        setSessionToken(fallbackSession.getSessionToken());
        syncQueueToSession(fallbackSession);
    }

    /** Playback 服务启动后切换到其 Session，避免双 Session */
    public static void onPlaybackSessionReady() {
        SuperNoteMediaBrowserService inst = sInstance;
        if (inst != null) {
            inst.attachSessionToken();
        }
    }

    private void releaseFallbackSession() {
        if (fallbackSession != null) {
            try {
                fallbackSession.setActive(false);
                fallbackSession.release();
            } catch (Exception ignored) {
            }
            fallbackSession = null;
        }
    }

    private void syncQueueToSession(MediaSessionCompat session) {
        if (session == null) return;
        try {
            List<MediaSessionCompat.QueueItem> q = MediaCarCatalog.buildSessionQueue();
            session.setQueue(q);
            session.setQueueTitle("当前队列");
        } catch (Exception e) {
            Log.w(TAG, "setQueue", e);
        }
    }

    @Override
    public void onCatalogChanged() {
        notifyChildrenChanged(ROOT);
        notifyChildrenChanged(MediaCarCatalog.ID_QUEUE);
        notifyChildrenChanged(MediaCarCatalog.ID_RECENT);
        notifyChildrenChanged(MediaCarCatalog.ID_COLLECTIONS);
        // 通知各合集节点
        // （简化：客户端重新 subscribe 时会拉新数据）
        MediaSessionCompat.Token token = getSessionToken();
        if (fallbackSession != null) {
            syncQueueToSession(fallbackSession);
        }
        MediaPlaybackService.syncQueueFromCatalog();
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        // 允许系统媒体浏览器、蓝牙、CarLife 等连接
        Log.i(TAG, "onGetRoot from " + clientPackageName);
        return new BrowserRoot(ROOT, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> children = MediaCarCatalog.childrenOf(parentId);
        if (children == null) children = new ArrayList<>();
        result.sendResult(children);
    }

    private void handlePlayFromMediaId(String mediaId) {
        String raw = MediaCarCatalog.rawIdFromMediaId(mediaId);
        if (raw == null || raw.isEmpty()) return;
        MediaCarCatalog.Track t = MediaCarCatalog.findTrackByMediaId(mediaId);
        String title = t != null ? t.title : "正在连接…";
        String artist = t != null ? t.artist : "车载点播";
        String cover = t != null ? t.coverUrl : null;

        // 1) 立刻启 mediaPlayback FGS（保活进程，供 WebView 不挂起）
        MediaPlaybackPlugin.ensureMediaFgsForCarPlay(this, title, artist, cover);
        // 2) 通知 Web 起播
        MediaPlaybackPlugin.emitBrowsePlay(raw, title, artist, cover);
        // 3) 拉起 Activity，强制 resume WebView
        bringAppToFront();
    }

    private void bringAppToFront() {
        try {
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            open.putExtra("media_browse_wake", true);
            startActivity(open);
        } catch (Exception e) {
            Log.w(TAG, "bringAppToFront", e);
        }
    }

    @Override
    public void onDestroy() {
        MediaCarCatalog.removeListener(this);
        releaseFallbackSession();
        if (sInstance == this) sInstance = null;
        super.onDestroy();
    }
}
