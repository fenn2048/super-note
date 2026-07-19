package com.ark.note;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(ShareReceivePlugin.class);
        registerPlugin(MediaPlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        // 通知渠道；KeepAlive 默认关闭
        NotificationChannels.ensureAll(this);
        KeepAliveService.startIfEnabled(this);

        handleIncomingIntent(getIntent());

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownloadBridge");
            this.bridge.getWebView().addJavascriptInterface(new AndroidKeepAliveBridge(), "AndroidKeepAliveBridge");

            this.bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
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
