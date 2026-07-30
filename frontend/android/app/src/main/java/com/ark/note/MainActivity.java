package com.ark.note;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    /** 浅色主题默认：与前端 --color-bg / --color-elevated 一致 */
    private int statusBarColor = Color.parseColor("#F3EFE6");
    private int navigationBarColor = Color.parseColor("#FFFAF2");
    private boolean lightSystemBars = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        AppLogger.init(this);
        AppLogger.i(TAG, "MainActivity onCreate");
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(ShareReceivePlugin.class);
        registerPlugin(MediaPlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        // 系统栏与 App 米色主题对齐，避免 Honor Magic7 等机型上下留纯白条
        applySystemBars();

        // 通知渠道；KeepAlive 默认关闭
        NotificationChannels.ensureAll(this);
        KeepAliveService.startIfEnabled(this);

        handleIncomingIntent(getIntent());

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownloadBridge");
            this.bridge.getWebView().addJavascriptInterface(new AndroidKeepAliveBridge(), "AndroidKeepAliveBridge");
            this.bridge.getWebView().addJavascriptInterface(new AndroidLogBridge(), "AndroidLogBridge");
            this.bridge.getWebView().addJavascriptInterface(new AndroidSystemBarsBridge(), "AndroidSystemBarsBridge");

            this.bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            });

            // 把真实 WindowInsets 注入 WebView CSS 变量（Honor/MagicOS 上 env(safe-area) 常为 0）
            final WebView webView = this.bridge.getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
                Insets sys = insets.getInsets(
                    WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                Insets gest = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
                int topPx = Math.max(sys.top, 0);
                // 手势条机型 navigationBars 可能偏小；systemGestures 底部区域往往过大，封顶 48dp
                int gestureBottom = gest.bottom > 0 ? Math.min(gest.bottom, dp(48)) : 0;
                int bottomPx = Math.max(nav.bottom, gestureBottom);
                injectSafeAreaCss(webView, topPx, bottomPx);
                return insets;
            });
            ViewCompat.requestApplyInsets(webView);
        }
    }

    private int dp(int value) {
        float d = getResources().getDisplayMetrics().density;
        return Math.round(value * d);
    }

    private void applySystemBars() {
        Window window = getWindow();
        if (window == null) return;

        // Edge-to-Edge：内容可画到系统栏下方，由 CSS safe-area 避让
        WindowCompat.setDecorFitsSystemWindows(window, false);

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(statusBarColor);
        window.setNavigationBarColor(navigationBarColor);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, decor);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(lightSystemBars);
            controller.setAppearanceLightNavigationBars(lightSystemBars);
        }
    }

    private void injectSafeAreaCss(WebView webView, int topPx, int bottomPx) {
        // 转 CSS px（与 density 无关：WindowInsets 已是物理 px，CSS 需要除以 density）
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        float topCss = topPx / density;
        float bottomCss = bottomPx / density;
        // 兜底：至少状态栏 28、手势条 32，避免 inset 上报 0 时贴边（Magic 系列）
        if (topCss < 1f) topCss = 28f;
        if (bottomCss < 1f) bottomCss = 32f;

        final String js =
            "(function(){try{"
                + "var r=document.documentElement;"
                + "r.style.setProperty('--android-status-bar-height','" + topCss + "px');"
                + "r.style.setProperty('--android-nav-bar-height','" + bottomCss + "px');"
                + "r.setAttribute('data-native','android');"
                + "}catch(e){}})();";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    /**
     * 前端主题切换时同步系统栏颜色（浅色纸感 / 深色墨底）。
     * 入参为 #RRGGBB 或 #AARRGGBB。
     */
    public class AndroidSystemBarsBridge {
        @JavascriptInterface
        public void setColors(String statusHex, String navHex, boolean lightIconsBg) {
            runOnUiThread(() -> {
                try {
                    if (statusHex != null && statusHex.length() >= 7) {
                        statusBarColor = Color.parseColor(statusHex.trim());
                    }
                    if (navHex != null && navHex.length() >= 7) {
                        navigationBarColor = Color.parseColor(navHex.trim());
                    }
                    lightSystemBars = lightIconsBg;
                    applySystemBars();
                } catch (Exception e) {
                    AppLogger.w(TAG, "setColors failed: " + e.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void setLight(boolean light) {
            runOnUiThread(() -> {
                lightSystemBars = light;
                if (light) {
                    statusBarColor = Color.parseColor("#F3EFE6");
                    navigationBarColor = Color.parseColor("#FFFAF2");
                } else {
                    statusBarColor = Color.parseColor("#16131C");
                    navigationBarColor = Color.parseColor("#252033");
                }
                applySystemBars();
            });
        }
    }

    public class AndroidLogBridge {
        @JavascriptInterface
        public void log(String level, String tag, String message) {
            if ("ERROR".equalsIgnoreCase(level)) {
                AppLogger.e(tag != null ? tag : "JS", message != null ? message : "");
            } else if ("WARN".equalsIgnoreCase(level)) {
                AppLogger.w(tag != null ? tag : "JS", message != null ? message : "");
            } else if ("DEBUG".equalsIgnoreCase(level)) {
                AppLogger.d(tag != null ? tag : "JS", message != null ? message : "");
            } else {
                AppLogger.i(tag != null ? tag : "JS", message != null ? message : "");
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    /**
     * Capacitor Bridge 在 onPause 里会 WebView.onPause()，连带暂停 HTMLMediaElement。
     * 全局音乐 / 视频后台仅听依赖 WebView 内 media 解码，退后台会静音。
     * 媒体前台服务活跃时立刻 resume WebView，并多次补唤醒 + 通知 JS 续播。
     */
    @Override
    public void onPause() {
        super.onPause();
        keepWebViewMediaAliveIfNeeded();
        scheduleWebViewMediaKeepAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewMediaAliveIfNeeded();
        scheduleWebViewMediaKeepAlive();
    }

    private void scheduleWebViewMediaKeepAlive() {
        if (!MediaPlaybackService.shouldKeepWebViewMediaAlive()) return;
        try {
            if (this.bridge == null) return;
            WebView wv = this.bridge.getWebView();
            if (wv == null) return;
            // 覆盖 onPause→onStop→部分 ROM 二次挂起；车机点播时额外拉长补唤醒
            long[] delays = MediaPlaybackService.isActive()
                    ? new long[] { 50L, 150L, 400L, 1000L, 2000L, 5000L, 12000L }
                    : new long[] { 50L, 200L, 500L, 1500L, 3000L, 8000L };
            for (long d : delays) {
                wv.postDelayed(this::keepWebViewMediaAliveIfNeeded, d);
            }
        } catch (Exception e) {
            Log.w(TAG, "scheduleWebViewMediaKeepAlive", e);
        }
    }

    private void keepWebViewMediaAliveIfNeeded() {
        if (!MediaPlaybackService.shouldKeepWebViewMediaAlive()) return;
        try {
            if (this.bridge == null) return;
            WebView wv = this.bridge.getWebView();
            if (wv == null) return;
            wv.post(() -> {
                try {
                    wv.resumeTimers();
                    wv.onResume();
                    // 通知前端强制续播 video / audio（与 FGS 对齐）
                    wv.evaluateJavascript(
                            "try{window.dispatchEvent(new Event('super:webview-media-resume'));}catch(e){}",
                            null
                    );
                } catch (Exception e) {
                    Log.w(TAG, "keepWebViewMediaAlive resume failed", e);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "keepWebViewMediaAlive", e);
        }
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        // 车机 MediaBrowser 点播拉起：立刻保活 WebView + 续期 FGS 窗口
        if (intent.getBooleanExtra("media_browse_wake", false)) {
            Log.i(TAG, "media_browse_wake — force WebView media keep-alive");
            MediaPlaybackService.markCarBrowseKeepAlive();
            keepWebViewMediaAliveIfNeeded();
            scheduleWebViewMediaKeepAlive();
            intent.removeExtra("media_browse_wake");
        }
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ShareReceivePlugin.queueFromIntent(this, intent);
            intent.setAction(Intent.ACTION_MAIN);
            intent.removeExtra(Intent.EXTRA_TEXT);
            intent.removeExtra(Intent.EXTRA_STREAM);
            intent.removeExtra(Intent.EXTRA_SUBJECT);
        }
    }

    public class AndroidDownloadBridge {
        /**
         * Base64 → Downloads（小文件；大文件请用 downloadFromUrl）
         */
        @JavascriptInterface
        public void downloadFile(String base64Data, String filename, String mimeType) {
            new Thread(() -> {
                try {
                    byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                    writeToDownloads(data, filename, mimeType != null ? mimeType : "application/octet-stream");
                    runOnUiThread(() ->
                            Toast.makeText(MainActivity.this, "已保存: " + filename, Toast.LENGTH_SHORT).show()
                    );
                } catch (Exception e) {
                    Log.e(TAG, "downloadFile", e);
                    runOnUiThread(() ->
                            Toast.makeText(MainActivity.this, "保存失败: " + e.getMessage(), Toast.LENGTH_LONG).show()
                    );
                }
            }).start();
        }

        /**
         * 用系统浏览器 / 外部应用打开 URL（更新页、GitHub Releases 等）。
         * 切勿用 WebView 内跳转：站点 SPA 会把缺失的 .apk 渲染成登录页。
         */
        @JavascriptInterface
        public void openExternalUrl(String urlStr) {
            runOnUiThread(() -> {
                try {
                    if (urlStr == null || urlStr.isEmpty()) {
                        Toast.makeText(MainActivity.this, "无效链接", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(urlStr));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "openExternalUrl", e);
                    Toast.makeText(MainActivity.this, "无法打开: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        /**
         * 原生流式下载 URL → Downloads（避免 WebView base64 OOM）
         * token 可为 null；非空则加 Authorization: Bearer
         */
        @JavascriptInterface
        public void downloadFromUrl(String urlStr, String filename, String mimeType, String token) {
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(120000);
                    conn.setInstanceFollowRedirects(true);
                    if (token != null && !token.isEmpty()) {
                        conn.setRequestProperty("Authorization", "Bearer " + token);
                    }
                    conn.connect();
                    int code = conn.getResponseCode();
                    // 跟随 3xx（部分环境 instanceFollowRedirects 对 HTTPS→HTTP 会停）
                    int hops = 0;
                    while (code >= 300 && code < 400 && hops < 5) {
                        String loc = conn.getHeaderField("Location");
                        if (loc == null || loc.isEmpty()) break;
                        conn.disconnect();
                        url = new URL(url, loc);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(120000);
                        conn.setInstanceFollowRedirects(true);
                        if (token != null && !token.isEmpty()) {
                            conn.setRequestProperty("Authorization", "Bearer " + token);
                        }
                        conn.connect();
                        code = conn.getResponseCode();
                        hops++;
                    }
                    if (code < 200 || code >= 300) {
                        throw new IOException("HTTP " + code);
                    }
                    String ct = mimeType;
                    if (ct == null || ct.isEmpty()) {
                        ct = conn.getContentType();
                        if (ct != null && ct.contains(";")) ct = ct.split(";")[0].trim();
                    }
                    if (ct == null || ct.isEmpty()) ct = "application/octet-stream";

                    String safeName = (filename != null && !filename.isEmpty())
                            ? filename.replaceAll("[\\\\/:*?\"<>|]", "_")
                            : "download.bin";
                    boolean isApk = safeName.toLowerCase().endsWith(".apk")
                            || (ct != null && ct.contains("android.package"));

                    if (isApk) {
                        // 写到 app cache，再 FileProvider 调起系统安装器（可覆盖安装）
                        File updateDir = new File(getCacheDir(), "updates");
                        if (!updateDir.exists() && !updateDir.mkdirs()) {
                            throw new IOException("cannot create updates dir");
                        }
                        File apkFile = new File(updateDir, safeName.endsWith(".apk") ? safeName : "super-note.apk");
                        try (InputStream in = conn.getInputStream();
                             FileOutputStream fos = new FileOutputStream(apkFile)) {
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = in.read(buf)) != -1) {
                                fos.write(buf, 0, n);
                            }
                            fos.flush();
                        }
                        // 同步一份到系统 Downloads，便于用户备份
                        try (InputStream in2 = new java.io.FileInputStream(apkFile)) {
                            streamToDownloads(in2, apkFile.getName(),
                                    "application/vnd.android.package-archive");
                        } catch (Exception copyEx) {
                            Log.w(TAG, "copy apk to Downloads failed", copyEx);
                        }
                        runOnUiThread(() -> promptInstallApk(apkFile));
                    } else {
                        try (InputStream in = conn.getInputStream()) {
                            streamToDownloads(in, safeName, ct);
                        }
                        runOnUiThread(() ->
                                Toast.makeText(MainActivity.this, "已保存: " + safeName, Toast.LENGTH_SHORT).show()
                        );
                    }
                } catch (Exception e) {
                    Log.e(TAG, "downloadFromUrl", e);
                    runOnUiThread(() ->
                            Toast.makeText(MainActivity.this, "下载失败: " + e.getMessage(), Toast.LENGTH_LONG).show()
                    );
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }).start();
        }

        /** 调起系统安装器；需 REQUEST_INSTALL_PACKAGES（Android 8+） */
        private void promptInstallApk(File apkFile) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getPackageManager().canRequestPackageInstalls()) {
                        Toast.makeText(MainActivity.this,
                                "请允许「安装未知应用」后再次点击更新", Toast.LENGTH_LONG).show();
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        settings.setData(Uri.parse("package:" + getPackageName()));
                        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(settings);
                        return;
                    }
                }
                Uri uri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        apkFile
                );
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(install);
                Toast.makeText(MainActivity.this, "正在打开安装界面…", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Log.e(TAG, "promptInstallApk", e);
                Toast.makeText(MainActivity.this,
                        "无法打开安装器: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }

        /** 系统分享纯文本 */
        @JavascriptInterface
        public void shareText(String text, String title) {
            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text != null ? text : "");
                    if (title != null && !title.isEmpty()) {
                        send.putExtra(Intent.EXTRA_SUBJECT, title);
                    }
                    startActivity(Intent.createChooser(send, title != null ? title : "分享"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "无法分享: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        /**
         * Base64 写入 cache 后系统分享（小文件）
         */
        @JavascriptInterface
        public void shareFile(String base64Data, String filename, String mimeType) {
            new Thread(() -> {
                try {
                    byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                    File cache = new File(getCacheDir(), "share");
                    if (!cache.exists()) cache.mkdirs();
                    String safeName = (filename != null && !filename.isEmpty())
                            ? filename.replaceAll("[\\\\/:*?\"<>|]", "_")
                            : "shared.bin";
                    File out = new File(cache, safeName);
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        fos.write(data);
                    }
                    Uri uri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".fileprovider",
                            out
                    );
                    String mt = mimeType != null && !mimeType.isEmpty() ? mimeType : "application/octet-stream";
                    runOnUiThread(() -> {
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType(mt);
                        send.putExtra(Intent.EXTRA_STREAM, uri);
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(send, "分享文件"));
                    });
                } catch (Exception e) {
                    Log.e(TAG, "shareFile", e);
                    runOnUiThread(() ->
                            Toast.makeText(MainActivity.this, "分享失败: " + e.getMessage(), Toast.LENGTH_LONG).show()
                    );
                }
            }).start();
        }

        private void writeToDownloads(byte[] data, String filename, String mimeType) throws IOException {
            String name = filename != null ? filename : "download.bin";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("MediaStore insert failed");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IOException("openOutputStream null");
                    os.write(data);
                    os.flush();
                }
            } else {
                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadDir.exists()) downloadDir.mkdirs();
                File file = new File(downloadDir, name);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(data);
                    fos.flush();
                }
            }
        }

        private void streamToDownloads(InputStream in, String filename, String mimeType) throws IOException {
            String name = filename != null ? filename : "download.bin";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("MediaStore insert failed");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IOException("openOutputStream null");
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        os.write(buf, 0, n);
                    }
                    os.flush();
                }
            } else {
                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadDir.exists()) downloadDir.mkdirs();
                File file = new File(downloadDir, name);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        fos.write(buf, 0, n);
                    }
                    fos.flush();
                }
            }
        }
    }

    public class AndroidKeepAliveBridge {
        @JavascriptInterface
        public void updateAuthInfo(String serverUrl, String token, String userId) {
            android.content.SharedPreferences sharedPref =
                    getSharedPreferences(KeepAliveService.PREFS, MODE_PRIVATE);
            sharedPref.edit()
                    .putString("serverUrl", serverUrl != null ? serverUrl : "")
                    .putString("token", token != null ? token : "")
                    .putString("userId", userId != null ? userId : "")
                    .apply();

            if (KeepAliveService.isEnabled(MainActivity.this)) {
                KeepAliveService.stop(MainActivity.this);
                KeepAliveService.startIfEnabled(MainActivity.this);
            }
        }
    }
}
