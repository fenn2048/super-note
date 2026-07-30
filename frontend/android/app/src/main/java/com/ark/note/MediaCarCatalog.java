package com.ark.note;

import android.content.Context;
import android.content.SharedPreferences;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 车载 / MediaBrowser 共享目录：
 * Web 通过 Capacitor 推送当前队列与音频库快照，供 MediaBrowserService 与 MediaSession 队列使用。
 */
public final class MediaCarCatalog {
    private static final String TAG = "MediaCarCatalog";
    private static final String PREFS = "media_car_catalog";
    private static final String KEY_CATALOG = "catalog_json";

    public static final String ID_ROOT = "root";
    public static final String ID_QUEUE = "queue";
    public static final String ID_RECENT = "recent";
    public static final String ID_COLLECTIONS = "collections";
    public static final String PREFIX_COLLECTION = "collection:";
    public static final String PREFIX_TRACK = "track:";

    public static final class Track {
        public final String id;
        public final String title;
        public final String artist;
        public final String album;
        public final String coverUrl;
        public final long durationMs;

        public Track(String id, String title, String artist, String album, String coverUrl, long durationMs) {
            this.id = id != null ? id : "";
            this.title = title != null && !title.isEmpty() ? title : "未知曲目";
            this.artist = artist != null ? artist : "";
            this.album = album != null ? album : "";
            this.coverUrl = coverUrl;
            this.durationMs = Math.max(0L, durationMs);
        }

        public String mediaId() {
            return PREFIX_TRACK + id;
        }
    }

    public static final class CollectionNode {
        public final String id;
        public final String title;
        public final List<Track> tracks;

        public CollectionNode(String id, String title, List<Track> tracks) {
            this.id = id != null ? id : "";
            this.title = title != null && !title.isEmpty() ? title : "未命名合集";
            this.tracks = tracks != null ? tracks : Collections.<Track>emptyList();
        }

        public String mediaId() {
            return PREFIX_COLLECTION + id;
        }
    }

    public interface Listener {
        void onCatalogChanged();
    }

    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private static final Object lock = new Object();

    private static List<Track> queue = new ArrayList<>();
    private static int queueIndex = -1;
    private static List<Track> recent = new ArrayList<>();
    private static List<CollectionNode> collections = new ArrayList<>();

    private MediaCarCatalog() {}

    public static void addListener(Listener l) {
        if (l != null) listeners.addIfAbsent(l);
    }

    public static void removeListener(Listener l) {
        listeners.remove(l);
    }

    private static void notifyChanged() {
        for (Listener l : listeners) {
            try {
                l.onCatalogChanged();
            } catch (Exception e) {
                Log.w(TAG, "listener", e);
            }
        }
    }

    public static void setQueue(List<Track> tracks, int currentIndex) {
        synchronized (lock) {
            queue = tracks != null ? new ArrayList<>(tracks) : new ArrayList<Track>();
            if (queue.isEmpty()) {
                queueIndex = -1;
            } else {
                queueIndex = Math.max(0, Math.min(currentIndex, queue.size() - 1));
            }
        }
        notifyChanged();
    }

    public static void setCatalog(List<Track> recentTracks, List<CollectionNode> cols) {
        synchronized (lock) {
            recent = recentTracks != null ? new ArrayList<>(recentTracks) : new ArrayList<Track>();
            collections = cols != null ? new ArrayList<>(cols) : new ArrayList<CollectionNode>();
        }
        notifyChanged();
    }

    public static List<Track> getQueueSnapshot() {
        synchronized (lock) {
            return new ArrayList<>(queue);
        }
    }

    public static int getQueueIndex() {
        synchronized (lock) {
            return queueIndex;
        }
    }

    public static Track findTrackByMediaId(String mediaId) {
        if (mediaId == null) return null;
        String id = mediaId.startsWith(PREFIX_TRACK) ? mediaId.substring(PREFIX_TRACK.length()) : mediaId;
        synchronized (lock) {
            for (Track t : queue) {
                if (id.equals(t.id)) return t;
            }
            for (Track t : recent) {
                if (id.equals(t.id)) return t;
            }
            for (CollectionNode c : collections) {
                for (Track t : c.tracks) {
                    if (id.equals(t.id)) return t;
                }
            }
        }
        return null;
    }

    public static String rawIdFromMediaId(String mediaId) {
        if (mediaId == null) return null;
        if (mediaId.startsWith(PREFIX_TRACK)) return mediaId.substring(PREFIX_TRACK.length());
        return mediaId;
    }

