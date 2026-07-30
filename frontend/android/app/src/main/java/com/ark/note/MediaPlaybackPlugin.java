package com.ark.note;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 音频前台服务控制：Web 播放时启 FGS，锁屏/通知栏动作回传 mediaAction；
 * 进度 position/duration（秒）写入 MediaSession 供锁屏进度条。
 * 车载：pushQueue / pushCatalog 供 MediaBrowser + AVRCP 队列。
 */
@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {
    private static MediaPlaybackPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
        try {
            MediaCarCatalog.loadPersistedCatalog(getContext());
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    static void emitAction(String action) {
        if (instance == null || action == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        instance.notifyListeners("mediaAction", data);
    }

    /** 锁屏拖动进度 → Web（秒） */
    static void emitSeek(double positionSec) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("position", positionSec);
        instance.notifyListeners("mediaSeek", data);
    }

    /**
     * 车机 MediaBrowser 点播：
     * 1) 立刻启媒体 FGS（保活进程 + 通知栏 + 让 MainActivity 维持 WebView）
     * 2) 再通知 Web 真正起播
     */
    static void emitBrowsePlay(String mediaId, String title, String artist) {
        emitBrowsePlay(mediaId, title, artist, null);
    }

    static void emitBrowsePlay(String mediaId, String title, String artist, String coverUrl) {
        if (mediaId == null || mediaId.isEmpty()) return;

        // 先起 FGS，避免 Web 尚未响应时进程被杀 / WebView 被 pause
        try {
            android.content.Context ctx = instance != null
                    ? instance.getContext()
                    : null;
            if (ctx == null) {
                // 插件尚未 attach 时仍尽量用 Application（由 Service 侧传入更好）
                ctx = null;
            }
            if (ctx != null) {
                ensureMediaFgsForCarPlay(ctx, title, artist, coverUrl);
            }
        } catch (Exception ignored) {
        }

        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("id", mediaId);
        if (title != null) data.put("title", title);
        if (artist != null) data.put("artist", artist);
        instance.notifyListeners("mediaBrowsePlay", data);
    }

    /** 车机点播：无条件拉起 mediaPlayback 前台服务 */
    static void ensureMediaFgsForCarPlay(
            android.content.Context ctx,
            String title,
            String artist,
            String coverUrl
    ) {
        if (ctx == null) return;
        MediaPlaybackService.startOrUpdate(
                ctx.getApplicationContext(),
                title != null && !title.isEmpty() ? title : "正在连接…",
                artist != null ? artist : "车载点播",
                true,
                true,
                0L,
                MediaPlaybackService.EXTRA_UNSET,
                "sequence",
                coverUrl
        );
        MediaPlaybackService.markCarBrowseKeepAlive();
    }

    /**
     * 更新或启动媒体通知。
     * { title, artist, isPlaying, position?, duration?, playMode? }  // position/duration 单位：秒
     * position/duration 未传时保留服务内已有值，避免锁屏进度被清零。
     */
    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "未知曲目");
        String artist = call.getString("artist", "");
        String playMode = call.getString("playMode", "sequence");
        String coverUrl = call.getString("coverUrl", null);
        boolean hasPlaying = call.getData().has("isPlaying");
        Boolean playing = call.getBoolean("isPlaying", true);
        boolean isPlaying = !hasPlaying || playing == null || playing;

        Double positionSec = call.getDouble("position");
        Double durationSec = call.getDouble("duration");
        // -1 表示「未提供，服务端保留旧值」
        long positionMs = -1L;
        long durationMs = -1L;
        if (positionSec != null && !Double.isNaN(positionSec) && positionSec >= 0) {
            positionMs = Math.round(positionSec * 1000.0);
        }
        if (durationSec != null && !Double.isNaN(durationSec) && durationSec > 0) {
            durationMs = Math.round(durationSec * 1000.0);
        }
        try {
            MediaPlaybackService.startOrUpdate(
                    getContext(), title, artist, isPlaying, hasPlaying, positionMs, durationMs, playMode, coverUrl);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.update failed: " + e.getMessage(), e);
        }
    }

    /**
     * 仅刷新进度（高频）。
     * { position, duration?, isPlaying? }  // 秒
     * isPlaying 未传时保留当前播放态，避免误把暂停改成播放。
     */
    @PluginMethod
    public void updatePosition(PluginCall call) {
        Double positionSec = call.getDouble("position");
        Double durationSec = call.getDouble("duration");
        boolean hasPlaying = call.getData().has("isPlaying");
        Boolean playing = call.getBoolean("isPlaying", null);

        long positionMs = -1L;
        long durationMs = -1L;
        if (positionSec != null && !Double.isNaN(positionSec) && positionSec >= 0) {
            positionMs = Math.round(positionSec * 1000.0);
        }
        if (durationSec != null && !Double.isNaN(durationSec) && durationSec > 0) {
            durationMs = Math.round(durationSec * 1000.0);
        }
        Boolean isPlaying = hasPlaying ? (playing == null || playing) : null;
        try {
            MediaPlaybackService.updatePosition(
                    getContext(), positionMs, durationMs, isPlaying);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.updatePosition failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            MediaPlaybackService.stop(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.stop failed: " + e.getMessage(), e);
        }
    }

    /**
     * 推送当前播放队列给车机 / MediaSession。
     * { items: [{ id, title, artist?, album?, duration?, coverUrl? }], currentIndex? }
     */
    @PluginMethod
    public void pushQueue(PluginCall call) {
        try {
            JSArray items = call.getArray("items");
            Integer idx = call.getInt("currentIndex", 0);
            int currentIndex = idx != null ? idx : 0;
            List<MediaCarCatalog.Track> tracks = parseTracksFromJs(items);
            MediaCarCatalog.setQueue(tracks, currentIndex);
            MediaPlaybackService.syncQueueFromCatalog();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("count", tracks.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.pushQueue failed: " + e.getMessage(), e);
        }
    }

    /**
     * 推送音频库快照（最近播放 + 合集树）。
     * { recent: Track[], collections: [{ id, title, tracks: Track[] }] }
     */
    @PluginMethod
    public void pushCatalog(PluginCall call) {
        try {
            JSArray recentJa = call.getArray("recent");
            JSArray colsJa = call.getArray("collections");
            List<MediaCarCatalog.Track> recent = parseTracksFromJs(recentJa);
            List<MediaCarCatalog.CollectionNode> cols = new ArrayList<>();
            if (colsJa != null) {
                for (int i = 0; i < colsJa.length(); i++) {
                    // JSArray 继承 JSONArray：用 optJSONObject，勿用 getJSObject(int)
                    JSONObject co = colsJa.optJSONObject(i);
                    if (co == null) continue;
                    JSONArray tracksJa = co.optJSONArray("tracks");
                    cols.add(new MediaCarCatalog.CollectionNode(
                            co.optString("id", ""),
                            co.optString("title", ""),
                            parseTracksFromJsonArray(tracksJa)
                    ));
                }
            }
            MediaCarCatalog.setCatalog(recent, cols);
            MediaCarCatalog.persistCatalog(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("recent", recent.size());
            ret.put("collections", cols.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.pushCatalog failed: " + e.getMessage(), e);
        }
    }

    private static List<MediaCarCatalog.Track> parseTracksFromJs(JSArray items) {
        if (items == null) return new ArrayList<>();
        return parseTracksFromJsonArray(items);
    }

    /** JSArray 即 JSONArray；统一用 opt* 避免 Capacitor API 差异 */
    private static List<MediaCarCatalog.Track> parseTracksFromJsonArray(JSONArray items) {
        List<MediaCarCatalog.Track> list = new ArrayList<>();
        if (items == null) return list;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            if (id.isEmpty()) continue;
            double durSec = o.optDouble("duration", 0d);
            long durMs = durSec > 0 ? Math.round(durSec * 1000.0) : 0L;
            String cover = o.optString("coverUrl", null);
            if (cover != null && cover.isEmpty()) cover = null;
            list.add(new MediaCarCatalog.Track(
                    id,
                    o.optString("title", "未知曲目"),
                    o.optString("artist", ""),
                    o.optString("album", ""),
                    cover,
                    durMs
            ));
            if (list.size() >= 500) break;
        }
        return list;
    }
}
