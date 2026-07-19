package com.ark.note;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 音频前台服务控制：Web 播放时启 FGS，锁屏/通知栏动作回传 mediaAction。
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

    /**
     * 更新或启动媒体通知。
     * { title, artist, isPlaying }
     */
    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "未知曲目");
        String artist = call.getString("artist", "");
        Boolean playing = call.getBoolean("isPlaying", true);
        boolean isPlaying = playing == null || playing;
        try {
            MediaPlaybackService.startOrUpdate(getContext(), title, artist, isPlaying);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("MediaPlayback.update failed: " + e.getMessage(), e);
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
