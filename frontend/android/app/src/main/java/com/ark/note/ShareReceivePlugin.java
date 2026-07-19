package com.ark.note;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 系统分享入站（ACTION_SEND / SEND_MULTIPLE）
 * ---------------------------------------------------------------------------
 * MainActivity 解析 Intent 后调用 {@link #queueFromIntent}；
 * Web 侧通过 consumePending + shareReceived 事件接手。
 */
@CapacitorPlugin(name = "ShareReceive")
public class ShareReceivePlugin extends Plugin {
    private static final String TAG = "ShareReceive";
    /** 单文件 base64 上限（约 6MB 原始字节），避免 WebView OOM */
    private static final int MAX_FILE_BYTES = 6 * 1024 * 1024;
    private static final int MAX_IMAGES = 9;

    private static final Pattern URL_PATTERN = Pattern.compile(
            "(?i)\\bhttps?://[^\\s<>\"']+"
    );

    private static ShareReceivePlugin instance;
    private static JSObject pendingPayload;

    @Override
    public void load() {
        super.load();
        instance = this;
        // 冷启动：若 Intent 已在 onCreate 入队，补发一次事件
        if (pendingPayload != null) {
            notifyListeners("shareReceived", pendingPayload);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    /**
     * 从 Activity Intent 解析分享内容并入队。
     * 在主线程调用；读取 Content URI 可能稍慢，可接受（分享通常 1–2 张图）。
     */
    public static void queueFromIntent(android.content.Context context, Intent intent) {
        if (intent == null || context == null) return;
        String action = intent.getAction();
        if (action == null) return;
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        try {
            JSObject payload = parseShareIntent(context, intent);
            if (payload == null) return;
            pendingPayload = payload;
            if (instance != null) {
                instance.notifyListeners("shareReceived", payload);
            }
            Log.i(TAG, "queued share type=" + payload.getString("type"));
        } catch (Exception e) {
            Log.e(TAG, "queueFromIntent failed", e);
        }
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        JSObject p = pendingPayload;
        pendingPayload = null;
        JSObject ret = new JSObject();
        // 无 pending 时不写 share 字段，前端按 falsy 处理
        if (p != null) {
            ret.put("share", p);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        pendingPayload = null;
        call.resolve();
    }

    private static JSObject parseShareIntent(android.content.Context context, Intent intent) {
        String type = intent.getType() != null ? intent.getType() : "*/*";
        String action = intent.getAction();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);

        JSObject out = new JSObject();
        if (subject != null && !subject.isEmpty()) {
            out.put("subject", subject);
        }

        // --- 文本 / URL ---
        if (text != null && !text.trim().isEmpty()) {
            String trimmed = text.trim();
            String extractedUrl = extractFirstUrl(trimmed);
            if (extractedUrl != null && looksLikeMostlyUrl(trimmed, extractedUrl)) {
                out.put("type", "url");
                out.put("url", extractedUrl);
                out.put("text", trimmed);
                return out;
            }
            // 文本里夹带链接：仍当 text，前端可识别 url 字段
            if (extractedUrl != null) {
                out.put("url", extractedUrl);
            }
            // 若同时带图片，下面继续合并
        }

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) uris.add(stream);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) {
                int n = 0;
                for (Uri u : list) {
                    if (u == null) continue;
                    uris.add(u);
                    if (++n >= MAX_IMAGES) break;
                }
            }
        }

        if (!uris.isEmpty()) {
            ContentResolver cr = context.getContentResolver();
            JSArray images = new JSArray();
            JSArray files = new JSArray();
            boolean anyImage = false;

            for (Uri uri : uris) {
                String mime = cr.getType(uri);
                if (mime == null || mime.isEmpty()) {
                    mime = type != null && type.contains("/") ? type : "application/octet-stream";
                }
                String filename = queryDisplayName(cr, uri);
                if (filename == null || filename.isEmpty()) {
                    filename = mime.startsWith("image/") ? "shared.jpg" : "shared.bin";
                }

                FileBytes fb = readUriLimited(cr, uri, MAX_FILE_BYTES);
                if (fb == null) {
                    Log.w(TAG, "skip unreadable uri=" + uri);
                    continue;
                }
                if (fb.truncated) {
                    Log.w(TAG, "file too large, skipped: " + filename);
                    continue;
                }

                JSObject item = new JSObject();
                item.put("mimeType", mime);
                item.put("filename", filename);
                item.put("base64", Base64.encodeToString(fb.data, Base64.NO_WRAP));
                item.put("size", fb.data.length);

                if (mime.startsWith("image/")) {
                    anyImage = true;
                    images.put(item);
                } else {
                    files.put(item);
                }
            }

            if (images.length() > 0 || files.length() > 0) {
                if (anyImage && files.length() == 0) {
                    out.put("type", images.length() > 1 ? "images" : "image");
                } else if (!anyImage && files.length() > 0) {
                    out.put("type", "file");
                } else {
                    out.put("type", "mixed");
                }
                if (images.length() > 0) out.put("images", images);
                if (files.length() > 0) out.put("files", files);
                if (text != null && !text.trim().isEmpty()) {
                    out.put("text", text.trim());
                }
                return out;
            }
        }

        // 仅文本
        if (text != null && !text.trim().isEmpty()) {
            out.put("type", "text");
            out.put("text", text.trim());
            return out;
        }

        return null;
    }

    private static String extractFirstUrl(String text) {
        java.util.regex.Matcher m = URL_PATTERN.matcher(text);
        if (m.find()) {
            String u = m.group();
            // 去掉尾部常见标点
            while (u.length() > 0 && ".,);]!?>\"'".indexOf(u.charAt(u.length() - 1)) >= 0) {
                u = u.substring(0, u.length() - 1);
            }
            return u;
        }
        return null;
    }

    private static boolean looksLikeMostlyUrl(String text, String url) {
        String rest = text.replace(url, "").trim();
        return rest.isEmpty() || rest.length() < 40;
    }

    private static String queryDisplayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last;
    }

    private static class FileBytes {
        final byte[] data;
        final boolean truncated;

        FileBytes(byte[] data, boolean truncated) {
            this.data = data;
            this.truncated = truncated;
        }
    }

    private static FileBytes readUriLimited(ContentResolver cr, Uri uri, int maxBytes) {
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    return new FileBytes(new byte[0], true);
                }
                bos.write(buf, 0, n);
            }
            return new FileBytes(bos.toByteArray(), false);
        } catch (Exception e) {
            Log.e(TAG, "readUri failed " + uri, e);
            return null;
        }
    }
}
