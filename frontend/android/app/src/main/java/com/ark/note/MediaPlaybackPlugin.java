package com.ark.note;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 音频前台服务控制：Web 播放时启 FGS，锁屏/通知栏动作回传 mediaAction；
 * 进度 position/duration（秒）写入 MediaSession 供锁屏进度条。
 */
@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {
    private static MediaPlaybackPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
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
     * 更新或启动媒体通知。
     * { title, artist, isPlaying, position?, duration? }  // position/duration 单位：秒
     * position/duration 未传时保留服务内已有值，避免锁屏进度被清零。
     */
    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "未知曲目");
        String artist = call.getString("artist", "");
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
                    getContext(), title, artist, isPlaying, hasPlaying, positionMs, durationMs);
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
}