    public static List<MediaBrowserCompat.MediaItem> childrenOf(String parentId) {
        List<MediaBrowserCompat.MediaItem> out = new ArrayList<>();
        if (parentId == null || parentId.isEmpty() || ID_ROOT.equals(parentId)) {
            out.add(folderItem(ID_QUEUE, "当前队列", "正在播放的列表"));
            out.add(folderItem(ID_RECENT, "最近播放", "最近听过的曲目"));
            out.add(folderItem(ID_COLLECTIONS, "音频合集", "媒体库合集"));
            return out;
        }
        if (ID_QUEUE.equals(parentId)) {
            synchronized (lock) {
                for (Track t : queue) out.add(playableItem(t));
            }
            return out;
        }
        if (ID_RECENT.equals(parentId)) {
            synchronized (lock) {
                for (Track t : recent) out.add(playableItem(t));
            }
            return out;
        }
        if (ID_COLLECTIONS.equals(parentId)) {
            synchronized (lock) {
                for (CollectionNode c : collections) {
                    out.add(folderItem(c.mediaId(), c.title, c.tracks.size() + " 首"));
                }
            }
            return out;
        }
        if (parentId.startsWith(PREFIX_COLLECTION)) {
            String colId = parentId.substring(PREFIX_COLLECTION.length());
            synchronized (lock) {
                for (CollectionNode c : collections) {
                    if (colId.equals(c.id)) {
                        for (Track t : c.tracks) out.add(playableItem(t));
                        break;
                    }
                }
            }
            return out;
        }
        return out;
    }

    private static MediaBrowserCompat.MediaItem folderItem(String id, String title, String subtitle) {
        MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                .setMediaId(id)
                .setTitle(title)
                .setSubtitle(subtitle)
                .build();
        return new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private static MediaBrowserCompat.MediaItem playableItem(Track t) {
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder()
                .setMediaId(t.mediaId())
                .setTitle(t.title)
                .setSubtitle(!TextUtils.isEmpty(t.artist) ? t.artist : t.album);
        if (!TextUtils.isEmpty(t.coverUrl)) {
            try {
                b.setIconUri(android.net.Uri.parse(t.coverUrl));
            } catch (Exception ignored) {
            }
        }
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    /** 构建 MediaSession 队列 */
    public static List<MediaSessionCompat.QueueItem> buildSessionQueue() {
        List<MediaSessionCompat.QueueItem> q = new ArrayList<>();
        synchronized (lock) {
            long i = 0;
            for (Track t : queue) {
                MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder()
                        .setMediaId(t.mediaId())
                        .setTitle(t.title)
                        .setSubtitle(t.artist);
                q.add(new MediaSessionCompat.QueueItem(b.build(), i++));
            }
        }
        return q;
    }

    public static List<Track> parseTracks(JSONArray arr) {
        List<Track> list = new ArrayList<>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            if (id.isEmpty()) continue;
            double durSec = o.optDouble("duration", 0);
            long durMs = durSec > 0 ? Math.round(durSec * 1000.0) : 0L;
            list.add(new Track(
                    id,
                    o.optString("title", "未知曲目"),
                    o.optString("artist", ""),
                    o.optString("album", ""),
                    o.optString("coverUrl", null),
                    durMs
            ));
            if (list.size() >= 500) break;
        }
        return list;
    }

    public static void persistCatalog(Context ctx) {
        try {
            JSONObject root = new JSONObject();
            JSONArray recentArr = new JSONArray();
            JSONArray colsArr = new JSONArray();
            synchronized (lock) {
                for (Track t : recent) recentArr.put(trackJson(t));
                for (CollectionNode c : collections) {
                    JSONObject co = new JSONObject();
                    co.put("id", c.id);
                    co.put("title", c.title);
                    JSONArray ta = new JSONArray();
                    for (Track t : c.tracks) ta.put(trackJson(t));
                    co.put("tracks", ta);
                    colsArr.put(co);
                }
            }
            root.put("recent", recentArr);
            root.put("collections", colsArr);
            SharedPreferences sp = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putString(KEY_CATALOG, root.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "persistCatalog", e);
        }
    }

    public static void loadPersistedCatalog(Context ctx) {
        try {
            SharedPreferences sp = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY_CATALOG, null);
            if (raw == null || raw.isEmpty()) return;
            JSONObject root = new JSONObject(raw);
            List<Track> r = parseTracks(root.optJSONArray("recent"));
            List<CollectionNode> cols = new ArrayList<>();
            JSONArray colsArr = root.optJSONArray("collections");
            if (colsArr != null) {
                for (int i = 0; i < colsArr.length(); i++) {
                    JSONObject co = colsArr.optJSONObject(i);
                    if (co == null) continue;
                    cols.add(new CollectionNode(
                            co.optString("id", ""),
                            co.optString("title", ""),
                            parseTracks(co.optJSONArray("tracks"))
                    ));
                }
            }
            setCatalog(r, cols);
        } catch (Exception e) {
            Log.w(TAG, "loadPersistedCatalog", e);
        }
    }

    private static JSONObject trackJson(Track t) throws Exception {
        JSONObject o = new JSONObject();
        o.put("id", t.id);
        o.put("title", t.title);
        o.put("artist", t.artist);
        o.put("album", t.album);
        if (t.coverUrl != null) o.put("coverUrl", t.coverUrl);
        if (t.durationMs > 0) o.put("duration", t.durationMs / 1000.0);
        return o;
    }
}
